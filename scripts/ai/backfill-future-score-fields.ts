import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  buildMissingScoreUpdate,
  generateEventScore,
  getFallbackEventScore,
  getRecurringEventScore,
} from '../../lib/ai/scoring';
import { checkWeeklyRecurring } from '../../lib/ai/recurringDetection';
import { findSimilarEvents } from '../../lib/db/similaritySearch';
import { isAzureAIEnabled } from '../../lib/ai/provider-clients';

const BATCH_SIZE = 20;
const LIMIT_PER_PASS = 100;

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

const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );

interface Stats {
  success: number;
  failed: number;
  skippedRecurring: number;
  total: number;
}

async function getRemainingCounts() {
  const nowIso = new Date().toISOString();

  const [futureTotal] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(sql`${events.startDate} >= ${nowIso}`);

  const [missingAnyScoreField] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        sql`${events.startDate} >= ${nowIso}`,
        or(
          isNull(events.score),
          isNull(events.scoreRarity),
          isNull(events.scoreUnique),
          isNull(events.scoreMagnitude),
          isNull(events.scoreReason),
          isNull(events.scoreAshevilleWeird),
          isNull(events.scoreSocial)
        )
      )
    );

  const [missingWeird] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(sql`${events.startDate} >= ${nowIso}`, isNull(events.scoreAshevilleWeird)));

  const [missingSocial] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(sql`${events.startDate} >= ${nowIso}`, isNull(events.scoreSocial)));

  const [scoreReadyMissing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(
      and(
        sql`${events.startDate} >= ${nowIso}`,
        isNotNull(events.aiSummary),
        isNotNull(events.embedding),
        or(
          isNull(events.score),
          isNull(events.scoreRarity),
          isNull(events.scoreUnique),
          isNull(events.scoreMagnitude),
          isNull(events.scoreReason),
          isNull(events.scoreAshevilleWeird),
          isNull(events.scoreSocial)
        )
      )
    );

  return {
    futureTotal: Number(futureTotal.count),
    missingAnyScoreField: Number(missingAnyScoreField.count),
    missingWeird: Number(missingWeird.count),
    missingSocial: Number(missingSocial.count),
    scoreReadyMissing: Number(scoreReadyMissing.count),
  };
}

async function processScorePass(stats: Stats): Promise<number> {
  const nowIso = new Date().toISOString();
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
        sql`${events.startDate} >= ${nowIso}`,
        isNotNull(events.aiSummary),
        isNotNull(events.embedding),
        or(
          isNull(events.score),
          isNull(events.scoreRarity),
          isNull(events.scoreUnique),
          isNull(events.scoreMagnitude),
          isNull(events.scoreReason),
          isNull(events.scoreAshevilleWeird),
          isNull(events.scoreSocial)
        )
      )
    )
    .limit(LIMIT_PER_PASS);

  if (eventsNeedingScores.length === 0) return 0;

  console.log(`\n[BackfillFutureScores] Processing ${eventsNeedingScores.length} future events...`);

  for (const batch of chunk(eventsNeedingScores, BATCH_SIZE)) {
    await Promise.all(
      batch.map(async (event) => {
        try {
          if (event.recurringType === 'daily') {
            const recurringScore = getRecurringEventScore('daily');
            const updateData = buildMissingScoreUpdate(event, recurringScore);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }
            stats.skippedRecurring++;
            stats.total++;
            return;
          }

          const recurringCheck = await checkWeeklyRecurring(
            event.title,
            event.location,
            event.organizer,
            event.id,
            event.startDate
          );

          if (recurringCheck.isWeeklyRecurring) {
            const recurringScore = getRecurringEventScore('weekly');
            const updateData = buildMissingScoreUpdate(event, recurringScore);
            if (Object.keys(updateData).length > 0) {
              await db.update(events).set(updateData).where(eq(events.id, event.id));
            }
            stats.skippedRecurring++;
            stats.total++;
            return;
          }

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

          const finalScore =
            scoreResult ?? getFallbackEventScore('Fallback score: AI scoring failed');
          const updateData = buildMissingScoreUpdate(event, finalScore);
          if (Object.keys(updateData).length > 0) {
            await db.update(events).set(updateData).where(eq(events.id, event.id));
          }

          if (scoreResult) {
            stats.success++;
          } else {
            stats.failed++;
            console.warn(
              `[BackfillFutureScores] Applied score fallback for "${event.title.slice(0, 50)}..."`
            );
          }

          stats.total++;
        } catch (err) {
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

          stats.failed++;
          stats.total++;
          console.error(
            `[BackfillFutureScores] Failed to AI-score "${event.title}":`,
            err instanceof Error ? err.message : err
          );
        }
      })
    );
  }

  return eventsNeedingScores.length;
}

async function main() {
  if (!isAzureAIEnabled()) {
    console.error('Azure AI not enabled (AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required)');
    process.exit(1);
  }

  const startedAt = Date.now();
  const stats: Stats = {
    success: 0,
    failed: 0,
    skippedRecurring: 0,
    total: 0,
  };

  console.log('════════════════════════════════════════════════════════════');
  console.log('  FUTURE SCORE BACKFILL');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`Initial: ${JSON.stringify(await getRemainingCounts())}`);

  let batchNum = 0;
  while (true) {
    const processed = await processScorePass(stats);
    if (processed === 0) break;
    batchNum++;
    console.log(`Batch ${batchNum} done. ${JSON.stringify(await getRemainingCounts())}`);
  }

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  JOB COMPLETE in ${formatDuration(Date.now() - startedAt)}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log(
    `  Scores: ${stats.success} AI scored, ${stats.skippedRecurring} recurring auto-scored, ${stats.failed} fallbacks`
  );
  console.log(`  Final: ${JSON.stringify(await getRemainingCounts())}`);
  console.log('════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error(
    '[BackfillFutureScores] Fatal error:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
