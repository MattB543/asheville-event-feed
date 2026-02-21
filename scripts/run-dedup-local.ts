/**
 * Run both rule-based and AI deduplication locally.
 * Usage: npx tsx scripts/run-dedup-local.ts
 */
import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { findDuplicates, getIdsToRemove, getDescriptionUpdates } from '../lib/utils/deduplication';
import {
  runAIDeduplication,
  isAIDeduplicationAvailable,
  type EventForAIDedup,
} from '../lib/ai/aiDeduplication';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Running Deduplication (Rule-Based + AI)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Fetch all events
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
      createdAt: events.createdAt,
    })
    .from(events);

  console.log(`Total events in DB: ${allEvents.length}\n`);

  // ── Step 1: Rule-based dedup ──────────────────────────────────────────
  console.log('── Step 1: Rule-Based Deduplication ──────────────────────────\n');

  const duplicateGroups = findDuplicates(allEvents);
  const idsToRemove = getIdsToRemove(duplicateGroups);
  const descriptionUpdates = getDescriptionUpdates(duplicateGroups);

  if (duplicateGroups.length === 0) {
    console.log('No rule-based duplicates found.\n');
  } else {
    console.log(
      `Found ${duplicateGroups.length} duplicate groups (${idsToRemove.length} events to remove):\n`
    );

    for (const group of duplicateGroups) {
      console.log(`  KEEP: "${group.keep.title}" (${group.keep.id.slice(0, 8)})`);
      for (const removed of group.remove) {
        console.log(
          `  REMOVE: "${removed.title}" (${removed.id.slice(0, 8)}) [method: ${group.method}]`
        );
      }
      if (group.descriptionUpdate) {
        console.log(`  (will merge longer description into kept event)`);
      }
      console.log('');
    }

    // Apply description updates
    if (descriptionUpdates.length > 0) {
      console.log(`Applying ${descriptionUpdates.length} description merges...`);
      for (const update of descriptionUpdates) {
        await db
          .update(events)
          .set({ description: update.description })
          .where(eq(events.id, update.id));
      }
    }

    // Remove duplicates
    console.log(`Removing ${idsToRemove.length} duplicate events...`);
    await db.delete(events).where(inArray(events.id, idsToRemove));
    console.log('Done.\n');
  }

  // ── Step 2: AI dedup ──────────────────────────────────────────────────
  console.log('── Step 2: AI Deduplication ──────────────────────────────────\n');

  if (!isAIDeduplicationAvailable()) {
    console.log('Azure AI not configured, skipping AI dedup.\n');
  } else {
    // Re-fetch events after rule-based dedup
    const remainingEvents = await db
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
      .from(events);

    console.log(`Analyzing ${remainingEvents.length} remaining events...\n`);

    const eventsForAI: EventForAIDedup[] = remainingEvents.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      organizer: e.organizer,
      location: e.location,
      startDate: e.startDate,
      price: e.price,
      source: e.source,
    }));

    const result = await runAIDeduplication(eventsForAI, {
      maxDays: 30,
      delayBetweenDays: 300,
      verbose: true,
    });

    if (result.idsToRemove.length > 0) {
      console.log(`\nRemoving ${result.idsToRemove.length} AI-detected duplicates...`);
      await db.delete(events).where(inArray(events.id, result.idsToRemove));
      console.log('Done.');
    } else {
      console.log('\nNo AI duplicates found.');
    }

    console.log(`\nAI Dedup Summary:`);
    console.log(`  Days processed: ${result.daysProcessed}`);
    console.log(`  Duplicates removed: ${result.idsToRemove.length}`);
    console.log(`  Tokens used: ${result.totalTokensUsed}`);
    if (result.errors.length > 0) {
      console.log(`  Errors: ${result.errors.join(', ')}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Deduplication complete');
  console.log('═══════════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
