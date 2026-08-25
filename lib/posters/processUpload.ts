/**
 * The poster upload pipeline: normalize -> dedupe -> extract -> persist ->
 * publish or flag -> promote to events.
 *
 * Lives outside the route handler so it can be driven directly (tests,
 * scripts, a future queue worker). The route owns auth and multipart parsing;
 * everything from the raw image bytes onward is here.
 */

import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { and, eq, gt, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posterExtractions, posterUploads } from '@/lib/db/schema';
import {
  extractPostersFromImage,
  MAX_DATES_PER_POSTER,
  MAX_POSTERS_PER_IMAGE,
} from '@/lib/ai/posterExtraction';
import { promoteExtractions, type PromotionOutcome } from '@/lib/posters/promoteExtractions';
import { cropToQuad } from '@/lib/posters/cropToQuad';
import {
  publishPosterImage,
  posterIngressPath,
  unpublishPosterImage,
  uploadPosterCropped,
  uploadPosterIngress,
} from '@/lib/supabase/storage';
import { sendPosterFlaggedNotification } from '@/lib/notifications/slack';
import { isBoolean, isRecord, isString, isUnknownArray } from '@/lib/utils/validation';
import { parseAsEastern } from '@/lib/utils/timezone';

/** Uploads one account may process per rolling 24 hours. */
export const DAILY_UPLOAD_QUOTA = 20;

/** Total extraction rows one image may produce, across all its posters. */
export const MAX_EXTRACTION_ROWS = 20;

const MAX_IMAGE_DIMENSION = 2048;
const JPEG_QUALITY = 85;

/** Decode ceiling (~50 MP). Well above any phone camera, far below a decompression bomb. */
const MAX_INPUT_PIXELS = 50_000_000;

/** Formats sharp must actually detect in the bytes, whatever the multipart MIME claimed. */
const ALLOWED_DECODED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

/** Repo convention for events whose source gave a date but no time. */
const DEFAULT_START_TIME = '19:00:00';

export interface PosterUploadInput {
  userId: string;
  /** Raw bytes as received; normalization happens here. */
  buffer: Buffer;
}

export interface ProcessedExtraction {
  title: string;
  startDate: Date | null;
  outcome: PromotionOutcome | null;
  eventSlug: string | null;
}

export type PosterUploadResult =
  | { kind: 'quota_exceeded'; limit: number }
  | { kind: 'invalid_image'; message: string }
  | { kind: 'duplicate'; uploadId: string; status: string }
  | { kind: 'failed'; uploadId: string; message: string }
  /** The image decoded and passed safety, but held no readable event poster. */
  | { kind: 'no_posters'; uploadId: string; message: string }
  | {
      kind: 'ok';
      uploadId: string;
      status: 'published' | 'pending_review';
      extractions: ProcessedExtraction[];
      /** True when caps trimmed posters or dates off the model's answer */
      capped: boolean;
      /** Set when the poster published but event promotion threw */
      promotionError?: string;
    };

/** A date entry that survived shape and calendar validation. */
interface ValidPosterDate {
  date: string;
  time: string | null;
}

interface ValidatedPoster {
  title: string;
  rawText: string | null;
  location: string | null;
  organizer: string | null;
  description: string | null;
  price: string | null;
  dates: ValidPosterDate[];
}

