import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, and, gte, lte, ne } from 'drizzle-orm';

const checks = [
  { name: 'Welcoming Concert', date: '2026-03-29' },
  { name: 'Kate Leigh Bryant', date: '2026-03-29' },
  { name: 'Angela Perley', date: '2026-04-18' },
  { name: 'Demon Ravers', date: '2026-03-29' },
  { name: 'YMCA Mobile Market', date: '2026-06-24' },
  { name: 'Fringe Revival', date: '2026-03-29' },
  { name: 'Woodfin 5K', date: '2026-04-25' },
  { name: 'Re-Wilding', date: '2026-04-12' },
  { name: 'Poetry Open Mic', date: '2026-04-01' },
  { name: 'Oddities', date: '2026-04-25' },
  { name: 'Craft Night', date: '2026-04-23' },
  { name: 'Wee Naturalists', date: '2026-04-17' },
  { name: 'Mindfulness Meditation', date: '2026-04-30' },
];

async function main() {
  for (const c of checks) {
    const term = c.name.split(' ').filter((w) => w.length > 3)[0] || c.name;
    const rows = await db
      .select({
        id: events.id,
        title: events.title,
        startDate: events.startDate,
        source: events.source,
      })
      .from(events)
      .where(
        and(
          sql`${events.title} ILIKE ${'%' + term + '%'}`,
          gte(events.startDate, new Date(new Date(c.date).getTime() - 3 * 86400000)),
          lte(events.startDate, new Date(new Date(c.date).getTime() + 3 * 86400000)),
          ne(events.hidden, true)
        )
      )
      .limit(3);
    if (rows.length > 0) {
      console.log('FOUND:', c.name);
      for (const r of rows)
        console.log('  ->', r.title, '|', r.startDate.toISOString().slice(0, 10), '|', r.source);
    } else {
      console.log('MISSING:', c.name);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
