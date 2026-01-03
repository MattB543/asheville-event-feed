/**
 * Standalone script to run AI processing for ALL future events.
 * Runs in a loop until all events are processed.
 */

import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { eq, or, sql, isNull, and, isNotNull } from 'drizzle-orm';
import { generateTagsAndSummary } from '../../lib/ai/tagAndSummarize';
import { generateEmbedding, createEmbeddingText } from '../../lib/ai/embedding';
import { generateEventScore, getRecurringEventScore } from '../../lib/ai/scoring';
import { checkWeeklyRecurring } from '../../lib/ai/recurringDetection';
import { findSimilarEvents } from '../../lib/db/similaritySearch';
import { isAzureAIEnabled } from '../../lib/ai/provider-clients';

// Configuration - MAX SPEED MODE
// Azure OpenAI can handle 60-300 RPM depending on tier
// Running at max throughput with no delays
const BATCH_SIZE_COMBINED = 30;
const BATCH_SIZE_EMBEDDINGS = 30;
const BATCH_SIZE_SCORING = 30;
const LIMIT_PER_PASS = 200;

// Helper to format duration
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

// Helper to chunk arrays
const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

interface Stats {
  combined: { success: number; failed: number; total: number };
  embeddings: { success: number; failed: number; total: number };
  scoring: { success: number; failed: number; total: number; skippedRecurring: number };
}

