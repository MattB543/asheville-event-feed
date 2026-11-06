/**
 * Fills the browser tests' database with a few sample events before the test server starts.
 * Run by playwright.config.ts with TEST_DATABASE_URL set, so the app reads this database.
 */
import { rmSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import setup from '../dbGlobalSetup';
import { db, closeDb } from '../../lib/db';
import { events } from '../../lib/db/schema';

// Evenings in the coming days: 23:00 UTC is 7 PM Eastern for most of the year
const daysFromNow = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(23, 0, 0, 0);
  return date;
};

const SAMPLE_EVENTS = [
  {
    title: 'Sample Bluegrass Jam',
    location: 'Jack of the Wood, 95 Patton Ave, Asheville, NC',
    price: '$10',
    tags: ['Live Music'],
    days: 1,
  },
  {
    title: 'Sample Pottery Class',
    location: 'Odyssey ClayWorks, 236 Clingman Ave, Asheville, NC',
    price: '$45',
    tags: ['Classes'],
    days: 2,
  },
  {
    title: 'Sample Yoga in the Park',
    location: 'Pack Square Park, 80 Court Plaza, Asheville, NC',
    price: 'Free',
    tags: ['Fitness'],
    days: 3,
  },
];

async function prepare() {
  // The last run's cached feed would outlive the reseed (its ids no longer exist)
  rmSync('.next/cache/fetch-cache', { recursive: true, force: true });
  await setup();
  await db.execute(sql`TRUNCATE events CASCADE`);
  await db.insert(events).values(
    SAMPLE_EVENTS.map((event, i) => ({
      sourceId: `sample-${i}`,
      source: 'AVL_TODAY',
      title: event.title,
      description: `${event.title}: a sample event for the browser tests.`,
      startDate: daysFromNow(event.days),
      location: event.location,
      organizer: 'AVL GO tests',
      price: event.price,
      tags: event.tags,
      // The feed shows only top-rated events until a day is expanded
      score: 18,
      url: `https://example.com/sample-${i}`,
      lastSeenAt: new Date(),
    }))
  );
  await closeDb();
}

prepare().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
