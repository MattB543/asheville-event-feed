import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const BUCKET_NAME = 'event-images';

// Private ingress bucket for user-uploaded posters. Images land here first and are
// only copied into the public bucket once they clear the safety gate.
const POSTER_BUCKET_NAME = 'poster-uploads';

const POSTER_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Object path an upload occupies in the ingress bucket. Exported so the upload
 * route can record `imagePath` on the row it creates before the file is sent.
 */
export function posterIngressPath(uploadId: string): string {
  return `${uploadId}.jpg`;
}

/**
 * Object path of the perspective-cropped derivative, when one was produced.
 *
 * The crop is stored ALONGSIDE the original rather than replacing it: the
 * ingress object stays the untouched normalized upload, so a bad crop is always
 * recoverable and the moderation queue still sees the full scene. Keeping it in
 * the bucket rather than on the row is also what lets an admin approval
 * re-publish the crop without the moderate route knowing crops exist.
 */
function posterCroppedIngressPath(uploadId: string): string {
  return `${uploadId}-cropped.jpg`;
}

function posterPublicPath(uploadId: string): string {
  return `posters/${uploadId}.jpg`;
}

// Service role client for server-side uploads
// Uses service role key which bypasses RLS for storage operations
function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Supabase credentials not configured for storage');
  }

  return createClient(url, serviceKey);
}

/**
 * Upload an image buffer to Supabase Storage.
 * Returns the public URL.
 */
export async function uploadEventImage(
  buffer: Buffer,
  eventId: string,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  const client = getStorageClient();
  const fileName = `${eventId}.jpg`;
  const filePath = `generated/${fileName}`;

  const { error } = await client.storage.from(BUCKET_NAME).upload(filePath, buffer, {
    contentType: mimeType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = client.storage.from(BUCKET_NAME).getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Upload a normalized poster JPEG to the PRIVATE ingress bucket.
 * Nothing is world-readable until publishPosterImage() runs.
 * Returns the object path within that bucket.
 */
export async function uploadPosterIngress(buffer: Buffer, uploadId: string): Promise<string> {
  const client = getStorageClient();
  const filePath = posterIngressPath(uploadId);

  const { error } = await client.storage.from(POSTER_BUCKET_NAME).upload(filePath, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });

  if (error) {
    throw new Error(`Poster ingress upload failed: ${error.message}`);
  }

  return filePath;
}

/**
 * Store the perspective-cropped derivative next to the original in the PRIVATE
 * ingress bucket, so publishPosterImage() picks it up instead of the original.
 */
export async function uploadPosterCropped(buffer: Buffer, uploadId: string): Promise<string> {
  const client = getStorageClient();
  const filePath = posterCroppedIngressPath(uploadId);

  const { error } = await client.storage.from(POSTER_BUCKET_NAME).upload(filePath, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });

  if (error) {
    throw new Error(`Poster cropped upload failed: ${error.message}`);
  }

  return filePath;
}

/**
 * True only for Supabase's "this object does not exist" error.
 *
 * Verified shape: `{ name: 'StorageApiError', status: 400, statusCode: '404',
 * message: 'Object not found' }`. Everything else - a timeout, a 5xx, an auth
 * failure - must NOT be read as absence: treating a transient blip as "no crop"
 * would publish the original while the row records the crop's dimensions.
 */
function isObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { statusCode?: unknown; message?: unknown };
  if (String(candidate.statusCode) === '404') return true;

  return typeof candidate.message === 'string' && /not found/i.test(candidate.message);
}

export interface PublishedPoster {
  publicUrl: string;
  /** Dimensions of the image ACTUALLY published, so the row can record them. */
  width: number | null;
  height: number | null;
}

/**
 * Copy an ingress poster into the public bucket and return its public URL and
 * dimensions. Called when the safety gate passes or an admin approves the
 * upload. Idempotent - re-publishing overwrites the public object.
 *
 * Publishes the cropped derivative when one exists, otherwise the original.
 * Resolving this at publish time rather than at upload time means the admin
 * approve path gets the crop for free.
 *
 * The dimensions come from measuring the chosen blob rather than from whatever
 * the caller believes it stored, so the row can never describe one image while
 * the bucket serves another.
 */
