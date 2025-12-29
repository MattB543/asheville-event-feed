/**
 * Data Quality Check Script
 *
 * Analyzes the database to identify events with missing or weak data.
 * Groups results by source to identify which scrapers need improvement.
 *
 * Usage: npx tsx scripts/maintenance/check-data-quality.ts
 */

import '../../lib/config/env';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { sql } from 'drizzle-orm';

// Type interface for query results
interface DataQualityRow {
  source: string;
  total_events: number;
  unknown_price: number;
  unknown_price_pct: number;
  time_unknown: number;
  time_unknown_pct: number;
  missing_description: number;
  missing_location: number;
  missing_organizer: number;
  missing_image: number;
}

async function checkDataQuality() {
  console.log('\n=== EVENT DATA QUALITY REPORT ===\n');

  // Get current date for filtering to future events only (as ISO string for SQL)
  const nowISO = new Date().toISOString();

  // Query data quality metrics grouped by source
  const results = await db.execute(sql`
    SELECT
      source,
      COUNT(*)::int as total_events,
      COUNT(CASE WHEN price IS NULL OR price = 'Unknown' THEN 1 END)::int as unknown_price,
      ROUND(COUNT(CASE WHEN price IS NULL OR price = 'Unknown' THEN 1 END)::numeric * 100 / NULLIF(COUNT(*), 0), 1) as unknown_price_pct,
      COUNT(CASE WHEN time_unknown = true THEN 1 END)::int as time_unknown,
      ROUND(COUNT(CASE WHEN time_unknown = true THEN 1 END)::numeric * 100 / NULLIF(COUNT(*), 0), 1) as time_unknown_pct,
      COUNT(CASE WHEN description IS NULL OR TRIM(description) = '' THEN 1 END)::int as missing_description,
      COUNT(CASE WHEN location IS NULL OR TRIM(location) = '' THEN 1 END)::int as missing_location,
      COUNT(CASE WHEN organizer IS NULL OR TRIM(organizer) = '' THEN 1 END)::int as missing_organizer,
      COUNT(CASE WHEN image_url IS NULL OR TRIM(image_url) = '' THEN 1 END)::int as missing_image
    FROM events
    WHERE start_date >= ${nowISO}::timestamp
    GROUP BY source
    ORDER BY total_events DESC
  `);

  // Handle different result formats from db.execute
  const rows = (results as { rows?: unknown[] }).rows || results;
  const stats = (Array.isArray(rows) ? rows : []) as DataQualityRow[];

  // Print summary table
  console.log('Future Events Data Quality by Source:\n');
  console.log('Source           | Total | Unknown Price | Time Unknown | No Desc | No Loc | No Org | No Img');
  console.log('-'.repeat(100));

  let totalEvents = 0;
  let totalUnknownPrice = 0;
  let totalTimeUnknown = 0;

  for (const row of stats) {
    // SQL returns snake_case column names
    const source = (row.source || 'UNKNOWN').padEnd(16);
    const total = String(row.total_events).padStart(5);
    const unknownPrice = `${row.unknown_price} (${row.unknown_price_pct}%)`.padStart(13);
    const timeUnknownStr = `${row.time_unknown} (${row.time_unknown_pct}%)`.padStart(12);
    const noDesc = String(row.missing_description).padStart(7);
    const noLoc = String(row.missing_location).padStart(6);
    const noOrg = String(row.missing_organizer).padStart(6);
    const noImg = String(row.missing_image).padStart(6);

    console.log(`${source} | ${total} | ${unknownPrice} | ${timeUnknownStr} | ${noDesc} | ${noLoc} | ${noOrg} | ${noImg}`);

    totalEvents += Number(row.total_events) || 0;
    totalUnknownPrice += Number(row.unknown_price) || 0;
    totalTimeUnknown += Number(row.time_unknown) || 0;
  }

  console.log('-'.repeat(100));
  console.log(`\nTOTAL: ${totalEvents} future events`);
  console.log(`  Unknown Price: ${totalUnknownPrice} (${((totalUnknownPrice / totalEvents) * 100).toFixed(1)}%)`);
  console.log(`  Time Unknown:  ${totalTimeUnknown} (${((totalTimeUnknown / totalEvents) * 100).toFixed(1)}%)`);

  // Get sample events with unknown price
  console.log('\n\n=== SAMPLE EVENTS WITH UNKNOWN PRICE ===\n');

  const unknownPriceEvents = await db
    .select({
      source: events.source,
      title: events.title,
      description: events.description,
      url: events.url,
    })
    .from(events)
    .where(sql`(price IS NULL OR price = 'Unknown') AND start_date >= ${nowISO}::timestamp`)
    .limit(10);

  for (const ev of unknownPriceEvents) {
    console.log(`[${ev.source}] ${ev.title}`);
    console.log(`  Description: ${(ev.description || '').slice(0, 100)}...`);
    console.log(`  URL: ${ev.url}`);
    console.log('');
  }

  // Get sample events with unknown time
  console.log('\n=== SAMPLE EVENTS WITH UNKNOWN TIME ===\n');

  const unknownTimeEvents = await db
    .select({
      source: events.source,
      title: events.title,
      description: events.description,
      startDate: events.startDate,
      url: events.url,
    })
    .from(events)
    .where(sql`time_unknown = true AND start_date >= ${nowISO}::timestamp`)
    .limit(10);

  for (const ev of unknownTimeEvents) {
    console.log(`[${ev.source}] ${ev.title}`);
    console.log(`  Start: ${ev.startDate?.toISOString()}`);
    console.log(`  Description: ${(ev.description || '').slice(0, 100)}...`);
    console.log(`  URL: ${ev.url}`);
    console.log('');
  }

  console.log('\n=== END OF REPORT ===\n');
}

checkDataQuality()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
