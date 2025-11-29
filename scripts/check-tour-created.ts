import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { like } from 'drizzle-orm';

async function check() {
  const results = await db.select()
    .from(events)
    .where(like(events.title, '%Public Tour:%'));

  console.log('Comparing Public Tour events:\n');

  const sameTimeEvents = results.filter(e =>
    e.startDate.toISOString().includes('2025-11-29T19:00')
  );

  console.log(`Found ${sameTimeEvents.length} events at same time (2025-11-29T19:00):\n`);

  sameTimeEvents.forEach(e => {
    console.log('Title:', e.title);
    console.log('URL:', e.url);
    console.log('Description:', (e.description || '').substring(0, 300) + '...');
    console.log('Created:', e.createdAt);
    console.log('---');
  });

  process.exit(0);
}
check().catch(console.error);
