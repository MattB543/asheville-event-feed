/**
 * Test scoring until we hit a 21+ score.
 * Saves all scores to the database as we go.
 *
 * Usage: npx tsx scripts/ai/test-scoring-until-high.ts
 */

import 'dotenv/config';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { and, gte, lte, isNotNull, isNull, sql, eq } from 'drizzle-orm';
import { findSimilarEvents } from '../../lib/db/similaritySearch';
import { checkWeeklyRecurring } from '../../lib/ai/recurringDetection';
import { generateEventScore, getRecurringEventScore } from '../../lib/ai/scoring';

async function main() {
  console.log('Scoring events until we hit 21+...\n');
  console.log('All scores will be saved to the database.\n');

  const now = new Date();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  let totalProcessed = 0;
  let totalAIScored = 0;
  let totalRecurring = 0;
  let highestScore = 0;
  let highestEvent: { title: string; score: number; rarity: number; unique: number; magnitude: number; reason: string } | null = null;
  let found21Plus = false;

  while (!found21Plus) {
    // Get batch of unscored events with embeddings
    const batch = await db
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
          isNotNull(events.embedding),
          isNotNull(events.aiSummary),
          isNull(events.score),
          gte(events.startDate, now),
          lte(events.startDate, threeMonthsFromNow)
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(10);

    if (batch.length === 0) {
      console.log('\n⚠️  No more unscored events with embeddings found!');
      break;
    }

    for (const event of batch) {
      totalProcessed++;
      const shortTitle = event.title.slice(0, 50) + (event.title.length > 50 ? '...' : '');

      try {
        // Check if daily recurring
        if (event.recurringType === 'daily') {
          const recurringScore = getRecurringEventScore('daily');
          await db.update(events).set({
            score: recurringScore.score,
            scoreRarity: recurringScore.rarity,
            scoreUnique: recurringScore.unique,
            scoreMagnitude: recurringScore.magnitude,
            scoreReason: recurringScore.reason,
          }).where(eq(events.id, event.id));

          totalRecurring++;
          console.log(`[${totalProcessed}] ${shortTitle} → 5/30 (daily recurring) ✓ saved`);
          continue;
        }

        // Check weekly recurring
        const recurringCheck = await checkWeeklyRecurring(
          event.title,
          event.location,
          event.organizer,
          event.id,
          event.startDate
        );

        if (recurringCheck.isWeeklyRecurring) {
          const recurringScore = getRecurringEventScore('weekly');
          await db.update(events).set({
            score: recurringScore.score,
            scoreRarity: recurringScore.rarity,
            scoreUnique: recurringScore.unique,
            scoreMagnitude: recurringScore.magnitude,
            scoreReason: recurringScore.reason,
          }).where(eq(events.id, event.id));

          totalRecurring++;
          console.log(`[${totalProcessed}] ${shortTitle} → 5/30 (weekly, ${recurringCheck.matchCount} matches) ✓ saved`);
          continue;
        }

        // Get similar events
        const similarEvents = await findSimilarEvents(event.id, {
          limit: 20,
          minSimilarity: 0.4,
          futureOnly: true,
          orderBy: 'similarity'
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
          similarEvents.map(e => ({
            title: e.title,
            location: e.location,
            organizer: e.organizer,
            startDate: e.startDate,
            similarity: e.similarity,
          }))
        );

        if (scoreResult) {
          // Save to database
          await db.update(events).set({
            score: scoreResult.score,
            scoreRarity: scoreResult.rarity,
            scoreUnique: scoreResult.unique,
            scoreMagnitude: scoreResult.magnitude,
            scoreReason: scoreResult.reason,
          }).where(eq(events.id, event.id));

          totalAIScored++;

          const scoreStr = `${scoreResult.score}/30 (R:${scoreResult.rarity} U:${scoreResult.unique} M:${scoreResult.magnitude})`;

          if (scoreResult.score > highestScore) {
            highestScore = scoreResult.score;
            highestEvent = {
              title: event.title,
              score: scoreResult.score,
              rarity: scoreResult.rarity,
              unique: scoreResult.unique,
              magnitude: scoreResult.magnitude,
              reason: scoreResult.reason,
            };
          }

          if (scoreResult.score >= 21) {
            console.log(`\n🎉 FOUND 21+ SCORE!`);
            console.log(`[${totalProcessed}] ${shortTitle} → ${scoreStr} ✓ saved`);
            console.log(`\n${'═'.repeat(70)}`);
            console.log('EVENT DETAILS:');
            console.log('═'.repeat(70));
            console.log('Title:', event.title);
            console.log('Date:', event.startDate.toLocaleDateString());
            console.log('Location:', event.location || 'N/A');
            console.log('Organizer:', event.organizer || 'N/A');
            console.log('Price:', event.price || 'N/A');
            console.log('Tags:', (event.tags || []).join(', '));
            console.log('Summary:', event.aiSummary);
            console.log('Similar events found:', similarEvents.length);
            console.log('');
            console.log('SCORE:', scoreResult.score, '/30');
            console.log('  Rarity:', scoreResult.rarity, '/10');
            console.log('  Unique:', scoreResult.unique, '/10');
            console.log('  Magnitude:', scoreResult.magnitude, '/10');
            console.log('Reason:', scoreResult.reason);
            console.log('═'.repeat(70));
            found21Plus = true;
            break;
          } else {
            console.log(`[${totalProcessed}] ${shortTitle} → ${scoreStr} ✓ saved`);
          }
        } else {
          console.log(`[${totalProcessed}] ${shortTitle} → ERROR: No score returned`);
        }

        // Delay between AI calls
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.log(`[${totalProcessed}] ${shortTitle} → ERROR: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Total events processed: ${totalProcessed}`);
  console.log(`AI scored: ${totalAIScored}`);
  console.log(`Auto-scored recurring: ${totalRecurring}`);
  console.log(`Highest score seen: ${highestScore}/30`);
  if (highestEvent) {
    console.log(`Highest event: "${highestEvent.title.slice(0, 50)}..." (${highestEvent.score}/30)`);
  }
  console.log('═'.repeat(70));
}

main().catch(console.error);
