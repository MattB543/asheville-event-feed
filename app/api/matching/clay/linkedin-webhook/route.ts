import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { matchingEnrichmentItems, matchingProfiles } from '@/lib/db/schema';
import { env } from '@/lib/config/env';
import { verifyAuthToken } from '@/lib/utils/auth';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord, isString } from '@/lib/utils/validation';
import { canonicalizeUrl, sourceHash, toAbsoluteUrl } from '@/lib/matching/pipeline/source';

export const runtime = 'nodejs';

const RATE_LIMIT_MAX = 180; // up to 180 callback events per minute per IP
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CLAY_NORMALIZED_MAX_CHARS = 12_000;

function mapClayStatus(value: string): 'pending' | 'completed' | 'failed' | 'timeout' | 'skipped' {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'success' || normalized === 'completed' || normalized === 'done') {
    return 'completed';
  }

  if (normalized === 'timeout') {
    return 'timeout';
  }

  if (normalized === 'pending' || normalized === 'processing' || normalized === 'in_progress') {
    return 'pending';
  }

  if (normalized === 'skipped') {
    return 'skipped';
  }

  return 'failed';
}

function clipNormalizedText(value: string): string {
  return value.trim().slice(0, CLAY_NORMALIZED_MAX_CHARS);
}

function tryParseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractClayEnrichedJson(payload: Record<string, unknown>): unknown {
  const keys = [
    'enriched_json',
    'enrichedJson',
    'linkedin_json',
    'linkedinJson',
    'linkedin_data',
    'linkedinData',
    'profile_json',
    'profileJson',
    'enriched_profile',
    'enrichedProfile',
    'data',
  ];

  for (const key of keys) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (value === null || value === undefined) continue;

    if (typeof value === 'string') {
      const parsed = tryParseJsonString(value);
      if (parsed !== null) return parsed;
      continue;
    }

    if (typeof value === 'object') {
      return value;
    }
  }

  return null;
}

function stringifyJson(value: unknown): string | null {
  try {
    const stringified = JSON.stringify(value, null, 2);
    if (!stringified || stringified === '{}' || stringified === '[]') return null;
    return clipNormalizedText(stringified);
  } catch {
    return null;
  }
}

function buildNormalizedClayText(
  enrichedText: string | null,
  enrichedJson: unknown
): string | null {
  const jsonText = enrichedJson ? stringifyJson(enrichedJson) : null;

  if (enrichedText && jsonText) {
    return clipNormalizedText(`${enrichedText}\n\nLinkedIn JSON:\n${jsonText}`);
  }

  if (enrichedText) {
    return clipNormalizedText(enrichedText);
  }

  if (jsonText) {
    return clipNormalizedText(`LinkedIn JSON:\n${jsonText}`);
  }

  return null;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!verifyAuthToken(authHeader, env.CLAY_WEBHOOK_SECRET)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';
  const rateKey = `matching-clay-webhook:${ip}`;
  if (isRateLimited(rateKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Please retry later.' },
      { status: 429 }
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isRecord(parsedBody)) {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const runId =
    (isString(parsedBody.run_id) && parsedBody.run_id.trim()) ||
    (isString(parsedBody.runId) && parsedBody.runId.trim()) ||
    '';
  const userUid =
    (isString(parsedBody.user_uid) && parsedBody.user_uid.trim()) ||
    (isString(parsedBody.userUid) && parsedBody.userUid.trim()) ||
    '';
  const linkedinUrlRaw =
    (isString(parsedBody.linkedin_url) && parsedBody.linkedin_url.trim()) ||
    (isString(parsedBody.linkedinUrl) && parsedBody.linkedinUrl.trim()) ||
    '';
  const statusRaw = isString(parsedBody.status) ? parsedBody.status : '';
  const enrichedText =
    (isString(parsedBody.enriched_text) && parsedBody.enriched_text.trim()) ||
    (isString(parsedBody.enrichedText) && parsedBody.enrichedText.trim()) ||
    null;
  const enrichedJson = extractClayEnrichedJson(parsedBody);
  const externalId =
    (isString(parsedBody.external_id) && parsedBody.external_id.trim()) ||
    (isString(parsedBody.externalId) && parsedBody.externalId.trim()) ||
    null;
  const errorText =
    (isString(parsedBody.error) && parsedBody.error.trim()) ||
    (isString(parsedBody.error_text) && parsedBody.error_text.trim()) ||
    null;

  if (!userUid || !linkedinUrlRaw || !statusRaw) {
    return NextResponse.json(
      { success: false, error: 'Missing required fields: user_uid, linkedin_url, status' },
      { status: 400 }
    );
  }

  const absolute = toAbsoluteUrl(linkedinUrlRaw);
  if (!absolute) {
    return NextResponse.json({ success: false, error: 'Invalid linkedin_url' }, { status: 400 });
  }

  const canonicalLinkedin = canonicalizeUrl(absolute);
  const linkedinSourceHash = sourceHash(canonicalLinkedin);
  const mappedStatus = mapClayStatus(statusRaw);

  try {
    const [runScopedItem] = runId
      ? await db
          .select({ id: matchingEnrichmentItems.id })
          .from(matchingEnrichmentItems)
          .innerJoin(matchingProfiles, eq(matchingEnrichmentItems.profileId, matchingProfiles.id))
          .where(
            and(
              eq(matchingProfiles.userId, userUid),
              eq(matchingEnrichmentItems.runId, runId),
              eq(matchingEnrichmentItems.provider, 'clay'),
              eq(matchingEnrichmentItems.sourceHash, linkedinSourceHash)
            )
          )
          .limit(1)
      : [];

    const [fallbackItem] = !runScopedItem
      ? await db
          .select({
            id: matchingEnrichmentItems.id,
          })
          .from(matchingEnrichmentItems)
          .innerJoin(matchingProfiles, eq(matchingEnrichmentItems.profileId, matchingProfiles.id))
          .where(
            and(
              eq(matchingProfiles.userId, userUid),
              eq(matchingEnrichmentItems.provider, 'clay'),
              eq(matchingEnrichmentItems.sourceHash, linkedinSourceHash)
            )
          )
          .orderBy(desc(matchingEnrichmentItems.updatedAt))
          .limit(1)
      : [];

    const targetItem = runScopedItem ?? fallbackItem;
    if (!targetItem) {
      return NextResponse.json(
        { success: false, error: 'No matching enrichment row found for callback' },
        { status: 404 }
      );
    }

    const now = new Date();
    const updateValues: {
      status: 'pending' | 'completed' | 'failed' | 'timeout' | 'skipped';
      sourceValue: string;
      externalId?: string;
      normalizedText: string | null;
      rawPayload: unknown;
      errorText: string | null;
      updatedAt: Date;
    } = {
      status: mappedStatus,
      sourceValue: canonicalLinkedin,
      normalizedText: buildNormalizedClayText(enrichedText, enrichedJson),
      rawPayload: parsedBody,
      errorText: mappedStatus === 'failed' || mappedStatus === 'timeout' ? errorText : null,
      updatedAt: now,
    };

    // Preserve the dispatch claim token when Clay does not return an external id.
    if (externalId) {
      updateValues.externalId = externalId;
    }

    await db
      .update(matchingEnrichmentItems)
      .set(updateValues)
      .where(eq(matchingEnrichmentItems.id, targetItem.id));

    return NextResponse.json({
      success: true,
      mappedStatus,
      itemId: targetItem.id,
    });
  } catch (error) {
    console.error('[Matching Clay Webhook] Failed to process callback:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
