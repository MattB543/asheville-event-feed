/**
 * Backfill AI summaries and embeddings for existing events.
 *
 * Run with: npx tsx scripts/ai/backfill-embeddings.ts
 *
 * Options:
 *   --summaries-only   Only generate summaries, skip embeddings
 *   --embeddings-only  Only generate embeddings (requires summaries to exist)
 *   --force            Regenerate embeddings even if they already exist
 *   --all              Include past events (default: future only)
 *   --limit N          Process at most N events (default: all)
 *   --dry-run          Show what would be processed without making changes
 */

import 'dotenv/config';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { eq, isNull, and, isNotNull, sql, gte } from 'drizzle-orm';
import { generateEventSummary } from '../../lib/ai/tagAndSummarize';
import { generateEmbedding, createEmbeddingText } from '../../lib/ai/embedding';
import { isAzureAIEnabled } from '../../lib/ai/provider-clients';
import { isAIEnabled } from '../../lib/ai/provider-clients';

// Parse command line args
const args = process.argv.slice(2);
const summariesOnly = args.includes('--summaries-only');
const embeddingsOnly = args.includes('--embeddings-only');
const forceEmbeddings = args.includes('--force');
const allEvents = args.includes('--all');
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit'));
const limit = limitArg
  ? parseInt(limitArg.split('=')[1] || args[args.indexOf('--limit') + 1])
  : undefined;

// Helper to format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Helper to chunk arrays
const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

async function backfill() {
  console.log('=== Backfill AI Summaries and Embeddings ===\n');

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // Check AI configuration
  const azureEnabled = isAzureAIEnabled();
  const geminiEnabled = isAIEnabled();

  console.log('Configuration:');
  console.log(`  Azure AI (summaries): ${azureEnabled ? 'enabled' : 'disabled'}`);
  console.log(`  Gemini AI (embeddings): ${geminiEnabled ? 'enabled' : 'disabled'}`);
  console.log();

  if (!azureEnabled && !embeddingsOnly) {
    console.error('Azure AI is required for summary generation.');
    console.error('Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT, or use --embeddings-only');
    process.exit(1);
  }

  if (!geminiEnabled && !summariesOnly) {
    console.error('Gemini AI is required for embedding generation.');
    console.error('Set GEMINI_API_KEY, or use --summaries-only');
    process.exit(1);
  }

  const stats = {
    summaries: { total: 0, success: 0, failed: 0, duration: 0 },
    embeddings: { total: 0, success: 0, failed: 0, duration: 0 },
  };

  // Step 1: Generate summaries
  if (!embeddingsOnly) {
    console.log('Step 1: Generating AI summaries...');

    const summaryConditions = [isNull(events.aiSummary)];
    if (!allEvents) {
      summaryConditions.push(gte(events.startDate, new Date()));
    }

    const eventsNeedingSummaries = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        location: events.location,
        organizer: events.organizer,
        startDate: events.startDate,
      })
      .from(events)
      .where(and(...summaryConditions))
      .limit(limit || 10000);

    stats.summaries.total = eventsNeedingSummaries.length;
    console.log(`Found ${eventsNeedingSummaries.length} events needing summaries`);

    if (eventsNeedingSummaries.length > 0 && !dryRun) {
      const startTime = Date.now();
      let processed = 0;

      for (const batch of chunk(eventsNeedingSummaries, 30)) {
        await Promise.all(
          batch.map(async (event) => {
            try {
              const summary = await generateEventSummary({
                title: event.title,
                description: event.description,
                location: event.location,
                organizer: event.organizer,
                startDate: event.startDate,
              });

              if (summary) {
                await db.update(events).set({ aiSummary: summary }).where(eq(events.id, event.id));

                stats.summaries.success++;
              } else {
                stats.summaries.failed++;
              }
            } catch (err) {
              stats.summaries.failed++;
              console.error(`Failed to generate summary for "${event.title}":`, err);
            }
          })
        );

        processed += batch.length;
        console.log(
          `  Progress: ${processed}/${stats.summaries.total} (${stats.summaries.success} success, ${stats.summaries.failed} failed)`
        );

        // Delay between batches
        await new Promise((r) => setTimeout(r, 1000));
      }

      stats.summaries.duration = Date.now() - startTime;
      console.log(`\nSummary generation complete in ${formatDuration(stats.summaries.duration)}`);
      console.log(`  Success: ${stats.summaries.success}/${stats.summaries.total}`);
      console.log(`  Failed: ${stats.summaries.failed}`);
    }
    console.log();
  }

  // Step 2: Generate embeddings
  if (!summariesOnly) {
    console.log('Step 2: Generating embeddings...');

    const embeddingConditions = [isNotNull(events.aiSummary)];
    if (!forceEmbeddings) {
      embeddingConditions.push(isNull(events.embedding));
    }
    if (!allEvents) {
      embeddingConditions.push(gte(events.startDate, new Date()));
    }

    const eventsNeedingEmbeddings = await db
      .select({
        id: events.id,
        title: events.title,
        aiSummary: events.aiSummary,
        tags: events.tags,
        organizer: events.organizer,
      })
      .from(events)
      .where(and(...embeddingConditions))
      .limit(limit || 10000);

    stats.embeddings.total = eventsNeedingEmbeddings.length;
    console.log(`Found ${eventsNeedingEmbeddings.length} events needing embeddings`);

    if (eventsNeedingEmbeddings.length > 0 && !dryRun) {
      const startTime = Date.now();
      let processed = 0;

      for (const batch of chunk(eventsNeedingEmbeddings, 10)) {
        await Promise.all(
          batch.map(async (event) => {
            try {
              const text = createEmbeddingText(
                event.title,
                event.aiSummary!,
                event.tags,
                event.organizer
              );
              const embedding = await generateEmbedding(text);

              if (embedding) {
                await db.update(events).set({ embedding }).where(eq(events.id, event.id));

                stats.embeddings.success++;
              } else {
                stats.embeddings.failed++;
              }
            } catch (err) {
              stats.embeddings.failed++;
              console.error(`Failed to generate embedding for "${event.title}":`, err);
            }
          })
        );

        processed += batch.length;
        console.log(
          `  Progress: ${processed}/${stats.embeddings.total} (${stats.embeddings.success} success, ${stats.embeddings.failed} failed)`
        );

        // Delay between batches
        await new Promise((r) => setTimeout(r, 500));
      }

      stats.embeddings.duration = Date.now() - startTime;
      console.log(
        `\nEmbedding generation complete in ${formatDuration(stats.embeddings.duration)}`
      );
      console.log(`  Success: ${stats.embeddings.success}/${stats.embeddings.total}`);
      console.log(`  Failed: ${stats.embeddings.failed}`);
    }
  }

  // Final stats
  console.log('\n=== Backfill Complete ===');

  // Get current database stats
  const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(events);
  const [withSummaryResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(isNotNull(events.aiSummary));
  const [withEmbeddingResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(isNotNull(events.embedding));

  console.log('\nDatabase status:');
  console.log(`  Total events: ${totalResult.count}`);
  console.log(
    `  With summary: ${withSummaryResult.count} (${Math.round((Number(withSummaryResult.count) / Number(totalResult.count)) * 100)}%)`
  );
  console.log(
    `  With embedding: ${withEmbeddingResult.count} (${Math.round((Number(withEmbeddingResult.count) / Number(totalResult.count)) * 100)}%)`
  );

  process.exit(0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
