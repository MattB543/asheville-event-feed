import 'dotenv/config';
import { scrapeMeetup } from '../lib/scrapers/meetup';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { generateTagsAndSummary } from '../lib/ai/tagAndSummarize';
import { generateEmbedding, createEmbeddingText } from '../lib/ai/embedding';
import { generateEventScore, getRecurringEventScore } from '../lib/ai/scoring';
import { checkWeeklyRecurring } from '../lib/ai/recurringDetection';
import { findSimilarEvents } from '../lib/db/similaritySearch';
import { eq, sql, isNull, and, isNotNull, inArray } from 'drizzle-orm';
import { isAzureAIEnabled } from '../lib/ai/provider-clients';

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

async function main() {
  const startTime = Date.now();
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Meetup Scraper + AI Processing');
  console.log('═══════════════════════════════════════════════════════════');

  // ═══════════════════════════════════════════════════════════════
  // 1. SCRAPE MEETUP
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[1/4] Scraping Meetup events...');
  const scrapeStart = Date.now();

  let scrapedEvents;
  try {
    scrapedEvents = await scrapeMeetup(30); // 30 days
    console.log(`Scraped ${scrapedEvents.length} events in ${formatDuration(Date.now() - scrapeStart)}`);
  } catch (error) {
    console.error('Failed to scrape Meetup:', error);
    process.exit(1);
  }

  if (scrapedEvents.length === 0) {
    console.log('No events found. Exiting.');
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. UPSERT TO DATABASE
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[2/4] Upserting events to database...');
  const upsertStart = Date.now();

  let upsertSuccess = 0;
  let upsertFailed = 0;
  const insertedIds: string[] = [];

  for (const batch of chunk(scrapedEvents, 10)) {
    await Promise.all(
      batch.map(async (event) => {
        try {
          const result = await db
            .insert(events)
            .values({
              sourceId: event.sourceId,
              source: event.source,
              title: event.title,
              description: event.description,
              startDate: event.startDate,
              location: event.location,
              zip: event.zip,
              organizer: event.organizer,
              price: event.price,
              url: event.url,
              imageUrl: event.imageUrl,
              tags: [],
              lastSeenAt: new Date(),
            })
            .onConflictDoUpdate({
              target: events.url,
              set: {
                title: event.title,
                description: event.description,
                startDate: event.startDate,
                location: event.location,
                zip: event.zip,
                organizer: event.organizer,
                price: event.price,
                imageUrl: event.imageUrl,
                lastSeenAt: new Date(),
              },
            })
            .returning({ id: events.id });

          if (result[0]) {
            insertedIds.push(result[0].id);
          }
          upsertSuccess++;
        } catch (err) {
          upsertFailed++;
          console.error(`Failed to upsert "${event.title}":`, err instanceof Error ? err.message : err);
        }
      })
    );
  }

  console.log(`Upserted ${upsertSuccess} events (${upsertFailed} failed) in ${formatDuration(Date.now() - upsertStart)}`);

  // ═══════════════════════════════════════════════════════════════
  // 3. AI PROCESSING - TAGS + SUMMARIES
  // ═══════════════════════════════════════════════════════════════
  if (!isAzureAIEnabled()) {
    console.log('\n[3/4] Skipping AI processing - Azure AI not configured');
    console.log('Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT to enable');
    process.exit(0);
  }

  console.log('\n[3/4] Running AI processing (tags + summaries)...');
  const aiStart = Date.now();

  // Get events needing processing (MEETUP source, no tags or no summary)
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
        eq(events.source, 'MEETUP'),
        sql`(${events.tags} = '{}'::text[] OR ${events.tags} IS NULL OR ${events.aiSummary} IS NULL)`,
        insertedIds.length > 0 ? inArray(events.id, insertedIds) : sql`1=1`
      )
    )
    .limit(100);

  console.log(`Found ${eventsNeedingProcessing.length} Meetup events needing tags/summaries`);

  let tagSuccess = 0;
  let tagFailed = 0;

  for (const batch of chunk(eventsNeedingProcessing, 5)) {
    await Promise.all(
      batch.map(async (event) => {
        try {
          const result = await generateTagsAndSummary({
            title: event.title,
            description: event.description,
            location: event.location,
            organizer: event.organizer,
            startDate: event.startDate,
          });

          const updateData: { tags?: string[]; aiSummary?: string } = {};
          const needsTags = !event.tags || event.tags.length === 0;
          const needsSummary = !event.aiSummary;

          if (needsTags && result.tags.length > 0) {
            updateData.tags = result.tags;
          }
          if (needsSummary && result.summary) {
            updateData.aiSummary = result.summary;
          }

          if (Object.keys(updateData).length > 0) {
            await db.update(events).set(updateData).where(eq(events.id, event.id));
            tagSuccess++;
            console.log(`  ✓ "${event.title.slice(0, 50)}..." - ${result.tags.length} tags`);
          }
        } catch (err) {
          tagFailed++;
          console.error(`  ✗ "${event.title}":`, err instanceof Error ? err.message : err);
        }
      })
    );
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`Tags/summaries: ${tagSuccess}/${eventsNeedingProcessing.length} in ${formatDuration(Date.now() - aiStart)}`);

  // ═══════════════════════════════════════════════════════════════
  // 4. EMBEDDINGS + SCORING
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[4/4] Generating embeddings and scores...');

  // Get events needing embeddings
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
        eq(events.source, 'MEETUP'),
        isNotNull(events.aiSummary),
        isNull(events.embedding),
        insertedIds.length > 0 ? inArray(events.id, insertedIds) : sql`1=1`
      )
    )
    .limit(100);

  console.log(`Found ${eventsNeedingEmbeddings.length} events needing embeddings`);

  let embedSuccess = 0;
  for (const batch of chunk(eventsNeedingEmbeddings, 10)) {
    await Promise.all(
      batch.map(async (event) => {
        try {
          const text = createEmbeddingText(event.title, event.aiSummary!, event.tags, event.organizer);
          const embedding = await generateEmbedding(text);

          if (embedding) {
            await db.update(events).set({ embedding }).where(eq(events.id, event.id));
            embedSuccess++;
          }
        } catch (err) {
          console.error(`Embedding failed for "${event.title}":`, err instanceof Error ? err.message : err);
        }
      })
    );
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`Embeddings: ${embedSuccess}/${eventsNeedingEmbeddings.length}`);

  // Get events needing scores
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
        eq(events.source, 'MEETUP'),
        isNull(events.score),
        isNotNull(events.embedding),
        isNotNull(events.aiSummary),
        insertedIds.length > 0 ? inArray(events.id, insertedIds) : sql`1=1`
      )
    )
    .limit(50);

  console.log(`Found ${eventsNeedingScores.length} events needing scores`);

  let scoreSuccess = 0;
  let scoreSkipped = 0;

  for (const event of eventsNeedingScores) {
    try {
      // Check if daily recurring
      if (event.recurringType === 'daily') {
        const recurringScore = getRecurringEventScore('daily');
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
        scoreSkipped++;
        continue;
      }

      // Check if weekly recurring
      const recurringCheck = await checkWeeklyRecurring(
        event.title,
        event.location,
        event.organizer,
        event.id,
        event.startDate
      );

      if (recurringCheck.isWeeklyRecurring) {
        const recurringScore = getRecurringEventScore('weekly');
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
        scoreSkipped++;
        continue;
      }

      // Get similar events for context
      const similarEvents = await findSimilarEvents(event.id, {
        limit: 20,
        minSimilarity: 0.4,
        futureOnly: true,
        orderBy: 'similarity',
      });

      // Generate AI score
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

        scoreSuccess++;
        console.log(`  Score: "${event.title.slice(0, 30)}..." = ${scoreResult.score}/30`);
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`Score failed for "${event.title}":`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Scores: ${scoreSuccess}/${eventsNeedingScores.length} (${scoreSkipped} recurring skipped)`);

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  const totalDuration = Date.now() - startTime;
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`COMPLETE in ${formatDuration(totalDuration)}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Scraped: ${scrapedEvents.length} events`);
  console.log(`Upserted: ${upsertSuccess} (${upsertFailed} failed)`);
  console.log(`Tags/summaries: ${tagSuccess}`);
  console.log(`Embeddings: ${embedSuccess}`);
  console.log(`Scores: ${scoreSuccess} (${scoreSkipped} recurring)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
