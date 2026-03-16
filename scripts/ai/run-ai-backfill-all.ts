import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { eq, or, sql, isNull, and, isNotNull, gte } from 'drizzle-orm';
import { generateTagsAndSummary } from '@/lib/ai/tagAndSummarize';
import { generateEmbedding, createEmbeddingText } from '@/lib/ai/embedding';
import {
  buildMissingScoreUpdate,
  generateEventScore,
  getFallbackEventScore,
  getRecurringEventScore,
} from '@/lib/ai/scoring';
import { checkWeeklyRecurring } from '@/lib/ai/recurringDetection';
import { findSimilarEvents } from '@/lib/db/similaritySearch';
import { isAzureAIEnabled } from '@/lib/ai/provider-clients';

const BATCH_SIZE_COMBINED = 30;
const BATCH_SIZE_EMBEDDINGS = 30;
const BATCH_SIZE_SCORING = 20;
const LIMIT_PER_PASS = 200;

const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

interface Stats {
  combined: { success: number; failed: number; total: number };
  embeddings: { success: number; failed: number; total: number };
  scoring: { success: number; failed: number; total: number; skippedRecurring: number };
}

async function getRemainingCounts() {
  const now = new Date();

  const [needsSummary] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        or(sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`, isNull(events.aiSummary)),
        gte(events.startDate, now)
      )
    );

  const [needsEmbedding] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(isNotNull(events.aiSummary), isNull(events.embedding), gte(events.startDate, now)));

  const [needsScore] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        or(
          isNull(events.score),
          isNull(events.scoreRarity),
          isNull(events.scoreUnique),
          isNull(events.scoreMagnitude),
          isNull(events.scoreReason),
          isNull(events.scoreAshevilleWeird),
          isNull(events.scoreSocial)
        ),
        isNotNull(events.embedding),
        isNotNull(events.aiSummary),
        gte(events.startDate, now)
      )
    );

  return {
    needsSummary: Number(needsSummary.count),
    needsEmbedding: Number(needsEmbedding.count),
    needsScore: Number(needsScore.count),
  };
}

async function processCombinedPass(stats: Stats): Promise<number> {
  const now = new Date();
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
        gte(events.startDate, now)
      )
    )
    .limit(LIMIT_PER_PASS);

  if (eventsNeedingProcessing.length === 0) return 0;

  console.log(
    `\n[Backfill] Processing ${eventsNeedingProcessing.length} events for tags/summaries...`
  );

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
            stats.combined.failed++;
            stats.combined.total++;
            console.error(`[Backfill] Empty result: "${event.title.slice(0, 40)}..."`);
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
            `[Backfill] Failed: "${event.title.slice(0, 40)}..."${isContentFilter ? ' [CONTENT FILTER]' : ''}`
          );

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
  }

  return eventsNeedingProcessing.length;
}

async function processEmbeddingsPass(stats: Stats): Promise<number> {
  const now = new Date();
  const eventsNeedingEmbeddings = await db
    .select({
      id: events.id,
      title: events.title,
      aiSummary: events.aiSummary,
      tags: events.tags,
      organizer: events.organizer,
    })
    .from(events)
    .where(and(isNotNull(events.aiSummary), isNull(events.embedding), gte(events.startDate, now)))
    .limit(LIMIT_PER_PASS);

  if (eventsNeedingEmbeddings.length === 0) return 0;

  console.log(`\n[Backfill] Generating embeddings for ${eventsNeedingEmbeddings.length} events...`);

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
  }

  return eventsNeedingEmbeddings.length;
}

async function processScoringPass(stats: Stats): Promise<number> {
  const now = new Date();
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
      score: events.score,
      scoreRarity: events.scoreRarity,
      scoreUnique: events.scoreUnique,
      scoreMagnitude: events.scoreMagnitude,
      scoreReason: events.scoreReason,
      scoreAshevilleWeird: events.scoreAshevilleWeird,
      scoreSocial: events.scoreSocial,
    })
    .from(events)
    .where(
      and(
        or(
          isNull(events.score),
          isNull(events.scoreRarity),
          isNull(events.scoreUnique),
          isNull(events.scoreMagnitude),
          isNull(events.scoreReason),
          isNull(events.scoreAshevilleWeird),
          isNull(events.scoreSocial)
        ),
        isNotNull(events.embedding),
        isNotNull(events.aiSummary),
        gte(events.startDate, now)
      )
    )
    .limit(LIMIT_PER_PASS);

  if (eventsNeedingScores.length === 0) return 0;

  console.log(`\n[Backfill] Scoring ${eventsNeedingScores.length} events...`);

  const dailyRecurring = eventsNeedingScores.filter((e) => e.recurringType === 'daily');
  if (dailyRecurring.length > 0) {
    const recurringScore = getRecurringEventScore('daily');

    await Promise.all(
      dailyRecurring.map(async (event) => {
        const updateData = buildMissingScoreUpdate(event, recurringScore);
        if (Object.keys(updateData).length > 0) {
          await db.update(events).set(updateData).where(eq(events.id, event.id));
        }
        stats.scoring.skippedRecurring++;
        stats.scoring.total++;
      })
    );
    console.log(`[Backfill] Auto-scored ${dailyRecurring.length} daily recurring`);
  }

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
        const updateData = buildMissingScoreUpdate(event, recurringScore);
        if (Object.keys(updateData).length > 0) {
          await db.update(events).set(updateData).where(eq(events.id, event.id));
        }
        stats.scoring.skippedRecurring++;
        stats.scoring.total++;
      })
    );
    console.log(`[Backfill] Auto-scored ${weeklyRecurring.length} weekly recurring`);
  }

  if (needsAIScoring.length > 0) {
    console.log(
      `[Backfill] AI scoring ${needsAIScoring.length} events in batches of ${BATCH_SIZE_SCORING}...`
    );

    for (const batch of chunk(needsAIScoring, BATCH_SIZE_SCORING)) {
      await Promise.all(
        batch.map(async (event) => {
          try {
            const similarEvents = await findSimilarEvents(event.id, {
              limit: 20,
              minSimilarity: 0.4,
              futureOnly: false,
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

            const finalScore =
              scoreResult ?? getFallbackEventScore('Fallback score: AI scoring failed');
            if (!scoreResult) {
              stats.scoring.failed++;
            } else {
              stats.scoring.success++;
            }

            const updateData = buildMissingScoreUpdate(event, finalScore);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }
            stats.scoring.total++;
          } catch (err) {
            stats.scoring.failed++;
            stats.scoring.total++;
            const fallbackScore = getFallbackEventScore(
              err instanceof Error &&
                (err.message.includes('content_filter') ||
                  err.message.includes('content management policy'))
                ? 'Fallback score: AI scoring blocked by content filter'
                : 'Fallback score: AI scoring failed'
            );
            const updateData = buildMissingScoreUpdate(event, fallbackScore);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }
          }
        })
      );
    }
  }

  return eventsNeedingScores.length;
}

async function main() {
  if (!isAzureAIEnabled()) {
    console.error('Azure AI not enabled (AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required)');
    process.exit(1);
  }

  const stats: Stats = {
    combined: { success: 0, failed: 0, total: 0 },
    embeddings: { success: 0, failed: 0, total: 0 },
    scoring: { success: 0, failed: 0, total: 0, skippedRecurring: 0 },
  };

  const initial = await getRemainingCounts();
  console.log(`[Backfill] Initial: ${JSON.stringify(initial)}`);

  console.log('\n[Backfill] STEP 1: TAGS & SUMMARIES');
  while (true) {
    const processed = await processCombinedPass(stats);
    if (processed === 0) break;
    const remaining = await getRemainingCounts();
    console.log(`[Backfill] Remaining after batch: ${JSON.stringify(remaining)}`);
  }

  console.log('\n[Backfill] STEP 2: EMBEDDINGS');
  while (true) {
    const processed = await processEmbeddingsPass(stats);
    if (processed === 0) break;
    const remaining = await getRemainingCounts();
    console.log(`[Backfill] Remaining after batch: ${JSON.stringify(remaining)}`);
  }

  console.log('\n[Backfill] STEP 3: SCORING');
  while (true) {
    const processed = await processScoringPass(stats);
    if (processed === 0) break;
    const remaining = await getRemainingCounts();
    console.log(`[Backfill] Remaining after batch: ${JSON.stringify(remaining)}`);
  }

  const finalCounts = await getRemainingCounts();
  console.log(`[Backfill] Final: ${JSON.stringify(finalCounts)}`);
  console.log(
    `[Backfill] Summary: tags/summaries ${stats.combined.success} ok, ${stats.combined.failed} failed; embeddings ${stats.embeddings.success} ok, ${stats.embeddings.failed} failed; scoring ${stats.scoring.success} ok, ${stats.scoring.failed} failed, ${stats.scoring.skippedRecurring} recurring`
  );
}

main().catch((error) => {
  console.error('[Backfill] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
