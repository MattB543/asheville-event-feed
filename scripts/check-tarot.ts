import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { ilike, desc, gte, isNotNull, and } from 'drizzle-orm';

async function check() {
  const now = new Date();
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  // Check Tarot with Cats
  const tarot = await db
    .select({
      title: events.title,
      score: events.score,
      scoreAshevilleWeird: events.scoreAshevilleWeird,
      scoreSocial: events.scoreSocial,
      startDate: events.startDate,
    })
    .from(events)
    .where(ilike(events.title, '%tarot%cat%'))
    .limit(3);

  console.log('=== TAROT WITH CATS ===');
  tarot.forEach((e) => {
    console.log(`"${e.title}"`);
    console.log(
      `  Base score: ${e.score}, Asheville Weird: ${e.scoreAshevilleWeird}, Social: ${e.scoreSocial}`
    );
    console.log(`  Date: ${e.startDate}`);
  });

  // What's the minimum base score in current top 30?
  const top30 = await db
    .select({
      title: events.title,
      score: events.score,
    })
    .from(events)
    .where(and(gte(events.startDate, now), isNotNull(events.score)))
    .orderBy(desc(events.score))
    .limit(30);

  const scores = top30.map((e) => e.score || 0);
  const minScore = Math.min(...scores);
  console.log('\n=== TOP 30 BY BASE SCORE ===');
  console.log(`Score range: ${Math.max(...scores)} to ${minScore}`);
  console.log(`#30 event: "${top30[29]?.title}" with score ${top30[29]?.score}`);

  // Check if Tarot with Cats would make top 30
  const tarotScore = tarot[0]?.score || 0;
  console.log(
    `\nTarot with Cats base score (${tarotScore}) ${tarotScore >= minScore ? '>=' : '<'} min top 30 score (${minScore})`
  );

  process.exit(0);
}
check().catch(console.error);
