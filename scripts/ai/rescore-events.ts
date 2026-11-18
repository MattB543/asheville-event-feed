/**
 * Re-score events with the current scoring prompt. The AI cron only scores
 * events that have no score yet, so a prompt change reaches existing rows only
 * through this.
 *
 *   npx tsx scripts/ai/rescore-events.ts <idPrefix> [<idPrefix> ...] [--apply]
 *
 * Dry run by default: prints old -> new for each event. --apply writes the new
 * scores. scoreOverride is never touched.
 */
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { generateEventScore } from '../../lib/ai/scoring';
import { findSimilarEvents } from '../../lib/db/similaritySearch';

const CONCURRENCY = 5;

async function rescore(prefix: string, apply: boolean): Promise<string> {
  const rows = await db
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
      score: events.score,
      scoreRarity: events.scoreRarity,
      scoreUnique: events.scoreUnique,
      scoreMagnitude: events.scoreMagnitude,
      scoreAshevilleWeird: events.scoreAshevilleWeird,
      scoreSocial: events.scoreSocial,
    })
    .from(events)
    .where(sql`${events.id}::text LIKE ${prefix + '%'}`);

  if (rows.length !== 1) return `${prefix}: ${rows.length} events match, skipped`;
  const event = rows[0];

  const similar = await findSimilarEvents(event.id, {
    limit: 20,
    minSimilarity: 0.4,
    futureOnly: true,
    orderBy: 'similarity',
  });
  const result = await generateEventScore(event, similar);
  if (!result) return `${prefix}: scoring failed, left as is | ${event.title.slice(0, 60)}`;

  if (apply) {
    await db
      .update(events)
      .set({
        score: result.score,
        scoreRarity: result.rarity,
        scoreUnique: result.unique,
        scoreMagnitude: result.magnitude,
        scoreReason: result.reason,
        scoreAshevilleWeird: result.ashevilleWeird,
        scoreSocial: result.social,
      })
      .where(eq(events.id, event.id));
  }

  const before = `${event.score} R${event.scoreRarity} U${event.scoreUnique} M${event.scoreMagnitude} W${event.scoreAshevilleWeird} S${event.scoreSocial}`;
  const after = `${result.score} R${result.rarity} U${result.unique} M${result.magnitude} W${result.ashevilleWeird} S${result.social}`;
  const delta = result.score - (event.score ?? 0);
  return `${prefix}: [${before}] -> [${after}] (${delta >= 0 ? '+' : ''}${delta}) | ${event.title.slice(0, 60)}\n    ${result.reason}`;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const prefixes = args.filter((a) => !a.startsWith('--'));
  if (prefixes.length === 0) {
    console.error('Usage: npx tsx scripts/ai/rescore-events.ts <idPrefix> [...] [--apply]');
    process.exit(1);
  }

  console.log(apply ? 'APPLYING new scores\n' : 'Dry run (add --apply to write)\n');
  for (let i = 0; i < prefixes.length; i += CONCURRENCY) {
    const lines = await Promise.all(
      prefixes
        .slice(i, i + CONCURRENCY)
        .map((p) =>
          rescore(p, apply).catch(
            (err) => `${p}: error ${err instanceof Error ? err.message : err}`
          )
        )
    );
    lines.forEach((line) => console.log(line));
  }
  process.exit(0);
}

void main();
