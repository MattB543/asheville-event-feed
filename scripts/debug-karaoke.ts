import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, gte, and } from 'drizzle-orm';

async function check() {
  const now = new Date();

  // Sample karaoke events with their scores
  const samples = await db
    .select({
      title: events.title,
      startDate: events.startDate,
      score: events.score,
      hidden: events.hidden,
    })
    .from(events)
    .where(
      and(sql`array_to_string(${events.tags}, ' ') ILIKE '%karaoke%'`, gte(events.startDate, now))
    )
    .orderBy(events.startDate)
    .limit(30);

  // Count by score tier (standard: <40, quality: 40-69, outstanding: 70+)
  let standard = 0,
    quality = 0,
    outstanding = 0,
    noScore = 0;
  samples.forEach((e) => {
    if (e.score === null) noScore++;
    else if (e.score < 40) standard++;
    else if (e.score < 70) quality++;
    else outstanding++;
  });

  console.log('Karaoke events by score tier (first 30):');
  console.log(`  Standard (<40): ${standard}`);
  console.log(`  Quality (40-69): ${quality}`);
  console.log(`  Outstanding (70+): ${outstanding}`);
  console.log(`  No score: ${noScore}`);

  console.log('\nSample karaoke events with scores:');
  samples
    .slice(0, 15)
    .forEach((e) => console.log(`- score=${e.score ?? 'null'} | ${e.title.slice(0, 50)}`));

  process.exit(0);
}

check().catch(console.error);
