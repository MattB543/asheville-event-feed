/**
 * Check if the "All Them Witches" duplicate would be caught by dedup logic
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { like } from 'drizzle-orm';

async function main() {
  // Get both "All Them Witches" events
  const witchesEvents = await db
    .select()
    .from(events)
    .where(like(events.title, '%All Them Witches%'));

  console.log('='.repeat(70));
  console.log('ALL THEM WITCHES EVENTS');
  console.log('='.repeat(70));
  console.log();

  for (const event of witchesEvents) {
    console.log(`Source: ${event.source}`);
    console.log(`Title: ${event.title}`);
    console.log(`Organizer: ${event.organizer}`);
    console.log(`Start Date: ${event.startDate.toISOString()}`);
    console.log(`Start (local): ${event.startDate.toLocaleString()}`);
    console.log(`Price: ${event.price}`);
    console.log(`URL: ${event.url}`);
    console.log();
  }

  // Check dedup criteria
  if (witchesEvents.length === 2) {
    const [e1, e2] = witchesEvents;

    console.log('='.repeat(70));
    console.log('DEDUP CRITERIA CHECK');
    console.log('='.repeat(70));
    console.log();

    // Same organizer?
    const org1 = (e1.organizer || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
    const org2 = (e2.organizer || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
    console.log(`Organizer 1: "${org1}"`);
    console.log(`Organizer 2: "${org2}"`);
    console.log(`Same organizer? ${org1 === org2}`);
    console.log();

    // Same time?
    const sameTime = (
      e1.startDate.getUTCFullYear() === e2.startDate.getUTCFullYear() &&
      e1.startDate.getUTCMonth() === e2.startDate.getUTCMonth() &&
      e1.startDate.getUTCDate() === e2.startDate.getUTCDate() &&
      e1.startDate.getUTCHours() === e2.startDate.getUTCHours() &&
      e1.startDate.getUTCMinutes() === e2.startDate.getUTCMinutes()
    );
    console.log(`Time 1: ${e1.startDate.toISOString()}`);
    console.log(`Time 2: ${e2.startDate.toISOString()}`);
    console.log(`Same time? ${sameTime}`);
    console.log();

    // Share word?
    const extractWords = (title: string) => {
      return new Set(
        title.toLowerCase()
          .replace(/[^\w\s-]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 3)
      );
    };
    const words1 = extractWords(e1.title);
    const words2 = extractWords(e2.title);
    const shared = [...words1].filter(w => words2.has(w));
    console.log(`Words in title 1: ${[...words1].join(', ')}`);
    console.log(`Words in title 2: ${[...words2].join(', ')}`);
    console.log(`Shared words: ${shared.join(', ')}`);
    console.log(`Share word? ${shared.length > 0}`);
    console.log();

    // Would dedup catch it?
    const wouldCatch = (org1 === org2) && sameTime && (shared.length > 0);
    console.log('='.repeat(70));
    console.log(`WOULD DEDUP CATCH THIS? ${wouldCatch ? 'YES' : 'NO'}`);
    console.log('='.repeat(70));

    if (!wouldCatch) {
      console.log('\nReason it would NOT be caught:');
      if (org1 !== org2) console.log('  - Different organizers');
      if (!sameTime) console.log('  - Different times');
      if (shared.length === 0) console.log('  - No shared words');
    }
  }
}

main().catch(console.error);
