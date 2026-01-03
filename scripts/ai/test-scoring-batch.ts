/**
 * Test scoring on 30 random events from the next 3 weeks.
 * Saves raw inputs and outputs for review.
 *
 * Usage: npx tsx scripts/ai/test-scoring-batch.ts
 */

import 'dotenv/config';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { and, gte, lte, isNotNull, sql } from 'drizzle-orm';
import { findSimilarEvents } from '../../lib/db/similaritySearch';
import { checkWeeklyRecurring } from '../../lib/ai/recurringDetection';
import { azureChatCompletion, isAzureAIEnabled } from '../../lib/ai/provider-clients';
import * as fs from 'fs';

interface ScoringTestResult {
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string | null;
  eventOrganizer: string | null;
  eventPrice: string | null;
  eventTags: string[] | null;
  eventDescription: string | null;
  eventSummary: string | null;

  // Recurring check
  isWeeklyRecurring: boolean;
  recurringMatchCount: number;

  // Similar events
  similarEventsCount: number;
  similarEvents: Array<{
    title: string;
    location: string | null;
    date: string;
    similarity: number;
  }>;

  // AI scoring
  rawPrompt: string;
  rawResponse: string;
  parsedScore: {
    score: number;
    rarity: number;
    unique: number;
    magnitude: number;
    reason: string;
  } | null;
  error: string | null;
}

const SCORING_SYSTEM_PROMPT = `You are an expert Event Curator scoring events for a local events calendar in Asheville, NC. Score each event on THREE dimensions (0-10 each) to help users discover the most interesting events.

## DIMENSION 1 - Rarity & Urgency (How often does this happen?)

0-2 Points (The Routine): Daily or weekly recurring events with no end date
- Examples: Daily AA meetings, weekly "Morning Sit" meditation, weekly trivia nights, weekly open mics

3-5 Points (The Periodic): Monthly, bi-monthly, or recurring workshops
- Examples: "Second Saturday" art strolls, monthly book clubs, monthly beginner seminars

6-8 Points (The Seasonal/Limited): Annual events, holiday-specific, or theater runs with closing dates
- Examples: "The Nutcracker" (seasonal), a 3-week theater run, holiday markets

9-10 Points (The One-Off): Specific tour dates, major festivals, unique one-time gatherings
- Examples: National touring artist concert, Billy Strings 3-night run, traveling exhibit

## DIMENSION 2 - Cool & Unique Factor (How novel/interesting is this?)

0-2 Points (Utility/Standard): Functional meetings, generic support groups, standard classes
- Examples: "Real Estate Exam Prep", "Stroke Support Group", "City Council Meeting"

3-5 Points (Standard Entertainment): Fun but common activities found in most cities
- Examples: Standard stand-up comedy, cover band at brewery, generic yoga class

6-8 Points (Niche/Creative): Activities with a specific "hook", specialized skills, immersive elements
- Examples: "Doom Metal Yoga", "Lost Wax Casting", "Sourdough for Beginners", tribute bands

9-10 Points (The "Wow" Factor): Highly unusual, visually spectacular, or culturally unique
- Examples: "GWAR" (heavy metal aliens), "Mini Wrestling", large-scale art installations

## DIMENSION 3 - Talent & Production Magnitude (What's the scale/caliber?)

0-2 Points (Community/Peer-Led): No professional production; community gatherings
- Examples: "Social Seniors" meetup, book club discussion, peer-led hike

3-5 Points (Local Professional): Talented local bands, brewery events, skilled local instructors
- Examples: Local bluegrass bands, local art teachers, brewery trivia hosts

6-8 Points (Regional/High-End Local): Professional theater companies, regional touring acts, high-end galleries
- Examples: NC Stage Company productions, Asheville Symphony, regional touring comics

9-10 Points (National/International): Household names, arena fillers, legendary status
- Examples: Bob Dylan, Robert Plant, The Avett Brothers, Harlem Globetrotters

## SIMILAR EVENTS CONTEXT

You will be given a list of semantically similar upcoming events. Use this to:
- Assess rarity: If many similar events exist, lower the rarity score
- Identify patterns: Weekly trivia at different venues still counts as common
- Consider uniqueness: A unique event has few semantic matches

## OUTPUT FORMAT

Return ONLY valid JSON:
{"rarity": N, "unique": N, "magnitude": N, "reason": "One sentence explaining the total score."}

Where N is an integer from 0-10. The reason should be concise (under 100 chars).`;

