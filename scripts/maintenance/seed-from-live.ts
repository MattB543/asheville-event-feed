import '../../lib/config/env';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { sql } from 'drizzle-orm';

// Copies upcoming events from the live site's public export into DATABASE_URL.
// Live ids are kept so event URLs and share links match production.
const EXPORT_URL = 'https://www.avlgo.com/api/export/json';
const BATCH_SIZE = 500;

interface ExportEvent {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description: string | null;
  startDate: string;
  location: string | null;
  zip: string | null;
  organizer: string | null;
  price: string | null;
  url: string;
  imageUrl: string | null;
  tags: string[] | null;
  aiSummary: string | null;
  interestedCount: number | null;
  goingCount: number | null;
  favoriteCount: number | null;
  score: number | null;
  scoreRarity: number | null;
  scoreUnique: number | null;
  scoreMagnitude: number | null;
  scoreReason: string | null;
  scoreAshevilleWeird: number | null;
  scoreSocial: number | null;
  recurringType: string | null;
  recurringEndDate: string | null;
  timeUnknown: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
}

const toDate = (value: string | null) => (value ? new Date(value) : null);

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://unset').hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to seed a non-local database (${host})`);
  }

  console.log(`Fetching ${EXPORT_URL} ...`);
  const response = await fetch(EXPORT_URL);
  if (!response.ok) throw new Error(`Export failed: ${response.status}`);
  const { events: rows } = (await response.json()) as { events: ExportEvent[] };

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((e) => ({
      ...e,
      startDate: new Date(e.startDate),
      recurringEndDate: toDate(e.recurringEndDate),
      createdAt: toDate(e.createdAt),
      updatedAt: toDate(e.updatedAt),
      lastSeenAt: toDate(e.lastSeenAt),
      timeUnknown: e.timeUnknown ?? false,
      favoriteCount: e.favoriteCount ?? 0,
    }));
    const result = await db
      .insert(events)
      .values(batch)
      .onConflictDoNothing()
      .returning({ id: events.id });
    inserted += result.length;
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(events);
  console.log(
    `Copied ${inserted} new events (${rows.length - inserted} already here). Total: ${count}.`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
