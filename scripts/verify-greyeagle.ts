/**
 * Verify Grey Eagle events in database and check for overlaps
 *
 * Usage: npx tsx scripts/verify-greyeagle.ts
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(70));
  console.log('Verifying Grey Eagle Events in Database');
  console.log('='.repeat(70));
  console.log();

  // Get all Grey Eagle events
  const greyEagleEvents = await db
    .select()
    .from(events)
    .where(eq(events.source, 'GREY_EAGLE'))
    .orderBy(events.startDate);

  console.log(`Total Grey Eagle events in database: ${greyEagleEvents.length}`);
  console.log();

  // Stats
  const stats = {
    total: greyEagleEvents.length,
    withImage: greyEagleEvents.filter(e => e.imageUrl).length,
    withDescription: greyEagleEvents.filter(e => e.description).length,
    withTags: greyEagleEvents.filter(e => e.tags && e.tags.length > 0).length,
    withPrice: greyEagleEvents.filter(e => e.price && e.price !== 'Unknown').length,
    specialEvents: greyEagleEvents.filter(e => e.location?.includes('Special')).length,
    hidden: greyEagleEvents.filter(e => e.hidden).length,
  };

  console.log('Statistics:');
  console.log(`  - With image: ${stats.withImage} (${Math.round(stats.withImage/stats.total*100)}%)`);
  console.log(`  - With description: ${stats.withDescription} (${Math.round(stats.withDescription/stats.total*100)}%)`);
  console.log(`  - With tags: ${stats.withTags} (${Math.round(stats.withTags/stats.total*100)}%)`);
  console.log(`  - With price: ${stats.withPrice} (${Math.round(stats.withPrice/stats.total*100)}%)`);
  console.log(`  - Special events: ${stats.specialEvents}`);
  console.log(`  - Hidden: ${stats.hidden}`);
  console.log();

  // Check for overlaps with AVL Today
  console.log('='.repeat(70));
  console.log('OVERLAP CHECK WITH AVL TODAY');
  console.log('='.repeat(70));
  console.log();

  const avlTodayLiveMusic = await db
    .select()
    .from(events)
    .where(
      sql`${events.source} = 'AVL_TODAY' AND 'Live Music' = ANY(${events.tags})`
    );

  console.log(`AVL Today "Live Music" events: ${avlTodayLiveMusic.length}`);

  // Build AVL Today index by date
  const getDateKey = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

  const avlByDate = new Map<string, typeof avlTodayLiveMusic>();
  for (const event of avlTodayLiveMusic) {
    const dateKey = getDateKey(event.startDate);
    if (!avlByDate.has(dateKey)) {
      avlByDate.set(dateKey, []);
    }
    avlByDate.get(dateKey)!.push(event);
  }

  // Find overlaps
  const overlaps: Array<{
    greyEagle: typeof greyEagleEvents[0];
    avlToday: typeof avlTodayLiveMusic[0];
  }> = [];

  for (const geEvent of greyEagleEvents) {
    const dateKey = getDateKey(geEvent.startDate);
    const avlOnDate = avlByDate.get(dateKey) || [];

    for (const avlEvent of avlOnDate) {
      const geTitle = normalize(geEvent.title);
      const avlTitle = normalize(avlEvent.title);

      // Check containment or shared words
      let isMatch = false;
      if (geTitle.includes(avlTitle) || avlTitle.includes(geTitle)) {
        isMatch = true;
      } else {
        const geWords = geTitle.split(' ').filter(w => w.length > 3);
        const avlWords = avlTitle.split(' ').filter(w => w.length > 3);
        const shared = geWords.filter(w => avlWords.includes(w));
        if (shared.length >= 2 || (shared.length === 1 && shared[0].length > 5)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        overlaps.push({ greyEagle: geEvent, avlToday: avlEvent });
      }
    }
  }

  console.log(`Overlapping events found: ${overlaps.length}`);
  console.log();

  if (overlaps.length > 0) {
    for (const { greyEagle, avlToday } of overlaps) {
      console.log(`Date: ${getDateKey(greyEagle.startDate)}`);
      console.log(`  Grey Eagle: ${greyEagle.title}`);
      console.log(`  AVL Today:  ${avlToday.title}`);
      console.log();
    }
  }

  // Tag analysis
  console.log('='.repeat(70));
  console.log('TAG ANALYSIS');
  console.log('='.repeat(70));
  console.log();

  const tagCounts = new Map<string, number>();
  for (const event of greyEagleEvents) {
    if (event.tags) {
      for (const tag of event.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Most common tags:');
  for (const [tag, count] of sortedTags.slice(0, 15)) {
    console.log(`  ${tag}: ${count}`);
  }
  console.log();

  // Sample events
  console.log('='.repeat(70));
  console.log('SAMPLE EVENTS (first 10)');
  console.log('='.repeat(70));

  for (const event of greyEagleEvents.slice(0, 10)) {
    console.log();
    console.log(`${event.title}`);
    console.log(`  ID: ${event.id}`);
    console.log(`  Date: ${event.startDate.toLocaleDateString()} ${event.startDate.toLocaleTimeString()}`);
    console.log(`  Location: ${event.location}`);
    console.log(`  Price: ${event.price}`);
    console.log(`  Tags: ${event.tags?.join(', ') || 'None'}`);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('VERIFICATION COMPLETE');
  console.log('='.repeat(70));

  if (overlaps.length > 0) {
    console.log(`\nWARNING: ${overlaps.length} potential duplicates found with AVL Today.`);
    console.log('Run deduplication script to clean up.');
  } else {
    console.log('\nDATA IS CLEAN - No duplicates found!');
  }
}

main().catch(console.error);