function optionalString(value: unknown): string | null {
  if (!isString(value)) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * True only for a date string naming a day that actually exists. `new Date()`
 * happily rolls "2026-02-30" forward to March 2nd, which would silently store
 * an event on the wrong day.
 */
function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function isValidClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Compose the canonical location string.
 *
 * The model returns city/state separately and `location` is often venue-only,
 * so "The Earl" in Atlanta would sail past the NC filter. Appending whatever
 * the model did read keeps the geo check honest.
 */
export function composeLocation(
  location: string | null,
  city: string | null,
  state: string | null
): string | null {
  const parts: string[] = [];
  if (location) parts.push(location);

  for (const part of [city, state]) {
    if (!part) continue;
    const alreadyPresent = parts.some((existing) =>
      existing.toLowerCase().includes(part.toLowerCase())
    );
    if (!alreadyPresent) parts.push(part);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

function validatePoster(raw: unknown): { poster: ValidatedPoster; datesCapped: boolean } | null {
  if (!isRecord(raw)) return null;

  const title = optionalString(raw.title);
  if (!title) return null;

  const dates: ValidPosterDate[] = [];
  let datesCapped = false;

  if (isUnknownArray(raw.dates)) {
    datesCapped = raw.dates.length > MAX_DATES_PER_POSTER;

    for (const entry of raw.dates) {
      if (dates.length >= MAX_DATES_PER_POSTER) break;
      if (!isRecord(entry)) continue;

      const date = optionalString(entry.date);
      // An impossible date ("2026-02-30") is unparseable, not a date to store.
      if (!date || !isRealCalendarDate(date)) continue;

      const time = optionalString(entry.time);
      // A malformed time is dropped rather than failing the whole date - the
      // event just becomes time-unknown.
      dates.push({ date, time: time && isValidClockTime(time) ? time : null });
    }
  }

  return {
    poster: {
      title,
      rawText: optionalString(raw.rawText),
      location: composeLocation(
        optionalString(raw.location),
        optionalString(raw.city),
        optionalString(raw.state)
      ),
      organizer: optionalString(raw.organizer),
      description: optionalString(raw.description),
      price: optionalString(raw.price),
      dates,
    },
    datesCapped,
  };
}

interface ValidatedResult {
  flagged: boolean;
  safetyReason: string | null;
  /** Adult-audience verdict; independent of `flagged` - either one holds the upload */
  adult: boolean;
  adultReason: string | null;
  /** Whether the model saw a photographed sheet worth cropping to. */
  needsCrop: boolean;
  /** Raw corner payload - shape and sanity are cropToQuad's job, not ours. */
  cropCorners: unknown;
  posters: ValidatedPoster[];
  capped: boolean;
}

/**
 * Shape-validate the model's answer and apply the caps. Returns null when the
 * payload is unusable (which the caller treats as a parse failure).
 */
export function validateExtractionResult(raw: unknown): ValidatedResult | null {
  if (!isRecord(raw) || !isUnknownArray(raw.posters)) return null;

  let capped = raw.posters.length > MAX_POSTERS_PER_IMAGE;
  const posters: ValidatedPoster[] = [];

  for (const entry of raw.posters.slice(0, MAX_POSTERS_PER_IMAGE)) {
    const validated = validatePoster(entry);
    if (!validated) continue;
    if (validated.datesCapped) capped = true;
    posters.push(validated.poster);
  }

  return {
    // A missing or non-boolean safety verdict routes to review: the prompt
    // tells the model to err toward flagging, and so do we.
    flagged: isBoolean(raw.inappropriateForMinors) ? raw.inappropriateForMinors : true,
    safetyReason: optionalString(raw.safetyReason),
    // No fallback-to-true here: a payload missing both verdicts already routes
    // to review via `flagged` above, so defaulting this one on would only
    // mislabel safety-flagged uploads as adult ones.
    adult: isBoolean(raw.adultOriented) ? raw.adultOriented : false,
    adultReason: optionalString(raw.adultReason),
    // Absent verdict means leave the image alone: cropping is the enhancement,
    // publishing as-uploaded is the safe default.
    needsCrop: isBoolean(raw.needsCrop) ? raw.needsCrop : false,
    cropCorners: raw.cropCorners,
    posters,
    capped,
  };
}

interface ExtractionRowValues {
  uploadId: string;
  ordinal: number;
  title: string;
  rawText: string | null;
  startDate: Date | null;
  timeUnknown: boolean;
  location: string | null;
  organizer: string | null;
  description: string | null;
  price: string | null;
}

/**
 * Explode validated posters into extraction rows: one per (poster, date), and
 * one date-less row for a poster whose dates were unreadable so it still shows
 * up on /posters.
 */
export function buildExtractionRows(
  uploadId: string,
  posters: ValidatedPoster[]
): { rows: ExtractionRowValues[]; capped: boolean } {
  const rows: ExtractionRowValues[] = [];
  let capped = false;

  for (const [ordinal, poster] of posters.entries()) {
    const base = {
      uploadId,
      ordinal,
      title: poster.title,
      rawText: poster.rawText,
      location: poster.location,
      organizer: poster.organizer,
      description: poster.description,
      price: poster.price,
    };

    if (poster.dates.length === 0) {
      if (rows.length >= MAX_EXTRACTION_ROWS) {
        capped = true;
        break;
      }
      rows.push({ ...base, startDate: null, timeUnknown: false });
      continue;
    }

    for (const date of poster.dates) {
      if (rows.length >= MAX_EXTRACTION_ROWS) {
        capped = true;
        break;
      }
      rows.push({
        ...base,
        // parseAsEastern wants HH:MM:SS; the model returns HH:mm.
        startDate: parseAsEastern(date.date, date.time ? `${date.time}:00` : DEFAULT_START_TIME),
        timeUnknown: date.time === null,
      });
    }

    if (capped) break;
  }

  return { rows, capped };
}

/**
 * Decode, auto-rotate, bound, and re-encode the upload as JPEG.
 *
 * The declared multipart MIME type is attacker-controlled, so the real format
 * comes from sharp's own probe of the bytes, and the decode is pixel-capped so
 * a small highly-compressed file cannot force a huge allocation.
 */
async function normalizeImage(
  buffer: Buffer
): Promise<
  | { ok: true; buffer: Buffer; width: number | null; height: number | null }
  | { ok: false; message: string }
> {
  try {
    const probe = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();

    if (!probe.format || !ALLOWED_DECODED_FORMATS.has(probe.format)) {
      return {
        ok: false,
        message: `That file is not a supported image (detected: ${probe.format ?? 'unknown'}).`,
      };
    }

    const normalized = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      // Phone photos carry EXIF orientation and the re-encode strips EXIF, so
      // without this portrait shots come out sideways.
      .rotate()
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      // The resize is `fit: 'inside'`, so the output dimensions are not
      // derivable from the input's - they have to come back off the encode.
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      buffer: normalized.data,
      width: normalized.info.width ?? null,
      height: normalized.info.height ?? null,
    };
  } catch (error) {
    console.error('[Posters] Image normalization failed:', error);
    return { ok: false, message: 'That file could not be read as an image.' };
  }
}

async function findUploadByHash(imageHash: string): Promise<{ id: string; status: string } | null> {
  const [existing] = await db
    .select({ id: posterUploads.id, status: posterUploads.status })
    .from(posterUploads)
    .where(eq(posterUploads.imageHash, imageHash))
    .limit(1);

  return existing ?? null;
}

/**
 * The pre-insert hash check is raceable (the index is deliberately non-unique
 * so a collision can never fail an insert). After claiming our own row, look
 * for an older row with the same hash - created_at, then id as the tiebreak.
 */
async function findEarlierUploadWithHash(
  uploadId: string,
  imageHash: string,
  createdAt: Date
): Promise<{ id: string; status: string } | null> {
  const [earlier] = await db
    .select({ id: posterUploads.id, status: posterUploads.status })
    .from(posterUploads)
    .where(
      and(
        eq(posterUploads.imageHash, imageHash),
        ne(posterUploads.id, uploadId),
        or(
          lt(posterUploads.createdAt, createdAt),
          and(eq(posterUploads.createdAt, createdAt), lt(posterUploads.id, uploadId))
        )
      )
    )
    .limit(1);

  return earlier ?? null;
}

async function countRecentUploads(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posterUploads)
    .where(
      and(
        eq(posterUploads.userId, userId),
        gt(posterUploads.createdAt, sql`now() - interval '24 hours'`)
      )
    );

  return row?.count ?? 0;
}

async function markFailed(uploadId: string, message: string, raw?: string): Promise<void> {
  await db
    .update(posterUploads)
    .set({
      status: 'failed',
      errorMessage: message.slice(0, 2000),
      rawModelOutput: raw ?? null,
      updatedAt: new Date(),
    })
    .where(eq(posterUploads.id, uploadId));
}

/**
 * Run an uploaded image through the whole poster pipeline.
 *
 * Every branch that stops early cleans up after itself: rows claimed and then
 * rejected (duplicate, over quota) are deleted, and nothing has been written to
 * storage at that point.
 */
export async function processPosterUpload(input: PosterUploadInput): Promise<PosterUploadResult> {
  // Advisory pre-check so an over-quota account cannot spend a decode per
  // request. The authoritative check still runs after the row is claimed.
  if ((await countRecentUploads(input.userId)) >= DAILY_UPLOAD_QUOTA) {
    return { kind: 'quota_exceeded', limit: DAILY_UPLOAD_QUOTA };
  }

  const decoded = await normalizeImage(input.buffer);
  if (!decoded.ok) {
    return { kind: 'invalid_image', message: decoded.message };
  }
  const normalized = decoded.buffer;
  const dimensions = { width: decoded.width, height: decoded.height };

  const imageHash = createHash('sha256').update(normalized).digest('hex');

  // Cheap short-circuit before any AI spend. Also quietly absorbs re-uploads of
  // images that were previously denied.
  const existing = await findUploadByHash(imageHash);
  if (existing) {
    return { kind: 'duplicate', uploadId: existing.id, status: existing.status };
  }

  const uploadId = randomUUID();
  const [claimed] = await db
    .insert(posterUploads)
    .values({
      id: uploadId,
      userId: input.userId,
      imagePath: posterIngressPath(uploadId),
      imageHash,
      fileSizeBytes: normalized.byteLength,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      status: 'processing',
    })
    .returning({ createdAt: posterUploads.createdAt });

  const createdAt = claimed?.createdAt ?? new Date();

  const earlier = await findEarlierUploadWithHash(uploadId, imageHash, createdAt);
  if (earlier) {
    // Nothing else has happened for this upload yet, so the row can just go.
    await db.delete(posterUploads).where(eq(posterUploads.id, uploadId));
    return { kind: 'duplicate', uploadId: earlier.id, status: earlier.status };
  }

  // Counting after claiming (the count includes this row) closes the
  // check-then-act gap that lets concurrent uploads both pass a pre-check.
  const recentUploads = await countRecentUploads(input.userId);
  if (recentUploads > DAILY_UPLOAD_QUOTA) {
    await db.delete(posterUploads).where(eq(posterUploads.id, uploadId));
    return { kind: 'quota_exceeded', limit: DAILY_UPLOAD_QUOTA };
  }

  // From here on the row exists, so every exit has to leave it in a terminal
  // state: one stuck in 'processing' is invisible to the admin queue forever.
  try {
    return await runPipeline(uploadId, normalized, dimensions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Posters] Pipeline threw for ${uploadId}:`, error);
    try {
      await markFailed(uploadId, `Unexpected pipeline error: ${message}`);
    } catch (markError) {
      console.error(`[Posters] Could not mark upload ${uploadId} failed:`, markError);
    }
    throw error;
  }
}

/**
 * Perspective-crop the upload down to the sheet the model found, and stash the
 * result beside the original so publishing picks it up.
 *
 * Runs on flagged uploads too, not just publishable ones: an admin approval
 * publishes straight out of storage, so deferring the crop to approval time
 * would mean re-asking the model for corners we already have.
 *
 * Best-effort throughout. A rejected quad, a storage failure, or a warp that
 * throws all leave the upload exactly as it was, and it publishes uncropped.
 *
 * Storing the object is the whole job: publishPosterImage measures whichever
 * image it actually serves, so the row's dimensions can never drift from it.
 */
async function storeCrop(
  uploadId: string,
  normalized: Buffer,
  dimensions: { width: number | null; height: number | null },
  validated: ValidatedResult
): Promise<void> {
  if (!validated.needsCrop) return;
  // An answer that reports several distinct posters AND a single sheet to crop
  // to is self-contradictory - a bulletin board, most likely. Cropping would
  // publish one poster while the extractions describe them all, so don't.
  if (validated.posters.length !== 1) {
    console.warn(`[Posters] Skipping crop for ${uploadId}: ${validated.posters.length} posters.`);
    return;
  }
  // Dimensions are nullable on the row, and every corner is relative to them,
  // so without both there is nothing to resolve the coordinates against.
  if (!dimensions.width || !dimensions.height) return;

  const cropped = await cropToQuad(
    normalized,
    validated.cropCorners,
    dimensions.width,
    dimensions.height
  );
  if (!cropped) return;

  try {
    await uploadPosterCropped(cropped.buffer, uploadId);
  } catch (error) {
    console.error(`[Posters] Could not store crop for ${uploadId}:`, error);
  }
}

/**
 * Everything after the upload row is claimed. Split out so a single wrapper can
 * guarantee the row reaches a terminal state no matter which step throws.
 */
async function runPipeline(
  uploadId: string,
  normalized: Buffer,
  dimensions: { width: number | null; height: number | null }
): Promise<PosterUploadResult> {
  try {
    await uploadPosterIngress(normalized, uploadId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(uploadId, `Storage upload failed: ${message}`);
    return {
      kind: 'failed',
      uploadId,
      message: 'We could not store that image. Please try again.',
    };
  }

  let extraction = await extractPostersFromImage(normalized);
  // The retry may come back with no `raw` of its own (a transport error rather
  // than a bad answer), and attempt 1's text is then the only evidence left.
  const firstAttemptRaw = !extraction.ok ? extraction.raw : undefined;
  if (!extraction.ok && !extraction.blocked) {
    console.warn(`[Posters] Extraction failed for ${uploadId}, retrying once: ${extraction.error}`);
    extraction = await extractPostersFromImage(normalized);
  }

  const rawModelOutput = (!extraction.ok ? extraction.raw : undefined) ?? firstAttemptRaw;

  if (!extraction.ok) {
    if (extraction.blocked) {
      const safetyReason = `GEMINI_BLOCKED:${extraction.error}`;
      await db
        .update(posterUploads)
        // Gemini refused to look at it, so nothing vouches for the image: treat
        // it as adult until a moderator says otherwise.
        .set({ status: 'pending_review', safetyReason, adult: true, updatedAt: new Date() })
        .where(eq(posterUploads.id, uploadId));

      void sendPosterFlaggedNotification({ uploadId, safetyReason }).catch(() => {});

      return { kind: 'ok', uploadId, status: 'pending_review', extractions: [], capped: false };
    }

    await markFailed(uploadId, extraction.error, rawModelOutput);
    return {
      kind: 'failed',
      uploadId,
      message: 'We could not read that poster. Please try a clearer photo.',
    };
  }

  const validated = validateExtractionResult(extraction.result);
  if (!validated) {
    await markFailed(uploadId, 'Model response did not match the expected shape.', extraction.raw);
    return {
      kind: 'failed',
      uploadId,
      message: 'We could not read that poster. Please try a clearer photo.',
    };
  }

  const { rows, capped: rowsCapped } = buildExtractionRows(uploadId, validated.posters);
  const capped = validated.capped || rowsCapped;

  if (rows.length > 0) {
    await db.insert(posterExtractions).values(rows);
  }

  await storeCrop(uploadId, normalized, dimensions, validated);

  // Either axis holds the upload. They are recorded in separate columns so the
  // queue can show which one fired - an adult-audience flyer is not a safety
  // problem, and labelling it as one would make the distinction unrecoverable.
  if (validated.flagged || validated.adult) {
    const safetyReason = validated.flagged
      ? (validated.safetyReason ?? 'Flagged as inappropriate for minors.')
      : null;
    const adultReason = validated.adult
      ? (validated.adultReason ?? 'Flagged as an adult-audience event.')
      : null;

    await db
      .update(posterUploads)
      .set({
        status: 'pending_review',
        safetyReason,
        adultReason,
        // Either axis makes the image unsuitable for the signed-out feed, and
        // this outlives the moderator's decision.
        adult: true,
        updatedAt: new Date(),
      })
      .where(eq(posterUploads.id, uploadId));

    void sendPosterFlaggedNotification({
      uploadId,
      safetyReason: safetyReason ?? adultReason ?? 'Flagged for review.',
      posterTitles: validated.posters.map((poster) => poster.title),
    }).catch(() => {});

    return {
      kind: 'ok',
      uploadId,
      status: 'pending_review',
      capped,
      extractions: rows.map((row) => ({
        title: row.title,
        startDate: row.startDate,
        outcome: null,
        eventSlug: null,
      })),
    };
  }

  // Publishing copies the image into the public bucket, so an image with no
  // readable poster on it must stop here - otherwise /posters becomes a place
  // to host arbitrary photos.
  if (validated.posters.length === 0) {
    await markFailed(uploadId, 'No event posters detected in this image', extraction.raw);
    return {
      kind: 'no_posters',
      uploadId,
      message: "We couldn't find an event poster in that image. Try a closer, clearer photo.",
    };
  }

  const published = await publishPosterImage(uploadId);

  try {
    await db
      .update(posterUploads)
      .set({
        status: 'published',
        publicImageUrl: published.publicUrl,
        // Measured off the published blob, so the masonry always reserves the
        // tile that actually loads - cropped or not.
        imageWidth: published.width,
        imageHeight: published.height,
        updatedAt: new Date(),
      })
      .where(eq(posterUploads.id, uploadId));
  } catch (error) {
    // The object is already in the public bucket but nothing records it, so it
    // would outlive the upload as an unreferenced public image. Pull it back
    // out before letting the failure through to the terminal-state wrapper.
    try {
      await unpublishPosterImage(uploadId);
    } catch (rollbackError) {
      console.error(`[Posters] Could not roll back publish for ${uploadId}:`, rollbackError);
    }
    throw error;
  }

  // The poster itself is live at this point. A promotion failure is recorded
  // and reported, not raised - promoteExtractions is re-runnable, so the admin
  // approve path can retry it.
  try {
    const promotion = await promoteExtractions(uploadId);
    const failedCount = promotion.extractions.filter((item) => item.outcome === 'failed').length;

    return {
      kind: 'ok',
      uploadId,
      status: 'published',
      capped,
      ...(failedCount > 0
        ? {
            promotionError: `Your poster was saved, but ${failedCount} of its events could not be added yet.`,
          }
        : {}),
      extractions: promotion.extractions.map((item) => ({
        title: item.title,
        startDate: item.startDate,
        outcome: item.outcome,
        eventSlug: item.eventSlug,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Posters] Promotion failed for ${uploadId}:`, error);

    await db
      .update(posterUploads)
      .set({ errorMessage: `Promotion failed: ${message}`.slice(0, 2000), updatedAt: new Date() })
      .where(eq(posterUploads.id, uploadId));

    return {
      kind: 'ok',
      uploadId,
      status: 'published',
      capped,
      promotionError: 'Your poster was saved, but we could not add its events yet.',
      extractions: rows.map((row) => ({
        title: row.title,
        startDate: row.startDate,
        outcome: null,
        eventSlug: null,
      })),
    };
  }
}
