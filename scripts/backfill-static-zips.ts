/**
 * Backfill zip codes for static venue sources
 * These venues have fixed locations, so all their events get the same zip
 */
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, isNull, and, sql } from 'drizzle-orm';

const STATIC_VENUE_ZIPS: Record<string, string> = {
  'NC_STAGE': '28801',       // 15 Stage Lane, Asheville
  'MISFIT_IMPROV': '28803',  // 573 Fairview Rd, Asheville
  'GREY_EAGLE': '28801',     // 185 Clingman Ave, Asheville
  'ORANGE_PEEL': '28801',    // 101 Biltmore Ave, Asheville
  'HARRAHS': '28801',        // 777 Casino Dr, Cherokee (using 28801 as configured)
  'UDHARMA': '28806',        // 85 N Lexington Ave, Asheville (West Asheville)
};

async function main() {
  console.log('Backfilling zip codes for static venue sources...\n');

  let totalUpdated = 0;

  for (const [source, zip] of Object.entries(STATIC_VENUE_ZIPS)) {
    // Update all events from this source that have null zip
    const result = await db
      .update(events)
      .set({ zip })
      .where(and(eq(events.source, source), isNull(events.zip)))
      .returning({ id: events.id });

    console.log(`${source}: Updated ${result.length} events with zip ${zip}`);
    totalUpdated += result.length;
  }

  console.log(`\nTotal updated: ${totalUpdated} events`);

  // Show final coverage for these sources
  const coverage = await db.execute(sql`
    SELECT
      source,
      COUNT(*) as total,
      COUNT(zip) as with_zip,
      ROUND(COUNT(zip)::numeric / COUNT(*)::numeric * 100, 1) as coverage_pct
    FROM events
    WHERE source IN ('NC_STAGE', 'MISFIT_IMPROV', 'GREY_EAGLE', 'ORANGE_PEEL', 'HARRAHS', 'UDHARMA')
    GROUP BY source
    ORDER BY source
  `);

  console.log('\nFinal coverage:');
  for (const row of coverage as unknown as { source: string; total: number; with_zip: number; coverage_pct: number }[]) {
    console.log(`  ${row.source}: ${row.with_zip}/${row.total} (${row.coverage_pct}%)`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
