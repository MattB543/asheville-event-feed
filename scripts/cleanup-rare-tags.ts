/**
 * Removes tags that have been used 3 times or less from all events.
 * This helps clean up overly specific or mistaken tags.
 */

import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Finding tags used 3 times or less...\n');

  // Find all tags with ≤3 uses
  const rareTagsResult = await db.execute(sql`
    SELECT unnest(tags) as tag, COUNT(*) as count
    FROM events
    WHERE tags IS NOT NULL AND array_length(tags, 1) > 0
    GROUP BY tag
    HAVING COUNT(*) <= 3
    ORDER BY count DESC, tag ASC
  `);

  const rareTags = rareTagsResult.rows.map((r) => (r as { tag: string }).tag);

  if (rareTags.length === 0) {
    console.log('No rare tags found. Nothing to clean up.');
    process.exit(0);
  }

  console.log(`Found ${rareTags.length} tags to remove:`);
  for (const tag of rareTags) {
    console.log(`  - ${tag}`);
  }

  console.log('\nRemoving rare tags from events...');

  // Remove each rare tag from all events
  // Using array_remove to remove the tag from the tags array
  for (const tag of rareTags) {
    await db.execute(sql`
      UPDATE events
      SET tags = array_remove(tags, ${tag})
      WHERE tags @> ARRAY[${tag}]::text[]
    `);
  }

  console.log('\nDone! Rare tags have been removed.');

  // Show how many events now have 0, 1, or 2 tags
  const tagCountResult = await db.execute(sql`
    SELECT
      CASE
        WHEN tags IS NULL OR array_length(tags, 1) IS NULL THEN 0
        ELSE array_length(tags, 1)
      END as tag_count,
      COUNT(*) as event_count
    FROM events
    GROUP BY tag_count
    ORDER BY tag_count
  `);

  console.log('\nEvents by tag count:');
  for (const row of tagCountResult.rows) {
    const r = row as { tag_count: number; event_count: number };
    console.log(`  ${r.tag_count} tags: ${r.event_count} events`);
  }

  // Count events with ≤2 tags (candidates for re-tagging)
  const retagCandidates = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM events
    WHERE tags IS NULL
       OR array_length(tags, 1) IS NULL
       OR array_length(tags, 1) <= 2
  `);

  const count = (retagCandidates.rows[0] as { count: number }).count;
  console.log(`\n${count} events have ≤2 tags and are candidates for re-tagging.`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
