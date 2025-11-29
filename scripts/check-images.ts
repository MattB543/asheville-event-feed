import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, like, isNull, sql } from 'drizzle-orm';

async function checkImages() {
  console.log('=== Checking Image URLs in Database ===\n');

  // Get all events
  const allEvents = await db.select().from(events);
  console.log('Total events:', allEvents.length);

  // Count by image type
  const nullImages = allEvents.filter(e => !e.imageUrl);
  const aiImages = allEvents.filter(e => e.imageUrl?.startsWith('data:'));
  const fallbackImages = allEvents.filter(e => e.imageUrl?.includes('/images/fallbacks/'));
  const httpImages = allEvents.filter(e => e.imageUrl?.startsWith('http'));

  console.log('\n--- Image URL Breakdown ---');
  console.log('NULL/empty imageUrl:', nullImages.length);
  console.log('AI-generated (data:):', aiImages.length);
  console.log('Meetup fallback (/images/fallbacks/):', fallbackImages.length);
  console.log('HTTP URLs:', httpImages.length);

  // Check Grove Arcade event
  console.log('\n--- Grove Arcade Event Check ---');
  const groveEvents = allEvents.filter(e =>
    e.title.toLowerCase().includes('grove') ||
    e.title.toLowerCase().includes('arcade')
  );
  console.log('Found', groveEvents.length, 'Grove/Arcade events:');
  groveEvents.forEach(e => {
    console.log(`  [${e.source}] ${e.title}`);
    console.log(`    imageUrl: ${e.imageUrl ? e.imageUrl.substring(0, 80) + '...' : 'NULL'}`);
  });

  // Check Meetup events specifically
  console.log('\n--- Meetup Events with Fallback Images ---');
  const meetupFallback = allEvents.filter(e =>
    e.source === 'MEETUP' && e.imageUrl?.includes('/images/fallbacks/')
  );
  console.log('Count:', meetupFallback.length);
  meetupFallback.slice(0, 5).forEach(e => {
    console.log(`  ${e.title.substring(0, 50)}`);
    console.log(`    imageUrl: ${e.imageUrl}`);
  });

  // Check events that SHOULD have gotten AI images but didn't
  console.log('\n--- Events needing AI images (no imageUrl or fallback) ---');
  const needsAI = allEvents.filter(e =>
    !e.imageUrl || e.imageUrl.includes('/images/fallbacks/')
  );
  console.log('Count:', needsAI.length);
  needsAI.slice(0, 10).forEach(e => {
    console.log(`  [${e.source}] ${e.title.substring(0, 50)}`);
  });

  process.exit(0);
}

checkImages().catch(console.error);
