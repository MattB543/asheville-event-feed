/**
 * Migration script: Move base64 images from database to Supabase Storage
 *
 * This script finds all events with base64 data URLs in the imageUrl field,
 * uploads them to Supabase Storage, and updates the database with the public URL.
 *
 * Usage: npx tsx scripts/migrate-images-to-storage.ts
 *
 * Prerequisites:
 * 1. Create a public bucket named "event-images" in Supabase Storage
 * 2. Set SUPABASE_SERVICE_ROLE_KEY in your .env file
 */

import 'dotenv/config';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { like, eq } from 'drizzle-orm';
import { uploadEventImage } from '@/lib/supabase/storage';

async function migrateImages() {
  console.log('[Migration] Starting base64 image migration to Supabase Storage...');

  // Check environment
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Migration] Error: SUPABASE_SERVICE_ROLE_KEY is not set');
    process.exit(1);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('[Migration] Error: NEXT_PUBLIC_SUPABASE_URL is not set');
    process.exit(1);
  }

  // Find all events with base64 images
  const base64Events = await db
    .select({ id: events.id, title: events.title, imageUrl: events.imageUrl })
    .from(events)
    .where(like(events.imageUrl, 'data:image%'));

  console.log(`[Migration] Found ${base64Events.length} events with base64 images`);

  if (base64Events.length === 0) {
    console.log('[Migration] No base64 images to migrate. Done!');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const event of base64Events) {
    try {
      if (!event.imageUrl) continue;

      // Extract base64 data from data URL
      // Format: data:image/jpeg;base64,/9j/4AAQ...
      const matches = event.imageUrl.match(/^data:image\/\w+;base64,(.+)$/);
      if (!matches || !matches[1]) {
        console.warn(`[Migration] Invalid data URL format for event ${event.id}`);
        failed++;
        continue;
      }

      const base64Data = matches[1];
      const buffer = Buffer.from(base64Data, 'base64');

      // Upload to storage using event ID as filename
      const publicUrl = await uploadEventImage(buffer, event.id);

      // Update event with new URL
      await db
        .update(events)
        .set({ imageUrl: publicUrl })
        .where(eq(events.id, event.id));

      success++;
      console.log(`[Migration] Migrated: ${event.title.substring(0, 50)}...`);
    } catch (error) {
      failed++;
      console.error(
        `[Migration] Failed to migrate event ${event.id}:`,
        error instanceof Error ? error.message : error
      );
    }

    // Rate limit: 100ms between uploads
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('[Migration] ════════════════════════════════════════════════');
  console.log(`[Migration] Complete: ${success} succeeded, ${failed} failed`);
  console.log('[Migration] ════════════════════════════════════════════════');
}

migrateImages()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Migration] Fatal error:', err);
    process.exit(1);
  });
