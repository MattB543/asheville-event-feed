import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { gte, sql } from 'drizzle-orm';

async function main() {
  const now = new Date();

  console.log('Resetting AI fields for all future events...');

  // Reset AI fields for all future events
  await db
    .update(events)
    .set({
      aiSummary: null,
      score: null,
      scoreRarity: null,
      scoreUnique: null,
      scoreMagnitude: null,
      scoreReason: null,
    })
    .where(gte(events.startDate, now));

  // Count how many events were affected
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(gte(events.startDate, now));

  console.log(`Reset AI fields for ${countResult[0].count} future events`);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