async function main() {
  console.log('Testing event scoring on 30 random events...\n');

  if (!isAzureAIEnabled()) {
    console.error('Azure AI not configured. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT.');
    process.exit(1);
  }

  const now = new Date();
  const oneMonthFromNow = new Date();
  oneMonthFromNow.setDate(oneMonthFromNow.getDate() + 30);

  // Get 40 random events with embeddings from next month
  console.log('Fetching 40 random events with embeddings...');
  const testEvents = await db
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
        gte(events.startDate, now),
        lte(events.startDate, oneMonthFromNow)
      )
    )
    .orderBy(sql`RANDOM()`)
    .limit(40);

  console.log(`Found ${testEvents.length} events to test\n`);

  const results: ScoringTestResult[] = [];

  for (let i = 0; i < testEvents.length; i++) {
    const event = testEvents[i];
    console.log(`[${i + 1}/${testEvents.length}] Processing: ${event.title.slice(0, 50)}...`);

    const result: ScoringTestResult = {
      eventId: event.id,
      eventTitle: event.title,
      eventDate: event.startDate.toISOString(),
      eventLocation: event.location,
      eventOrganizer: event.organizer,
      eventPrice: event.price,
      eventTags: event.tags,
      eventDescription: event.description?.slice(0, 500) || null,
      eventSummary: event.aiSummary,
      isWeeklyRecurring: false,
      recurringMatchCount: 0,
      similarEventsCount: 0,
      similarEvents: [],
      rawPrompt: '',
      rawResponse: '',
      parsedScore: null,
      error: null,
    };

    try {
      // Skip if already daily recurring
      if (event.recurringType === 'daily') {
        result.isWeeklyRecurring = false;
        result.parsedScore = {
          score: 5,
          rarity: 1,
          unique: 2,
          magnitude: 2,
          reason: 'Daily recurring event',
        };
        results.push(result);
        console.log(`  -> Daily recurring, auto-scored 5/30`);
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
      result.isWeeklyRecurring = recurringCheck.isWeeklyRecurring;
      result.recurringMatchCount = recurringCheck.matchCount;

      if (recurringCheck.isWeeklyRecurring) {
        result.parsedScore = {
          score: 5,
          rarity: 1,
          unique: 2,
          magnitude: 2,
          reason: 'Weekly recurring event',
        };
        results.push(result);
        console.log(
          `  -> Weekly recurring (${recurringCheck.matchCount} matches), auto-scored 5/30`
        );
        continue;
      }

      // Get similar events
      const similarEvents = await findSimilarEvents(event.id, {
        limit: 20,
        minSimilarity: 0.4,
        futureOnly: true,
        orderBy: 'similarity',
      });

      result.similarEventsCount = similarEvents.length;
      result.similarEvents = similarEvents.map((e) => ({
        title: e.title,
        location: e.location,
        date: e.startDate.toISOString(),
        similarity: e.similarity,
      }));

      // Build prompt
      const eventInfo = [
        `Title: ${event.title}`,
        event.description ? `Description: ${event.description.slice(0, 300)}` : null,
        event.location ? `Location: ${event.location}` : null,
        event.organizer ? `Organizer: ${event.organizer}` : null,
        event.tags?.length ? `Tags: ${event.tags.join(', ')}` : null,
        event.aiSummary ? `Summary: ${event.aiSummary}` : null,
        `Date: ${event.startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`,
        event.price ? `Price: ${event.price}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      let similarEventsText = '(No similar events found - this may indicate a unique event)';
      if (similarEvents.length > 0) {
        const eventLines = similarEvents.map((e, idx) => {
          const dateStr = e.startDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });
          const location = e.location || e.organizer || 'Unknown venue';
          const similarity = Math.round(e.similarity * 100);
          return `${idx + 1}. "${e.title}" at ${location} on ${dateStr} (${similarity}% similar)`;
        });
        similarEventsText = eventLines.join('\n');
      }

      const userPrompt = `Score this event:

${eventInfo}

Similar upcoming events (by semantic similarity):
${similarEventsText}`;

      result.rawPrompt = userPrompt;

      // Call AI
      const aiResult = await azureChatCompletion(SCORING_SYSTEM_PROMPT, userPrompt, {
        maxTokens: 20000,
      });

      if (aiResult) {
        result.rawResponse = aiResult.content;

        // Parse response
        const cleanedText = aiResult.content
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();

        const parsed = JSON.parse(cleanedText);

        const clamp = (n: unknown): number => {
          const num = typeof n === 'number' ? n : parseInt(String(n), 10);
          if (isNaN(num)) return 5;
          return Math.max(0, Math.min(10, Math.round(num)));
        };

        const rarity = clamp(parsed.rarity);
        const unique = clamp(parsed.unique);
        const magnitude = clamp(parsed.magnitude);

        result.parsedScore = {
          score: rarity + unique + magnitude,
          rarity,
          unique,
          magnitude,
          reason: parsed.reason || 'No reason provided',
        };

        console.log(
          `  -> Score: ${result.parsedScore.score}/30 (R:${rarity} U:${unique} M:${magnitude})`
        );
      } else {
        result.error = 'No response from Azure AI';
        console.log(`  -> ERROR: No response`);
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.log(`  -> ERROR: ${result.error}`);
    }

    results.push(result);

    // Delay between requests
    await new Promise((r) => setTimeout(r, 500));
  }

  // Save results to file
  const outputPath = 'scripts/ai/scoring-test-results.json';
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results saved to ${outputPath}`);

  // Print summary
  const scored = results.filter((r) => r.parsedScore);
  const errors = results.filter((r) => r.error);
  const recurring = results.filter(
    (r) => r.isWeeklyRecurring || r.parsedScore?.reason.includes('recurring')
  );

  console.log('\n═══════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Total events: ${results.length}`);
  console.log(`Successfully scored: ${scored.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Auto-scored recurring: ${recurring.length}`);

  if (scored.length > 0) {
    const scores = scored.map((r) => r.parsedScore!.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);

    console.log(`\nScore distribution:`);
    console.log(`  Average: ${avgScore.toFixed(1)}/30`);
    console.log(`  Min: ${minScore}/30`);
    console.log(`  Max: ${maxScore}/30`);

    const lowScores = scored.filter((r) => r.parsedScore!.score <= 10);
    const midScores = scored.filter((r) => r.parsedScore!.score > 10 && r.parsedScore!.score <= 20);
    const highScores = scored.filter((r) => r.parsedScore!.score > 20);

    console.log(`  Low (0-10): ${lowScores.length}`);
    console.log(`  Mid (11-20): ${midScores.length}`);
    console.log(`  High (21-30): ${highScores.length}`);
  }

  console.log('\n═══════════════════════════════════════════════════');
}

main().catch(console.error);
