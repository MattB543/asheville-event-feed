/**
 * Test Regex Extraction Script
 *
 * Tests the regex price and time extraction utilities on 50 random events
 * that have Unknown price or timeUnknown=true.
 *
 * This allows manual sanity checking of the extraction results.
 *
 * Usage: npx tsx scripts/maintenance/test-regex-extraction.ts
 */

import '../../lib/config/env';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { sql } from 'drizzle-orm';
import { extractPriceFromText, isTicketedEvent, isTypicallyTicketedVenue } from '../../lib/utils/parsers';
import { extractTimeFromText } from '../../lib/utils/parsers';

interface TestEvent {
  id: string;
  source: string;
  title: string;
  description: string | null;
  organizer: string | null;
  price: string | null;
  timeUnknown: boolean | null;
  url: string;
}

async function testPriceExtraction() {
  console.log('\n' + '='.repeat(80));
  console.log('PRICE EXTRACTION TEST (50 events with Unknown price)');
  console.log('='.repeat(80) + '\n');

  const nowISO = new Date().toISOString();

  // Get 50 random events with Unknown price
  const unknownPriceEvents = await db
    .select({
      id: events.id,
      source: events.source,
      title: events.title,
      description: events.description,
      organizer: events.organizer,
      price: events.price,
      timeUnknown: events.timeUnknown,
      url: events.url,
    })
    .from(events)
    .where(sql`(price IS NULL OR price = 'Unknown') AND start_date >= ${nowISO}::timestamp`)
    .orderBy(sql`RANDOM()`)
    .limit(50) as TestEvent[];

  console.log(`Found ${unknownPriceEvents.length} events with Unknown price\n`);

  let extractedCount = 0;
  let ticketedCount = 0;
  let freeCount = 0;
  let noExtractCount = 0;

  for (const ev of unknownPriceEvents) {
    const result = extractPriceFromText(ev.description || '', ev.organizer);
    const isTicketed = isTicketedEvent(ev.description || '');
    const isTicketedVenue = isTypicallyTicketedVenue(ev.organizer);

    console.log('-'.repeat(80));
    console.log(`[${ev.source}] ${ev.title}`);
    console.log(`Organizer: ${ev.organizer || '(none)'}`);
    console.log(`URL: ${ev.url}`);
    console.log(`Description: ${(ev.description || '').slice(0, 200)}${(ev.description?.length || 0) > 200 ? '...' : ''}`);
    console.log('');

    if (result) {
      console.log(`✅ EXTRACTED: "${result.price}" (${result.confidence} confidence)`);
      console.log(`   Pattern: ${result.matchedPattern}`);

      if (result.price === 'Free') {
        freeCount++;
      } else if (result.price === 'Ticketed') {
        ticketedCount++;
      } else {
        extractedCount++;
      }
    } else {
      console.log(`❌ NO EXTRACTION`);
      console.log(`   isTicketedEvent: ${isTicketed}`);
      console.log(`   isTypicallyTicketedVenue: ${isTicketedVenue}`);
      noExtractCount++;
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('PRICE EXTRACTION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total tested: ${unknownPriceEvents.length}`);
  console.log(`Extracted price: ${extractedCount} (${((extractedCount / unknownPriceEvents.length) * 100).toFixed(1)}%)`);
  console.log(`Detected Free: ${freeCount} (${((freeCount / unknownPriceEvents.length) * 100).toFixed(1)}%)`);
  console.log(`Detected Ticketed: ${ticketedCount} (${((ticketedCount / unknownPriceEvents.length) * 100).toFixed(1)}%)`);
  console.log(`No extraction: ${noExtractCount} (${((noExtractCount / unknownPriceEvents.length) * 100).toFixed(1)}%)`);
  console.log('');
}

async function testTimeExtraction() {
  console.log('\n' + '='.repeat(80));
  console.log('TIME EXTRACTION TEST (events with timeUnknown=true)');
  console.log('='.repeat(80) + '\n');

  const nowISO = new Date().toISOString();

  // Get all events with timeUnknown=true
  const unknownTimeEvents = await db
    .select({
      id: events.id,
      source: events.source,
      title: events.title,
      description: events.description,
      organizer: events.organizer,
      price: events.price,
      timeUnknown: events.timeUnknown,
      url: events.url,
    })
    .from(events)
    .where(sql`time_unknown = true AND start_date >= ${nowISO}::timestamp`)
    .limit(50) as TestEvent[];

  console.log(`Found ${unknownTimeEvents.length} events with timeUnknown=true\n`);

  let extractedCount = 0;

  for (const ev of unknownTimeEvents) {
    const result = extractTimeFromText(ev.description || '');

    console.log('-'.repeat(80));
    console.log(`[${ev.source}] ${ev.title}`);
    console.log(`URL: ${ev.url}`);
    console.log(`Description: ${(ev.description || '').slice(0, 300)}${(ev.description?.length || 0) > 300 ? '...' : ''}`);
    console.log('');

    if (result) {
      const timeStr = `${result.hour.toString().padStart(2, '0')}:${result.minute.toString().padStart(2, '0')}`;
      console.log(`✅ EXTRACTED: ${timeStr} (${result.confidence} confidence)`);
      console.log(`   Pattern: ${result.matchedPattern}`);
      console.log(`   Raw match: "${result.rawMatch}"`);
      extractedCount++;
    } else {
      console.log(`❌ NO EXTRACTION`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('TIME EXTRACTION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total tested: ${unknownTimeEvents.length}`);
  console.log(`Extracted time: ${extractedCount} (${unknownTimeEvents.length > 0 ? ((extractedCount / unknownTimeEvents.length) * 100).toFixed(1) : 0}%)`);
  console.log('');
}

async function main() {
  await testPriceExtraction();
  await testTimeExtraction();

  console.log('\n=== TEST COMPLETE ===\n');
  console.log('Review the output above to verify extraction accuracy.');
  console.log('Look for:');
  console.log('  - False positives (extracted wrong price)');
  console.log('  - False negatives (missed a price that was in the text)');
  console.log('  - Incorrect "Ticketed" detection');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
