import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq } from 'drizzle-orm';

async function check() {
  const fbEvents = await db.select({
    title: events.title,
    interestedCount: events.interestedCount,
    goingCount: events.goingCount,
  }).from(events).where(eq(events.source, 'FACEBOOK'));

  console.log('Facebook events in DB:', fbEvents.length);

  let withCounts = 0;
  let withoutCounts = 0;
  const missing: string[] = [];

  for (const e of fbEvents) {
    if (e.interestedCount !== null || e.goingCount !== null) {
      withCounts++;
    } else {
      withoutCounts++;
      missing.push(e.title);
    }
  }

  console.log('With counts:', withCounts);
  console.log('Without counts:', withoutCounts);

  if (missing.length > 0) {
    console.log('\nEvents missing counts:');
    missing.forEach(t => console.log('  -', t));
  } else {
    console.log('\n✅ All Facebook events have interested/going counts!');
  }
}

check().catch(console.error);