async function processCombinedPass(stats: Stats): Promise<number> {
  const now = new Date();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  const eventsNeedingProcessing = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      location: events.location,
      organizer: events.organizer,
      startDate: events.startDate,
      tags: events.tags,
      aiSummary: events.aiSummary,
    })
    .from(events)
    .where(
      and(
        or(sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`, isNull(events.aiSummary)),
        sql`${events.startDate} >= ${now.toISOString()}`,
        sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
      )
    )
    .limit(LIMIT_PER_PASS);

  if (eventsNeedingProcessing.length === 0) return 0;

  console.log(`\n📝 Processing ${eventsNeedingProcessing.length} events for tags/summaries...`);

  for (const batch of chunk(eventsNeedingProcessing, BATCH_SIZE_COMBINED)) {
    await Promise.all(
      batch.map(async (event) => {
        try {
          const needsTags = !event.tags || event.tags.length === 0;
          const needsSummary = !event.aiSummary;

          const result = await generateTagsAndSummary({
            title: event.title,
            description: event.description,
            location: event.location,
            organizer: event.organizer,
            startDate: event.startDate,
          });

          const updateData: { tags?: string[]; aiSummary?: string } = {};
          if (needsTags && result.tags.length > 0) updateData.tags = result.tags;
          if (needsSummary && result.summary) updateData.aiSummary = result.summary;

          if (Object.keys(updateData).length > 0) {
            await db.update(events).set(updateData).where(eq(events.id, event.id));
            stats.combined.success++;
            stats.combined.total++;
          } else {
            // AI returned empty results - mark with placeholders to prevent infinite retry
            stats.combined.failed++;
            stats.combined.total++;
            console.error(`✗ Empty result: "${event.title.slice(0, 40)}..."`);
            const fallbackData: { tags?: string[]; aiSummary?: string } = {};
            if (needsTags) fallbackData.tags = ['Event'];
            if (needsSummary) fallbackData.aiSummary = '[AI processing returned no results]';
            if (Object.keys(fallbackData).length > 0) {
              await db.update(events).set(fallbackData).where(eq(events.id, event.id));
            }
          }
        } catch (err) {
          stats.combined.failed++;
          stats.combined.total++;
          const errMsg = err instanceof Error ? err.message : String(err);
          const isContentFilter =
            errMsg.includes('content_filter') || errMsg.includes('content management policy');
          console.error(
            `✗ Failed: "${event.title.slice(0, 40)}..."${isContentFilter ? ' [CONTENT FILTER]' : ''}`
          );

          // Mark failed events with placeholder to prevent infinite retry loops
          const needsTags = !event.tags || event.tags.length === 0;
          const needsSummary = !event.aiSummary;
          const updateData: { tags?: string[]; aiSummary?: string } = {};
          if (needsTags) updateData.tags = ['Event'];
          if (needsSummary)
            updateData.aiSummary = isContentFilter
              ? '[Content filtered by AI safety policy]'
              : '[AI processing failed]';

          if (Object.keys(updateData).length > 0) {
            await db.update(events).set(updateData).where(eq(events.id, event.id));
          }
        }
      })
    );
    // No delay - max throughput
  }

  return eventsNeedingProcessing.length;
}

async function processEmbeddingsPass(stats: Stats): Promise<number> {
  const now = new Date();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  const eventsNeedingEmbeddings = await db
    .select({
      id: events.id,
      title: events.title,
      aiSummary: events.aiSummary,
      tags: events.tags,
      organizer: events.organizer,
    })
    .from(events)
    .where(
      and(
        isNotNull(events.aiSummary),
        isNull(events.embedding),
        sql`${events.startDate} >= ${now.toISOString()}`,
        sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
      )
    )
    .limit(LIMIT_PER_PASS);

  if (eventsNeedingEmbeddings.length === 0) return 0;

  console.log(`\n🔢 Generating embeddings for ${eventsNeedingEmbeddings.length} events...`);

  for (const batch of chunk(eventsNeedingEmbeddings, BATCH_SIZE_EMBEDDINGS)) {
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
          stats.embeddings.total++;
        } catch {
          stats.embeddings.failed++;
          stats.embeddings.total++;
        }
      })
    );
    // No delay - max throughput
  }

  return eventsNeedingEmbeddings.length;
}

async function processScoringPass(stats: Stats): Promise<number> {
  const now = new Date();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  const eventsNeedingScores = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      location: events.location,
      organizer: events.organizer,
      tags: events.tags,
      aiSummary: events.aiSummary,
      startDate: events.startDate,
      price: events.price,
      recurringType: events.recurringType,
    })
    .from(events)
    .where(
      and(
        isNull(events.score),
        isNotNull(events.embedding),
        isNotNull(events.aiSummary),
        sql`${events.startDate} >= ${now.toISOString()}`,
        sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
      )
    )
    .limit(LIMIT_PER_PASS);

  if (eventsNeedingScores.length === 0) return 0;

  console.log(`\n⭐ Scoring ${eventsNeedingScores.length} events...`);

  // First: Handle daily recurring in parallel (no API call)
  const dailyRecurring = eventsNeedingScores.filter((e) => e.recurringType === 'daily');
  if (dailyRecurring.length > 0) {
    const recurringScore = getRecurringEventScore('daily');
    await Promise.all(
      dailyRecurring.map(async (event) => {
        await db
          .update(events)
          .set({
            score: recurringScore.score,
            scoreRarity: recurringScore.rarity,
            scoreUnique: recurringScore.unique,
            scoreMagnitude: recurringScore.magnitude,
            scoreReason: recurringScore.reason,
          })
          .where(eq(events.id, event.id));
        stats.scoring.skippedRecurring++;
        stats.scoring.total++;
      })
    );
    console.log(`  ⟲ Auto-scored ${dailyRecurring.length} daily recurring`);
  }

  // Second: Check weekly recurring in parallel (DB only)
  const nonDailyEvents = eventsNeedingScores.filter((e) => e.recurringType !== 'daily');
  const recurringChecks = await Promise.all(
    nonDailyEvents.map(async (event) => {
      const check = await checkWeeklyRecurring(
        event.title,
        event.location,
        event.organizer,
        event.id,
        event.startDate
      );
      return { event, isWeekly: check.isWeeklyRecurring };
    })
  );

  const weeklyRecurring = recurringChecks.filter((r) => r.isWeekly);
  const needsAIScoring = recurringChecks.filter((r) => !r.isWeekly).map((r) => r.event);

  if (weeklyRecurring.length > 0) {
    const recurringScore = getRecurringEventScore('weekly');
    await Promise.all(
      weeklyRecurring.map(async ({ event }) => {
        await db
          .update(events)
          .set({
            score: recurringScore.score,
            scoreRarity: recurringScore.rarity,
            scoreUnique: recurringScore.unique,
            scoreMagnitude: recurringScore.magnitude,
            scoreReason: recurringScore.reason,
          })
          .where(eq(events.id, event.id));
        stats.scoring.skippedRecurring++;
        stats.scoring.total++;
      })
    );
    console.log(`  ⟲ Auto-scored ${weeklyRecurring.length} weekly recurring`);
  }

  // Third: AI scoring in PARALLEL BATCHES (the big speedup!)
  if (needsAIScoring.length > 0) {
    console.log(
      `  🤖 AI scoring ${needsAIScoring.length} events in batches of ${BATCH_SIZE_SCORING}...`
    );

    for (const batch of chunk(needsAIScoring, BATCH_SIZE_SCORING)) {
      await Promise.all(
        batch.map(async (event) => {
          try {
            const similarEvents = await findSimilarEvents(event.id, {
              limit: 20,
              minSimilarity: 0.4,
              futureOnly: true,
              orderBy: 'similarity',
            });

            const scoreResult = await generateEventScore(
              {
                id: event.id,
                title: event.title,
                description: event.description,
                location: event.location,
                organizer: event.organizer,
                tags: event.tags,
                aiSummary: event.aiSummary,
                startDate: event.startDate,
                price: event.price,
              },
              similarEvents.map((e) => ({
                title: e.title,
                location: e.location,
                organizer: e.organizer,
                startDate: e.startDate,
                similarity: e.similarity,
              }))
            );

            if (scoreResult) {
              await db
                .update(events)
                .set({
                  score: scoreResult.score,
                  scoreRarity: scoreResult.rarity,
                  scoreUnique: scoreResult.unique,
                  scoreMagnitude: scoreResult.magnitude,
                  scoreReason: scoreResult.reason,
                })
                .where(eq(events.id, event.id));
              stats.scoring.success++;
              if (scoreResult.score >= 18) {
                console.log(`  ★ ${scoreResult.score}/30: "${event.title.slice(0, 50)}..."`);
              }
            } else {
              stats.scoring.failed++;
            }
            stats.scoring.total++;
          } catch {
            stats.scoring.failed++;
            stats.scoring.total++;
          }
        })
      );
      // No delay - max throughput
    }
  }

  return eventsNeedingScores.length;
}

async function getRemainingCounts() {
  const now = new Date();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  const needsSummary = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        or(sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`, isNull(events.aiSummary)),
        sql`${events.startDate} >= ${now.toISOString()}`,
        sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
      )
    );

  const needsEmbedding = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        isNotNull(events.aiSummary),
        isNull(events.embedding),
        sql`${events.startDate} >= ${now.toISOString()}`,
        sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
      )
    );

  const needsScore = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        isNull(events.score),
        isNotNull(events.embedding),
        sql`${events.startDate} >= ${now.toISOString()}`,
        sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
      )
    );

  return {
    needsSummary: Number(needsSummary[0].count),
    needsEmbedding: Number(needsEmbedding[0].count),
    needsScore: Number(needsScore[0].count),
  };
}

