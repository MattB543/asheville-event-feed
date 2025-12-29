import '../../lib/config/env';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  const result = await db.select({ count: sql`count(*)` }).from(events);
  const totalEvents = result[0]?.count || 0;

  const ebResult = await db.select({ count: sql`count(*)` }).from(events).where(sql`source = 'EVENTBRITE'`);
  const ebCount = ebResult[0]?.count || 0;

  const avlResult = await db.select({ count: sql`count(*)` }).from(events).where(sql`source = 'AVL_TODAY'`);
  const avlCount = avlResult[0]?.count || 0;

  console.log('='.repeat(50));
  console.log('Database Event Summary');
  console.log('='.repeat(50));
  console.log(`Total Events:        ${totalEvents}`);
  console.log(`EventBrite Events:   ${ebCount}`);
  console.log(`AVL Today Events:    ${avlCount}`);
  console.log('='.repeat(50));
}

main();
