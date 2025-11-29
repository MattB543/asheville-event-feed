/**
 * Check overlap between Orange Peel events and AVL Today "Live Music" events
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, sql } from 'drizzle-orm';

async function main() {
  // Get all Orange Peel events
  const orangePeelEvents = await db
    .select()
    .from(events)
    .where(eq(events.source, 'ORANGE_PEEL'));

  // Get all AVL Today events with "Live Music" tag
  const avlTodayLiveMusic = await db
    .select()
    .from(events)
    .where(
      sql`${events.source} = 'AVL_TODAY' AND 'Live Music' = ANY(${events.tags})`
    );

  console.log('='.repeat(70));
  console.log('OVERLAP ANALYSIS');
  console.log('='.repeat(70));
  console.log();
  console.log(`Orange Peel events: ${orangePeelEvents.length}`);
  console.log(`AVL Today "Live Music" events: ${avlTodayLiveMusic.length}`);
  console.log();

  // Normalize function for comparison
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

  // Get date key
  const getDateKey = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Build AVL Today index by date
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
    orangePeel: typeof orangePeelEvents[0];
    avlToday: typeof avlTodayLiveMusic[0];
    matchType: string;
  }> = [];

  for (const opEvent of orangePeelEvents) {
    const dateKey = getDateKey(opEvent.startDate);
    const avlOnDate = avlByDate.get(dateKey) || [];

    for (const avlEvent of avlOnDate) {
      const opTitle = normalize(opEvent.title);
      const avlTitle = normalize(avlEvent.title);

      // Check for matches
      let matchType: string | null = null;

      // Exact match
      if (opTitle === avlTitle) {
        matchType = 'exact';
      }
      // Containment
      else if (opTitle.includes(avlTitle) || avlTitle.includes(opTitle)) {
        matchType = 'contains';
      }
      // Shared significant words
      else {
        const opWords = opTitle.split(' ').filter(w => w.length > 3);
        const avlWords = avlTitle.split(' ').filter(w => w.length > 3);
        const shared = opWords.filter(w => avlWords.includes(w));
        if (shared.length >= 2 || (shared.length === 1 && shared[0].length > 5)) {
          matchType = `shared words: ${shared.join(', ')}`;
        }
      }

      if (matchType) {
        overlaps.push({ orangePeel: opEvent, avlToday: avlEvent, matchType });
      }
    }
  }

  console.log('='.repeat(70));
  console.log(`OVERLAPPING EVENTS: ${overlaps.length}`);
  console.log('='.repeat(70));
  console.log();

  for (const { orangePeel, avlToday, matchType } of overlaps) {
    console.log(`Date: ${getDateKey(orangePeel.startDate)}`);
    console.log(`  Orange Peel: ${orangePeel.title}`);
    console.log(`  AVL Today:   ${avlToday.title}`);
    console.log(`  Match type:  ${matchType}`);
    console.log(`  OP URL: ${orangePeel.url.slice(0, 60)}...`);
    console.log(`  AVL URL: ${avlToday.url.slice(0, 60)}...`);
    console.log();
  }

  // Summary
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Orange Peel events: ${orangePeelEvents.length}`);
  console.log(`AVL Today Live Music events: ${avlTodayLiveMusic.length}`);
  console.log(`Overlapping events: ${overlaps.length}`);
  console.log(`Overlap percentage (of OP): ${Math.round(overlaps.length / orangePeelEvents.length * 100)}%`);
}

main().catch(console.error);
