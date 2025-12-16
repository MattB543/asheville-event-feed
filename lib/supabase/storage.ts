import { createClient } from '@supabase/supabase-js';

const BUCKET_NAME = 'event-images';

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

  const { error } = await client.storage
    .from(BUCKET_NAME)
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: { publicUrl } } = client.storage
    .from(BUCKET_NAME)
    .getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Check if a URL is a Supabase Storage URL (vs base64 or external).
 */
export function isStorageUrl(url: string): boolean {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return supabaseUrl ? url.startsWith(supabaseUrl) : false;
}

/**
 * Check if a URL is a base64 data URL.
 */
export function isBase64Url(url: string): boolean {
  return url.startsWith('data:image');
}
