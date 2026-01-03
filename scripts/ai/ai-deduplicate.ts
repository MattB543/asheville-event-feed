/**
 * AI-powered deduplication script.
 *
 * Uses Azure OpenAI (GPT-5-mini) to identify duplicate events that
 * rule-based methods might miss.
 *
 * Usage:
 *   npx tsx scripts/ai/ai-deduplicate.ts           # Dry run (default)
 *   npx tsx scripts/ai/ai-deduplicate.ts --apply   # Actually delete duplicates
 *   npx tsx scripts/ai/ai-deduplicate.ts --days 7  # Only process next 7 days
 *
 * Requires AZURE_KEY_1 and AZURE_ENDPOINT in .env
 */

import '../../lib/config/env';

import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { inArray, gte } from 'drizzle-orm';
import {
  runAIDeduplication,
  isAIDeduplicationAvailable,
  EventForAIDedup,
} from '../../lib/ai/aiDeduplication';

// Parse command line arguments
const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');
const daysArg = args.find((a) => a.startsWith('--days='));
const maxDays = daysArg ? parseInt(daysArg.split('=')[1], 10) : undefined;

async function main() {
  console.log('='.repeat(80));
  console.log('AI-POWERED DEDUPLICATION');
  console.log('='.repeat(80));
  console.log();

  // Check if AI is available
  if (!isAIDeduplicationAvailable()) {
    console.error('ERROR: Azure OpenAI not configured.');
    console.error('Please set AZURE_KEY_1 and AZURE_ENDPOINT in your .env file.');
    process.exit(1);
  }

  console.log(`Mode: ${applyChanges ? 'APPLY CHANGES' : 'DRY RUN (no changes)'}`);
  if (maxDays) {
    console.log(`Days limit: ${maxDays}`);
  }
  console.log();

  // Fetch all future events (no point checking past events)
  const now = new Date();
  const allEvents = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      organizer: events.organizer,
      location: events.location,
      startDate: events.startDate,
      price: events.price,
      source: events.source,
    })
    .from(events)
    .where(gte(events.startDate, now));

  console.log(`Fetched ${allEvents.length} future events from database.`);
  console.log();

  // Convert to AI dedup format
  const eventsForAI: EventForAIDedup[] = allEvents.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    organizer: e.organizer,
    location: e.location,
    startDate: e.startDate,
    price: e.price,
    source: e.source,
  }));

  // Run AI deduplication
  console.log('Running AI deduplication...');
  console.log('-'.repeat(40));

  const result = await runAIDeduplication(eventsForAI, {
    maxDays,
    delayBetweenDays: 500,
    verbose: true,
  });

  console.log();
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log(`Days processed:      ${result.daysProcessed}`);
  console.log(`Duplicates found:    ${result.totalDuplicatesFound}`);
  console.log(`Events to remove:    ${result.idsToRemove.length}`);
  console.log(`Total tokens used:   ${result.totalTokensUsed}`);

  if (result.errors.length > 0) {
    console.log();
    console.log('Errors:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }

  if (result.idsToRemove.length === 0) {
    console.log();
    console.log('No duplicates found by AI.');
    process.exit(0);
  }

  // Show details of what would be removed
  console.log();
  console.log('-'.repeat(40));
  console.log('EVENTS TO REMOVE');
  console.log('-'.repeat(40));

  for (const dayResult of result.dayResults) {
    if (dayResult.groups.length === 0) continue;

    console.log();
    console.log(`Date: ${dayResult.date}`);
    for (const group of dayResult.groups) {
      for (const removeId of group.remove) {
        const ev = allEvents.find((e) => e.id === removeId);
        console.log(`  [${ev?.source}] "${ev?.title}"`);
        console.log(
          `    Organizer: ${ev?.organizer || 'N/A'} | Location: ${ev?.location || 'N/A'} | Price: ${ev?.price || 'N/A'}`
        );
      }
      console.log(`  Reason: ${group.reason}`);
      console.log();
    }
  }

  // Apply changes if requested
  if (applyChanges) {
    console.log();
    console.log('='.repeat(80));
    console.log('APPLYING CHANGES');
    console.log('='.repeat(80));
    console.log();

    // Delete in batches
    const batchSize = 50;
    let deleted = 0;

    for (let i = 0; i < result.idsToRemove.length; i += batchSize) {
      const batch = result.idsToRemove.slice(i, i + batchSize);
      await db.delete(events).where(inArray(events.id, batch));
      deleted += batch.length;
      console.log(`Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} events`);
    }

    console.log();
    console.log(`Successfully deleted ${deleted} duplicate events.`);

    // Verify
    const remainingCount = await db.select({ id: events.id }).from(events);
    console.log(`Events remaining in database: ${remainingCount.length}`);
  } else {
    console.log();
    console.log('='.repeat(80));
    console.log('DRY RUN COMPLETE - No changes made');
    console.log('='.repeat(80));
    console.log();
    console.log('To apply these changes, run:');
    console.log('  npx tsx scripts/ai/ai-deduplicate.ts --apply');
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
