/**
 * Removes any tags from events that aren't in the ALLOWED_TAGS list.
 * This cleans up category names being used as tags and other invalid tags.
 */

import { db } from '../../lib/db';
import { sql } from 'drizzle-orm';

// Must match the ALLOWED_TAGS in lib/ai/tagAndSummarize.ts
const ALLOWED_TAGS = [
  // Entertainment
  'Live Music', 'Comedy', 'Theater & Film', 'Dance', 'Trivia',
  // Food & Drink
  'Dining', 'Beer', 'Wine & Spirits', 'Food Classes',
  // Activities
  'Art', 'Crafts', 'Fitness', 'Wellness', 'Spiritual', 'Outdoors', 'Tours', 'Gaming',
  'Sports', 'Basketball', 'Education', 'Book Club',
  // Audience/Social
  'Family', 'Dating', 'Networking', 'Nightlife', 'LGBTQ+', 'Pets',
  'Community', 'Support Groups',
  // Seasonal
  'Holiday', 'Markets',
];

async function main() {
  console.log('Finding invalid tags (not in ALLOWED_TAGS)...\n');

  // Find all current tags
  const allTagsResult = await db.execute(sql`
    SELECT unnest(tags) as tag, COUNT(*) as count
    FROM events
    WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
    GROUP BY tag
    ORDER BY count DESC
  `);

  const invalidTags: { tag: string; count: number }[] = [];

  for (const row of allTagsResult) {
    const r = row as { tag: string; count: number };
    if (!ALLOWED_TAGS.includes(r.tag)) {
      invalidTags.push({ tag: r.tag, count: Number(r.count) });
    }
  }

  if (invalidTags.length === 0) {
    console.log('No invalid tags found. Database is clean!');
    process.exit(0);
  }

  console.log(`Found ${invalidTags.length} invalid tags to remove:`);
  for (const { tag, count } of invalidTags) {
    console.log(`  - "${tag}" (${count} events)`);
  }

  console.log('\nRemoving invalid tags from events...');

  for (const { tag } of invalidTags) {
    await db.execute(sql`
      UPDATE events
      SET tags = array_remove(tags, ${tag})
      WHERE tags @> ARRAY[${tag}]::text[]
    `);
  }

  console.log('\nDone! Invalid tags have been removed.');

  // Verify
  const verifyResult = await db.execute(sql`
    SELECT unnest(tags) as tag, COUNT(*) as count
    FROM events
    WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
    GROUP BY tag
    ORDER BY count DESC
  `);

  console.log(`\nRemaining tags (${verifyResult.length} total):`);
  for (const row of verifyResult) {
    const r = row as { tag: string; count: number };
    console.log(`  ${r.tag}: ${r.count}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
