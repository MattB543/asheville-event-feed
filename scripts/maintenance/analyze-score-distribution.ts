import '../../lib/config/env';
import { db } from '../../lib/db';
import { sql } from 'drizzle-orm';
import { getStartOfTodayEastern } from '../../lib/utils/timezone';

type SummaryRow = {
  total_events: number;
  scored_events: number;
  missing_score: number;
  min_day: string | null;
  max_day: string | null;
  days_in_range: number | null;
};

type DistributionRow = {
  score: number;
  count: number;
};

type TierRow = {
  hidden_count: number;
  quality_count: number;
  outstanding_count: number;
};

type PercentileRow = {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
};

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

async function main() {
  const startOfToday = getStartOfTodayEastern();
  const startOfTodayIso = startOfToday.toISOString();
  const baseFilter = sql`
    FROM events
    WHERE start_date >= ${startOfTodayIso}
      AND (hidden IS NULL OR hidden = false)
      AND (
        location IS NULL
        OR (location NOT ILIKE '%online%' AND location NOT ILIKE '%virtual%')
      )
  `;

  const summaryResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_events,
      COUNT(*) FILTER (WHERE score IS NOT NULL)::int as scored_events,
      COUNT(*) FILTER (WHERE score IS NULL)::int as missing_score,
      MIN(start_date)::date as min_day,
      MAX(start_date)::date as max_day,
      (MAX(start_date)::date - MIN(start_date)::date + 1)::int as days_in_range
    ${baseFilter}
  `);
  const summary = (summaryResult[0] || null) as SummaryRow | null;

  if (!summary || summary.total_events === 0) {
    console.log('No future events found for the current filter set.');
    return;
  }

  const daysInRange = summary.days_in_range ?? 0;

  const distributionResult = await db.execute(sql`
    SELECT score, COUNT(*)::int as count
    ${baseFilter}
      AND score IS NOT NULL
    GROUP BY score
    ORDER BY score
  `);
  const distribution = distributionResult as unknown as DistributionRow[];

  const tierResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE score <= 14)::int as hidden_count,
      COUNT(*) FILTER (WHERE score BETWEEN 15 AND 18)::int as quality_count,
      COUNT(*) FILTER (WHERE score >= 19)::int as outstanding_count
    ${baseFilter}
      AND score IS NOT NULL
  `);
  const tiers = (tierResult[0] || null) as TierRow | null;

  const percentileResult = await db.execute(sql`
    SELECT
      percentile_cont(0.10) WITHIN GROUP (ORDER BY score) as p10,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY score) as p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY score) as p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY score) as p75,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY score) as p90,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY score) as p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY score) as p99
    ${baseFilter}
      AND score IS NOT NULL
  `);
  const percentiles = (percentileResult[0] || null) as PercentileRow | null;

  console.log('='.repeat(60));
  console.log('Future Event Score Analysis');
  console.log('='.repeat(60));
  console.log(`Date range:       ${summary.min_day} to ${summary.max_day}`);
  console.log(`Days in range:    ${daysInRange}`);
  console.log(`Total events:     ${summary.total_events}`);
  console.log(`Scored events:    ${summary.scored_events}`);
  console.log(`Missing score:    ${summary.missing_score}`);
  console.log('');
  console.log('Filters: start_date >= today (ET), hidden = false, not online/virtual');
  console.log('');

  if (tiers) {
    console.log('Score tiers (current feed breakpoints):');
    console.log(`Hidden (0-14):     ${tiers.hidden_count}`);
    console.log(`Quality (15-18):   ${tiers.quality_count}`);
    console.log(`Outstanding (19+): ${tiers.outstanding_count}`);
    console.log('');
  }

  if (percentiles) {
    console.log('Percentiles (score):');
    console.log(
      `P10 ${formatNumber(percentiles.p10)} | P25 ${formatNumber(percentiles.p25)} | ` +
        `P50 ${formatNumber(percentiles.p50)} | P75 ${formatNumber(percentiles.p75)}`
    );
    console.log(
      `P90 ${formatNumber(percentiles.p90)} | P95 ${formatNumber(percentiles.p95)} | ` +
        `P99 ${formatNumber(percentiles.p99)}`
    );
    console.log('');
  }

  console.log('Counts by score (avg/day across full range):');
  console.log('Score | Count | Avg/Day');
  for (const row of distribution) {
    const avgPerDay = daysInRange > 0 ? row.count / daysInRange : 0;
    const scoreText = String(row.score).padStart(5, ' ');
    const countText = String(row.count).padStart(5, ' ');
    const avgText = avgPerDay.toFixed(3).padStart(7, ' ');
    console.log(`${scoreText} | ${countText} | ${avgText}`);
  }
}

main().catch((error) => {
  console.error('Failed to analyze scores:', error);
  process.exitCode = 1;
});
