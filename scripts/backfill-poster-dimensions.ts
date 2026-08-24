/**
 * Fill in image_width/image_height for poster uploads that predate those
 * columns, by measuring the stored JPEG.
 *
 * Without dimensions the masonry wall cannot reserve a tile's space before the
 * image loads, so those posters are the only ones that shift the layout.
 *
 * Run with: npx tsx scripts/backfill-poster-dimensions.ts
 */

import 'dotenv/config';
import sharp from 'sharp';
import { eq, isNull, or } from 'drizzle-orm';
import { db } from '../lib/db';
import { posterUploads } from '../lib/db/schema';
import { getPosterSignedUrl } from '../lib/supabase/storage';

async function measure(url: string): Promise<{ width: number; height: number } | null> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed: ${response.status}`);

  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  return metadata.width && metadata.height
    ? { width: metadata.width, height: metadata.height }
    : null;
}

async function main() {
  const rows = await db
    .select({
      id: posterUploads.id,
      publicImageUrl: posterUploads.publicImageUrl,
    })
    .from(posterUploads)
    .where(or(isNull(posterUploads.imageWidth), isNull(posterUploads.imageHeight)));

  console.log(`${rows.length} upload(s) missing dimensions`);

  let filled = 0;

  for (const row of rows) {
    try {
      // Published uploads have a public URL; everything else is still only in
      // the private ingress bucket and needs a signed one.
      const url = row.publicImageUrl ?? (await getPosterSignedUrl(row.id));
      if (!url) {
        console.warn(`  ${row.id}: no readable image`);
        continue;
      }

      const size = await measure(url);
      if (!size) {
        console.warn(`  ${row.id}: could not read dimensions`);
        continue;
      }

      await db
        .update(posterUploads)
        .set({ imageWidth: size.width, imageHeight: size.height })
        .where(eq(posterUploads.id, row.id));

      filled++;
      console.log(`  ${row.id}: ${size.width}x${size.height}`);
    } catch (error) {
      console.warn(`  ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`Filled ${filled}/${rows.length}.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
