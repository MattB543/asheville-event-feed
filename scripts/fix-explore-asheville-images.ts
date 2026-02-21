/**
 * Backfill script: Fix broken Explore Asheville image URLs.
 *
 * The API returns image URLs with %3A (encoded colon) and no file extension,
 * which 404 on their server. The working URLs use "-" instead and end with .jpg.
 *
 * Usage: npx tsx scripts/fix-explore-asheville-images.ts [--dry-run]
 */

import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

function fixImageUrl(url: string): string {
  let fixed = url.replace(/%3A/gi, '-');
  if (!/\.(jpe?g|png|gif|webp|avif)$/i.test(fixed)) {
    fixed += '.jpg';
  }
  return fixed;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('=== DRY RUN (no changes will be made) ===\n');

  // Find all EXPLORE_ASHEVILLE events with image URLs containing %3A or missing extension
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      imageUrl: events.imageUrl,
    })
    .from(events)
    .where(
      and(
        eq(events.source, 'EXPLORE_ASHEVILLE'),
        sql`${events.imageUrl} IS NOT NULL`,
        sql`${events.imageUrl} != ''`,
        sql`${events.imageUrl} != '/asheville-default.jpg'`,
        // Match URLs that contain %3A or don't end with an image extension
        sql`(${events.imageUrl} LIKE '%\%3A%' OR ${events.imageUrl} NOT SIMILAR TO '%\.(jpg|jpeg|png|gif|webp|avif)')`
      )
    );

  console.log(`Found ${rows.length} EXPLORE_ASHEVILLE events with fixable image URLs.\n`);

  if (rows.length === 0) {
    console.log('Nothing to fix!');
    process.exit(0);
  }

  let fixed = 0;
  let skipped = 0;

  for (const row of rows) {
    const oldUrl = row.imageUrl!;
    const newUrl = fixImageUrl(oldUrl);

    if (oldUrl === newUrl) {
      skipped++;
      continue;
    }

    console.log(`[${fixed + 1}] ${row.title.slice(0, 50)}`);
    console.log(`  OLD: ${oldUrl.slice(-80)}`);
    console.log(`  NEW: ${newUrl.slice(-80)}`);

    if (!dryRun) {
      await db
        .update(events)
        .set({ imageUrl: newUrl, updatedAt: new Date() })
        .where(eq(events.id, row.id));
    }

    fixed++;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Fixed: ${fixed} | Skipped (already OK): ${skipped}`);
  if (dryRun) console.log('\nRe-run without --dry-run to apply changes.');

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
