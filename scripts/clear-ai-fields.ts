import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte, sql } from 'drizzle-orm';

async function clearAIFields() {
  const cutoff = new Date('2025-12-29T00:00:00');

  // Count before
  const countBefore = await db.select({ count: sql<number>`count(*)` })
    .from(events)
    .where(gte(events.startDate, cutoff));

  console.log('Future events to clear:', countBefore[0].count);

  await db.update(events)
    .set({
      aiSummary: null,
      tags: sql`'{}'::text[]`,
      score: null,
      scoreRarity: null,
      scoreUnique: null,
      scoreMagnitude: null,
      scoreReason: null,
      embedding: null,
    })
    .where(gte(events.startDate, cutoff));

  console.log('Done! Cleared aiSummary, tags, score fields, and embeddings');
}

clearAIFields().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
