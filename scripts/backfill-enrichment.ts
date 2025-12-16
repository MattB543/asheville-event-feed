/**
 * Backfill Enrichment Script
 *
 * Processes existing events with missing price or timeUnknown data.
 * First tries regex extraction, then falls back to AI enrichment.
 *
 * Usage:
 *   npx tsx scripts/backfill-enrichment.ts              # Process all events needing enrichment
 *   npx tsx scripts/backfill-enrichment.ts --limit 10   # Process only 10 events
 *   npx tsx scripts/backfill-enrichment.ts --dry-run    # Preview without saving
 *   npx tsx scripts/backfill-enrichment.ts --source EXPLORE_ASHEVILLE  # Only one source
 */

import '../lib/config/env';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, eq } from 'drizzle-orm';
import { tryExtractPrice } from '@/lib/utils/extractPrice';
import { tryExtractAndApplyTime } from '@/lib/utils/extractTime';
import { enrichEventData } from '@/lib/ai/dataEnrichment';

interface EventToEnrich {
  id: string;
  source: string;
  title: string;
  description: string | null;
  organizer: string | null;
  price: string | null;
  timeUnknown: boolean | null;
  startDate: Date;
  url: string;
}

// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1], 10) : 100;
const sourceIndex = args.indexOf('--source');
const sourceFilter = sourceIndex >= 0 ? args[sourceIndex + 1] : null;

async function backfillEnrichment() {
  console.log('\n=== BACKFILL ENRICHMENT ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes saved)' : 'LIVE'}`);
  console.log(`Limit: ${limit} events`);
  if (sourceFilter) console.log(`Source filter: ${sourceFilter}`);
  console.log('');

  const nowISO = new Date().toISOString();

  // Build query for events needing enrichment
  let query = sql`
    SELECT id, source, title, description, organizer, price, time_unknown, start_date, url
    FROM events
    WHERE start_date >= ${nowISO}::timestamp
      AND (
        price IS NULL
        OR price = 'Unknown'
        OR time_unknown = true
      )
  `;

  if (sourceFilter) {
    query = sql`
      SELECT id, source, title, description, organizer, price, time_unknown, start_date, url
      FROM events
      WHERE start_date >= ${nowISO}::timestamp
        AND source = ${sourceFilter}
        AND (
          price IS NULL
          OR price = 'Unknown'
          OR time_unknown = true
        )
    `;
  }

  const results = await db.execute(query);
  const rows = (results as { rows?: unknown[] }).rows || (results as unknown[]);
  const eventsToProcess = (rows as Record<string, unknown>[]).slice(0, limit).map(row => ({
    id: row.id as string,
    source: row.source as string,
    title: row.title as string,
    description: row.description as string | null,
    organizer: row.organizer as string | null,
    price: row.price as string | null,
    timeUnknown: row.time_unknown as boolean,
    startDate: new Date(row.start_date as string),
    url: row.url as string,
  })) as EventToEnrich[];

  console.log(`Found ${rows.length} events needing enrichment, processing ${eventsToProcess.length}...\n`);

  let regexPriceExtracted = 0;
  let regexTimeExtracted = 0;
  let aiPriceExtracted = 0;
  let aiTimeExtracted = 0;
  let unchanged = 0;
  let errors = 0;

  for (let i = 0; i < eventsToProcess.length; i++) {
    const event = eventsToProcess[i];
    const progress = `[${i + 1}/${eventsToProcess.length}]`;

    console.log(`${progress} Processing: ${event.title}`);
    console.log(`    Source: ${event.source}`);
    console.log(`    Current price: ${event.price || 'null'}`);
    console.log(`    Time unknown: ${event.timeUnknown}`);

    let newPrice: string | undefined;
    let newStartDate: Date | undefined;
    let timeUpdated = false;

    // Step 1: Try regex extraction for price
    const needsPrice = !event.price || event.price === 'Unknown';
    if (needsPrice) {
      const extractedPrice = tryExtractPrice(event.description, event.price, event.organizer);
      if (extractedPrice !== 'Unknown') {
        newPrice = extractedPrice;
        regexPriceExtracted++;
        console.log(`    ✅ Regex extracted price: ${newPrice}`);
      }
    }

    // Step 2: Try regex extraction for time
    if (event.timeUnknown) {
      const timeResult = tryExtractAndApplyTime(event.startDate, event.description);
      if (timeResult.timeUpdated) {
        newStartDate = timeResult.date;
        timeUpdated = true;
        regexTimeExtracted++;
        console.log(`    ✅ Regex extracted time: ${timeResult.extractedTime}`);
      }
    }

    // Step 3: If regex failed and we still need data, try AI
    const stillNeedsPrice = needsPrice && !newPrice;
    const stillNeedsTime = event.timeUnknown && !timeUpdated;

    if (stillNeedsPrice || stillNeedsTime) {
      console.log(`    🤖 Trying AI enrichment...`);

      try {
        const aiResult = await enrichEventData({
          title: event.title,
          description: event.description,
          url: event.url,
          organizer: event.organizer,
          currentPrice: newPrice || event.price,
          timeUnknown: stillNeedsTime || undefined,
          currentStartDate: event.startDate,
        });

        if (aiResult) {
          if (aiResult.price && stillNeedsPrice) {
            newPrice = aiResult.price;
            aiPriceExtracted++;
            console.log(`    ✅ AI extracted price: ${newPrice}`);
          }
          if (aiResult.updatedStartDate && stillNeedsTime) {
            newStartDate = aiResult.updatedStartDate;
            timeUpdated = true;
            aiTimeExtracted++;
            console.log(`    ✅ AI extracted time: ${aiResult.time}`);
          }
        } else {
          console.log(`    ❌ AI extraction returned no results`);
        }

        // Rate limit between AI calls
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        console.log(`    ❌ AI error: ${error}`);
        errors++;
      }
    }

    // Step 4: Update database if we have new data
    if (newPrice || newStartDate) {
      if (!dryRun) {
        const updates: { price?: string; startDate?: Date; timeUnknown?: boolean } = {};
        if (newPrice) updates.price = newPrice;
        if (newStartDate) {
          updates.startDate = newStartDate;
          updates.timeUnknown = false;
        }

        await db
          .update(events)
          .set(updates)
          .where(eq(events.id, event.id));

        console.log(`    💾 Saved to database`);
      } else {
        console.log(`    [DRY RUN] Would save: price=${newPrice}, startDate=${newStartDate?.toISOString()}`);
      }
    } else {
      unchanged++;
      console.log(`    ⏭️ No changes`);
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('BACKFILL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${eventsToProcess.length}`);
  console.log(`Regex price extracted: ${regexPriceExtracted}`);
  console.log(`Regex time extracted: ${regexTimeExtracted}`);
  console.log(`AI price extracted: ${aiPriceExtracted}`);
  console.log(`AI time extracted: ${aiTimeExtracted}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Errors: ${errors}`);
  console.log('');

  if (dryRun) {
    console.log('This was a DRY RUN. No changes were saved.');
    console.log('Run without --dry-run to save changes.');
  }
}

backfillEnrichment()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
