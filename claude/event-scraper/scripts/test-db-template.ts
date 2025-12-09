/**
 * Database Test Script Template
 *
 * This script loads scraped events from the debug folder and inserts them
 * into the database to verify data integrity.
 *
 * Usage:
 *   1. Run the main test script first to generate debug files
 *   2. Copy this file to scripts/test-yoursource-db.ts
 *   3. Update SOURCE_NAME and YOUR_SOURCE constant
 *   4. Run: npx tsx scripts/test-yoursource-db.ts
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION - Update these for your scraper
// ============================================================================

const SOURCE_NAME = 'yoursource';  // Must match debug folder name
const YOUR_SOURCE = 'YOUR_SOURCE'; // Must match source in types.ts

// ============================================================================
// DATABASE TEST
// ============================================================================

const DEBUG_DIR = path.join(process.cwd(), `debug-scraper-${SOURCE_NAME}`);
const finalEventsPath = path.join(DEBUG_DIR, '03-final-events.json');

async function main() {
  console.log('='.repeat(70));
  console.log(`DATABASE TEST - ${SOURCE_NAME.toUpperCase()}`);
  console.log('='.repeat(70));
  console.log();

  // Check debug files exist
  if (!fs.existsSync(finalEventsPath)) {
    console.error(`Error: Debug file not found: ${finalEventsPath}`);
    console.error('Run the main test script first to generate debug files.');
    process.exit(1);
  }

  // Load scraped events
  console.log(`Loading events from: ${finalEventsPath}`);
  const scrapedEvents = JSON.parse(fs.readFileSync(finalEventsPath, 'utf-8'));

  // Convert date strings back to Date objects
  for (const event of scrapedEvents) {
    event.startDate = new Date(event.startDate);
  }

  console.log(`Loaded ${scrapedEvents.length} events`);
  console.log();

  // Insert only first 5 events for testing
  const testEvents = scrapedEvents.slice(0, 5);
  console.log(`Inserting ${testEvents.length} test events...`);
  console.log();

  let inserted = 0;
  let failed = 0;

  for (const event of testEvents) {
    try {
      await db.insert(events).values({
        sourceId: event.sourceId,
        source: event.source,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        location: event.location,
        organizer: event.organizer,
        price: event.price,
        url: event.url,
        imageUrl: event.imageUrl,
        tags: [],
        timeUnknown: event.timeUnknown || false,
      }).onConflictDoUpdate({
        target: events.url,
        set: {
          title: event.title,
          startDate: event.startDate,
        },
      });
      console.log(`  ✓ ${event.title.slice(0, 55)}`);
      inserted++;
    } catch (err) {
      console.error(`  ✗ ${event.title.slice(0, 55)}`);
      console.error(`    Error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log();
  console.log(`Inserted: ${inserted}, Failed: ${failed}`);

  // Query back and verify
  console.log();
  console.log('='.repeat(70));
  console.log('VERIFICATION - Querying from database');
  console.log('='.repeat(70));
  console.log();

  const dbEvents = await db.select()
    .from(events)
    .where(eq(events.source, YOUR_SOURCE))
    .limit(10);

  console.log(`Found ${dbEvents.length} events with source='${YOUR_SOURCE}'`);
  console.log();

  for (const event of dbEvents) {
    const etDate = event.startDate.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    console.log(`  Title: ${event.title}`);
    console.log(`    ID: ${event.id}`);
    console.log(`    DB Date (raw): ${event.startDate}`);
    console.log(`    Date (Eastern): ${etDate}`);
    console.log(`    Price: ${event.price || 'N/A'}`);
    console.log(`    URL: ${event.url}`);
    console.log();
  }

  // Verification checks
  console.log('='.repeat(70));
  console.log('VERIFICATION CHECKS');
  console.log('='.repeat(70));
  console.log();

  let issues = 0;

  // Check for future dates (should all be in the future)
  const now = new Date();
  const pastEvents = dbEvents.filter(e => e.startDate < now);
  if (pastEvents.length > 0) {
    console.log(`⚠️  ${pastEvents.length} events have dates in the past`);
    issues++;
  } else {
    console.log('✓  All events are in the future');
  }

  // Check for midnight times (might indicate missing time)
  const midnightEvents = dbEvents.filter(e => {
    const et = new Date(e.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return et.getHours() === 0 && et.getMinutes() === 0;
  });
  if (midnightEvents.length > 0 && !dbEvents[0]?.timeUnknown) {
    console.log(`⚠️  ${midnightEvents.length} events are at midnight (missing time?)`);
    issues++;
  } else {
    console.log('✓  No unexpected midnight times');
  }

  // Check for missing required fields
  const missingUrl = dbEvents.filter(e => !e.url);
  if (missingUrl.length > 0) {
    console.log(`✗  ${missingUrl.length} events missing URL`);
    issues++;
  } else {
    console.log('✓  All events have URLs');
  }

  console.log();
  if (issues === 0) {
    console.log('✅ All verification checks passed!');
  } else {
    console.log(`⚠️  ${issues} issue(s) found - review above`);
  }

  // Cleanup instructions
  console.log();
  console.log('='.repeat(70));
  console.log('NEXT STEPS');
  console.log('='.repeat(70));
  console.log();
  console.log('1. Start dev server and verify in UI:');
  console.log('   npm run dev');
  console.log('   Then open http://localhost:3000 and search for a test event');
  console.log();
  console.log('2. When done testing, clean up test data:');
  console.log(`   DELETE FROM events WHERE source = '${YOUR_SOURCE}';`);
  console.log();
  console.log('   Or run:');
  console.log(`   npx tsx -e "import { db } from './lib/db'; import { events } from './lib/db/schema'; import { eq } from 'drizzle-orm'; await db.delete(events).where(eq(events.source, '${YOUR_SOURCE}')); console.log('Deleted')"`);
  console.log();
}

main().catch(err => {
  console.error('Database test failed:', err);
  process.exit(1);
});