export async function publishPosterImage(uploadId: string): Promise<PublishedPoster> {
  const client = getStorageClient();
  const targetPath = posterPublicPath(uploadId);

  const { data: cropped, error: croppedError } = await client.storage
    .from(POSTER_BUCKET_NAME)
    .download(posterCroppedIngressPath(uploadId));

  // Most uploads have no crop, so a genuine 404 here is the ordinary case.
  if (croppedError && !isObjectNotFound(croppedError)) {
    throw new Error(`Poster publish failed (crop lookup): ${croppedError.message}`);
  }

  let data = cropped;

  if (!data) {
    const { data: original, error: downloadError } = await client.storage
      .from(POSTER_BUCKET_NAME)
      .download(posterIngressPath(uploadId));

    if (downloadError || !original) {
      throw new Error(`Poster publish failed (download): ${downloadError?.message ?? 'no data'}`);
    }

    data = original;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const probe = await sharp(buffer).metadata();

  const { error: uploadError } = await client.storage.from(BUCKET_NAME).upload(targetPath, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`Poster publish failed (upload): ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = client.storage.from(BUCKET_NAME).getPublicUrl(targetPath);

  return { publicUrl, width: probe.width ?? null, height: probe.height ?? null };
}

/**
 * Remove a poster's public copy - the takedown half of publishPosterImage.
 * The private ingress object is deliberately left in place as the audit trail.
 * Idempotent: Supabase's remove() treats a missing object as a no-op.
 */
export async function unpublishPosterImage(uploadId: string): Promise<void> {
  const client = getStorageClient();

  const { error } = await client.storage.from(BUCKET_NAME).remove([posterPublicPath(uploadId)]);

  if (error) {
    throw new Error(`Poster unpublish failed: ${error.message}`);
  }
}

/**
 * Short-lived signed URL for an unpublished poster, so the admin queue can
 * render flagged images that never became public.
 */
export async function getPosterSignedUrl(uploadId: string): Promise<string> {
  const client = getStorageClient();

  const { data, error } = await client.storage
    .from(POSTER_BUCKET_NAME)
    .createSignedUrl(posterIngressPath(uploadId), POSTER_SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    throw new Error(`Poster signed URL failed: ${error?.message ?? 'no data'}`);
  }

  return data.signedUrl;
}

/** Signed URLs for one upload's stored images. Null where the object is absent. */
export interface PosterImageUrls {
  original: string | null;
  cropped: string | null;
}

/**
 * Signed URLs for many uploads in ONE round trip - both the original and the
 * cropped derivative for each id.
 *
 * The per-row alternative was two storage calls per card, which on a full
 * moderation queue meant well over a hundred requests for a single page load.
 * A missing crop is the ordinary case and Supabase reports per-path errors, so
 * anything unresolved degrades to null rather than failing the page.
 */
export async function getPosterSignedUrls(
  uploadIds: string[]
): Promise<Map<string, PosterImageUrls>> {
  const results = new Map<string, PosterImageUrls>(
    uploadIds.map((id) => [id, { original: null, cropped: null }])
  );

  if (uploadIds.length === 0) return results;

  const client = getStorageClient();
  const paths = uploadIds.flatMap((id) => [posterIngressPath(id), posterCroppedIngressPath(id)]);

  const { data, error } = await client.storage
    .from(POSTER_BUCKET_NAME)
    .createSignedUrls(paths, POSTER_SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    console.error('[Posters] Bulk signed URL request failed:', error);
    return results;
  }

  const byPath = new Map<string, string>();
  for (const entry of data) {
    if (entry.error || !entry.path || !entry.signedUrl) continue;
    byPath.set(entry.path, entry.signedUrl);
  }

  for (const id of uploadIds) {
    results.set(id, {
      original: byPath.get(posterIngressPath(id)) ?? null,
      cropped: byPath.get(posterCroppedIngressPath(id)) ?? null,
    });
  }

  return results;
}
