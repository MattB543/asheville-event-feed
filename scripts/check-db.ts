import '../lib/config/env';

import { ilike } from 'drizzle-orm';

async function checkDb() {
  const { db } = await import('../lib/db');
  const { events } = await import('../lib/db/schema');

  console.log('Checking events table for "Growing in Motion"...');
  try {
    const results = await db.select().from(events).where(ilike(events.title, '%Growing in Motion%'));
    
    if (results.length === 0) {
        console.log('No events found matching "Growing in Motion".');
    } else {
        results.forEach(ev => {
            console.log(`Title: "${ev.title}" | SourceId: ${ev.sourceId} | StartDate: ${ev.startDate}`);
        });
    }
  } catch (error) {
    console.error('Error checking database:', error);
  }
  process.exit(0);
}

checkDb();