async function main() {
  if (!isAzureAIEnabled()) {
    console.error('Azure AI not enabled (AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required)');
    process.exit(1);
  }

  const jobStartTime = Date.now();

  const stats: Stats = {
    combined: { success: 0, failed: 0, total: 0 },
    embeddings: { success: 0, failed: 0, total: 0 },
    scoring: { success: 0, failed: 0, total: 0, skippedRecurring: 0 },
  };

  console.log('════════════════════════════════════════════════════════════');
  console.log('  AI PROCESSING - Sequential Pipeline');
  console.log('════════════════════════════════════════════════════════════');

  // Get initial counts
  const initial = await getRemainingCounts();
  console.log(`\nInitial counts:`);
  console.log(`  • Need tags/summary: ${initial.needsSummary}`);
  console.log(`  • Need embedding: ${initial.needsEmbedding}`);
  console.log(`  • Need score: ${initial.needsScore}`);

  // STEP 1: Process ALL tags/summaries first
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  STEP 1: TAGS & SUMMARIES`);
  console.log(`════════════════════════════════════════════════════════════`);
  let stepStart = Date.now();
  let batchNum = 0;
  while (true) {
    const processed = await processCombinedPass(stats);
    if (processed === 0) break;
    batchNum++;
    const remaining = await getRemainingCounts();
    console.log(`  Batch ${batchNum} done. ${remaining.needsSummary} remaining...`);
  }
  console.log(`\n  ✅ All tags/summaries complete in ${formatDuration(Date.now() - stepStart)}`);

  // STEP 2: Process ALL embeddings
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  STEP 2: EMBEDDINGS`);
  console.log(`════════════════════════════════════════════════════════════`);
  stepStart = Date.now();
  batchNum = 0;
  while (true) {
    const processed = await processEmbeddingsPass(stats);
    if (processed === 0) break;
    batchNum++;
    const remaining = await getRemainingCounts();
    console.log(`  Batch ${batchNum} done. ${remaining.needsEmbedding} remaining...`);
  }
  console.log(`\n  ✅ All embeddings complete in ${formatDuration(Date.now() - stepStart)}`);

  // STEP 3: Process ALL scores
  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  STEP 3: SCORING`);
  console.log(`════════════════════════════════════════════════════════════`);
  stepStart = Date.now();
  batchNum = 0;
  while (true) {
    const processed = await processScoringPass(stats);
    if (processed === 0) break;
    batchNum++;
    const remaining = await getRemainingCounts();
    console.log(`  Batch ${batchNum} done. ${remaining.needsScore} remaining...`);
  }
  console.log(`\n  ✅ All scoring complete in ${formatDuration(Date.now() - stepStart)}`);

  // Final Summary
  const totalDuration = Date.now() - jobStartTime;
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  JOB COMPLETE in ${formatDuration(totalDuration)}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log(
    `  Tags/Summaries: ${stats.combined.success} succeeded, ${stats.combined.failed} failed`
  );
  console.log(
    `  Embeddings:     ${stats.embeddings.success} succeeded, ${stats.embeddings.failed} failed`
  );
  console.log(
    `  Scores:         ${stats.scoring.success} AI scored, ${stats.scoring.skippedRecurring} recurring auto-scored, ${stats.scoring.failed} failed`
  );
  console.log('════════════════════════════════════════════════════════════\n');
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
