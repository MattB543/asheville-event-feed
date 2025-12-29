/**
 * Backfill zip codes for events that have location data but no zip
 * Uses city name extraction from location strings
 */
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { isNull, sql } from 'drizzle-orm';
import { getZipFromCity } from '../../lib/utils/geo';

async function main() {
  console.log('Backfilling zip codes from location strings...\n');

  // Get all events without zip codes
  const eventsWithoutZip = await db
    .select({
      id: events.id,
      source: events.source,
      location: events.location,
    })
    .from(events)
    .where(isNull(events.zip));

  console.log(`Found ${eventsWithoutZip.length} events without zip codes\n`);

  let updated = 0;
  const updatesBySource: Record<string, number> = {};

  for (const event of eventsWithoutZip) {
    if (!event.location) continue;

    // Try to extract city from location string
    // Common patterns: "Venue, City, NC" or "City, NC" or "Venue, 123 St, City, NC"
    const location = event.location;

    // Pattern 1: Look for "City, NC" or "City, North Carolina"
    const ncMatch = location.match(/([A-Za-z\s]+),\s*(?:NC|North Carolina)/i);
    if (ncMatch) {
      const cityCandidate = ncMatch[1].trim();
      // If it looks like a street address, try the word before the comma
      if (!/^\d/.test(cityCandidate) && !cityCandidate.toLowerCase().includes('street') &&
          !cityCandidate.toLowerCase().includes(' st') && !cityCandidate.toLowerCase().includes(' rd') &&
          !cityCandidate.toLowerCase().includes(' ave') && !cityCandidate.toLowerCase().includes(' dr')) {
        const zip = getZipFromCity(cityCandidate);
        if (zip) {
          await db.update(events).set({ zip }).where(sql`id = ${event.id}`);
          updated++;
          updatesBySource[event.source] = (updatesBySource[event.source] || 0) + 1;
          continue;
        }
      }
    }

    // Pattern 2: Look for known city names anywhere in the location
    const knownCities = [
      'Asheville', 'Black Mountain', 'Weaverville', 'Arden', 'Fletcher',
      'Hendersonville', 'Brevard', 'Candler', 'Leicester', 'Swannanoa',
      'Woodfin', 'Fairview', 'Mars Hill', 'Alexander', 'Old Fort'
    ];

    for (const city of knownCities) {
      if (location.toLowerCase().includes(city.toLowerCase())) {
        const zip = getZipFromCity(city);
        if (zip) {
          await db.update(events).set({ zip }).where(sql`id = ${event.id}`);
          updated++;
          updatesBySource[event.source] = (updatesBySource[event.source] || 0) + 1;
          break;
        }
      }
    }
  }

  console.log(`Updated ${updated} events with zip codes\n`);
  console.log('Updates by source:');
  for (const [source, count] of Object.entries(updatesBySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }

  // Show final coverage
  const coverage = await db.execute(sql`
    SELECT
      source,
      COUNT(*) as total,
      COUNT(zip) as with_zip,
      ROUND(COUNT(zip)::numeric / COUNT(*)::numeric * 100, 1) as coverage_pct
    FROM events
    GROUP BY source
    ORDER BY total DESC
  `);

  console.log('\nFinal coverage:');
  for (const row of coverage as unknown as { source: string; total: number; with_zip: number; coverage_pct: number }[]) {
    console.log(`  ${row.source.padEnd(18)} ${row.with_zip}/${row.total} (${row.coverage_pct}%)`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
