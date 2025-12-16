/**
 * Sanity Check Prices Script
 * Validates the enriched price data looks reasonable
 */

import '../lib/config/env';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function sanityCheck() {
  console.log('=== SANITY CHECK: ENRICHED EVENTS ===\n');

  // 1. Price distribution
  const priceDist = await db.execute(sql`
    SELECT price, COUNT(*)::int as count
    FROM events
    WHERE start_date >= NOW()
      AND price IS NOT NULL
      AND price != 'Unknown'
    GROUP BY price
    ORDER BY count DESC
    LIMIT 20
  `);

  console.log('TOP 20 PRICE VALUES:');
  console.log('-'.repeat(40));
  const priceRows = (priceDist as any).rows || priceDist;
  for (const row of priceRows) {
    console.log(`  ${String(row.price).padEnd(20)} ${row.count} events`);
  }

  // 2. Sample of specific prices (not Free/Ticketed)
  console.log('\n\nSAMPLE EVENTS WITH SPECIFIC PRICES:');
  console.log('-'.repeat(70));
  const specificPrices = await db.execute(sql`
    SELECT title, price, source
    FROM events
    WHERE start_date >= NOW()
      AND price IS NOT NULL
      AND price NOT IN ('Unknown', 'Free', 'Ticketed')
    ORDER BY RANDOM()
    LIMIT 12
  `);

  const specificRows = (specificPrices as any).rows || specificPrices;
  for (const row of specificRows) {
    const title = row.title.length > 45 ? row.title.slice(0, 45) + '...' : row.title;
    console.log(`  [${row.source}] ${title}`);
    console.log(`    -> Price: ${row.price}`);
  }

  // 3. Sample Free events
  console.log('\n\nSAMPLE FREE EVENTS (verify these look free):');
  console.log('-'.repeat(70));
  const freeEvents = await db.execute(sql`
    SELECT title, source
    FROM events
    WHERE start_date >= NOW()
      AND price = 'Free'
    ORDER BY RANDOM()
    LIMIT 10
  `);

  const freeRows = (freeEvents as any).rows || freeEvents;
  for (const row of freeRows) {
    const title = row.title.length > 55 ? row.title.slice(0, 55) + '...' : row.title;
    console.log(`  [${row.source}] ${title}`);
  }

  // 4. Sample Ticketed events
  console.log('\n\nSAMPLE TICKETED EVENTS (verify these require tickets):');
  console.log('-'.repeat(70));
  const ticketedEvents = await db.execute(sql`
    SELECT title, source
    FROM events
    WHERE start_date >= NOW()
      AND price = 'Ticketed'
    ORDER BY RANDOM()
    LIMIT 10
  `);

  const ticketedRows = (ticketedEvents as any).rows || ticketedEvents;
  for (const row of ticketedRows) {
    const title = row.title.length > 55 ? row.title.slice(0, 55) + '...' : row.title;
    console.log(`  [${row.source}] ${title}`);
  }

  // 5. Summary stats
  console.log('\n\n=== SUMMARY STATS ===');
  const stats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE price = 'Free')::int as free_count,
      COUNT(*) FILTER (WHERE price = 'Ticketed')::int as ticketed_count,
      COUNT(*) FILTER (WHERE price ~ '^\\$')::int as dollar_price_count,
      COUNT(*) FILTER (WHERE price IS NULL OR price = 'Unknown')::int as unknown_count,
      COUNT(*)::int as total
    FROM events
    WHERE start_date >= NOW()
  `);

  const statsRows = (stats as any).rows || stats;
  const s = statsRows[0];
  const total = s.total;
  console.log(`  Free:           ${s.free_count} (${Math.round(s.free_count/total*100)}%)`);
  console.log(`  Ticketed:       ${s.ticketed_count} (${Math.round(s.ticketed_count/total*100)}%)`);
  console.log(`  Specific ($):   ${s.dollar_price_count} (${Math.round(s.dollar_price_count/total*100)}%)`);
  console.log(`  Unknown/null:   ${s.unknown_count} (${Math.round(s.unknown_count/total*100)}%)`);
  console.log(`  -------------------------`);
  console.log(`  Total:          ${total}`);
}

sanityCheck()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
