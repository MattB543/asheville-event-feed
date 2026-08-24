import { createClient } from '@supabase/supabase-js';

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
 * Copy an ingress poster into the public bucket and return its public URL.
 * Called when the safety gate passes or an admin approves the upload.
 * Idempotent - re-publishing overwrites the public object.
 */
export async function publishPosterImage(uploadId: string): Promise<string> {
  const client = getStorageClient();
  const sourcePath = posterIngressPath(uploadId);
  const targetPath = posterPublicPath(uploadId);

  const { data, error: downloadError } = await client.storage
    .from(POSTER_BUCKET_NAME)
    .download(sourcePath);

  if (downloadError || !data) {
    throw new Error(`Poster publish failed (download): ${downloadError?.message ?? 'no data'}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());

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

  return publicUrl;
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
