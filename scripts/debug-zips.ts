import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte, asc } from 'drizzle-orm';

async function main() {
  // Get future events (same as page.tsx query)
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const futureEvents = await db
    .select()
    .from(events)
    .where(gte(events.startDate, startOfToday))
    .orderBy(asc(events.startDate));

  console.log('=== FUTURE EVENTS ZIP ANALYSIS ===');
  console.log(`Total future events: ${futureEvents.length}`);

  // Count events with zips
  const eventsWithZip = futureEvents.filter(e => e.zip);
  console.log(`Future events with zip: ${eventsWithZip.length}`);

  // Count per zip
  const zipCounts = new Map<string, number>();
  futureEvents.forEach(e => {
    if (e.zip) {
      zipCounts.set(e.zip, (zipCounts.get(e.zip) || 0) + 1);
    }
  });

  console.log(`\nUnique zip codes: ${zipCounts.size}`);
  console.log('\nAll zip codes and counts:');
  const sorted = Array.from(zipCounts.entries()).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([zip, count]) => {
    const marker = count >= 3 ? ' ✓' : '';
    console.log(`  ${zip}: ${count} events${marker}`);
  });

  const meetsThreshold = sorted.filter(([, count]) => count >= 3);
  console.log(`\nZips meeting threshold (>=3): ${meetsThreshold.length}`);

  // Show some sample events with their zip values
  console.log('\n=== SAMPLE EVENTS ===');
  for (const e of futureEvents.slice(0, 10)) {
    console.log(`  "${e.title.substring(0, 40)}..." - zip: ${e.zip || 'NULL'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
