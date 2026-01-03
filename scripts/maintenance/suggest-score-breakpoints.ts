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

type Candidate = {
  hiddenMax: number;
  expandedMin: number;
  goldMin: number;
  hiddenAvg: number;
  collapsedAvg: number;
  expandedAvg: number;
  goldAvg: number;
  error: number;
};

const TARGETS = {
  hiddenAvg: 25,
  collapsedAvg: 20,
  expandedAvg: 6,
  goldAvg: 1.5,
};

const RANGES: Record<string, [number, number]> = {
  hiddenAvg: [23, 27],
  collapsedAvg: [18, 22],
  expandedAvg: [5, 7],
  goldAvg: [1, 2],
};

function avg(count: number, days: number) {
  return days > 0 ? count / days : 0;
}

function sumRange(counts: number[], minScore: number, maxScore: number) {
  let total = 0;
  for (let score = minScore; score <= maxScore; score += 1) {
    total += counts[score] ?? 0;
  }
  return total;
}

function inRange(value: number, range: [number, number]) {
  return value >= range[0] && value <= range[1];
}

function getArgValue(name: string) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const startOfToday = getStartOfTodayEastern();
  const startOfTodayIso = startOfToday.toISOString();
  const daysArg = getArgValue('days');
  const daysWindow = daysArg ? Number.parseInt(daysArg, 10) : null;
  const endDate =
    daysWindow && Number.isFinite(daysWindow)
      ? new Date(startOfToday.getTime() + daysWindow * 24 * 60 * 60 * 1000)
      : null;
  const endDateIso = endDate ? endDate.toISOString() : null;
  const endDateFilter = endDateIso ? sql`AND start_date <= ${endDateIso}` : sql``;
  const tiersArg = getArgValue('tiers');
  const baseFilter = sql`
    FROM events
    WHERE start_date >= ${startOfTodayIso}
      ${endDateFilter}
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

  const maxScore = 30;
  const scoreCounts = Array.from({ length: maxScore + 1 }, () => 0);
  for (const row of distribution) {
    if (row.score >= 0 && row.score <= maxScore) {
      scoreCounts[row.score] = row.count;
    }
  }

  const scoredTotal = summary.scored_events;
  const missingScore = summary.missing_score;
  const totalWithMissing = scoredTotal + missingScore;

  const candidates: Candidate[] = [];

  for (let hiddenMax = 8; hiddenMax <= 20; hiddenMax += 1) {
    for (let expandedMin = hiddenMax + 1; expandedMin <= 24; expandedMin += 1) {
      for (let goldMin = expandedMin; goldMin <= 26; goldMin += 1) {
        const hiddenCount = sumRange(scoreCounts, 0, hiddenMax);
        const expandedCount = sumRange(scoreCounts, expandedMin, maxScore);
        const goldCount = sumRange(scoreCounts, goldMin, maxScore);

        const collapsedCount = totalWithMissing - hiddenCount - expandedCount;

        const hiddenAvg = avg(hiddenCount, daysInRange);
        const collapsedAvg = avg(collapsedCount, daysInRange);
        const expandedAvg = avg(expandedCount, daysInRange);
        const goldAvg = avg(goldCount, daysInRange);

        const error =
          Math.abs(hiddenAvg - TARGETS.hiddenAvg) +
          Math.abs(collapsedAvg - TARGETS.collapsedAvg) +
          Math.abs(expandedAvg - TARGETS.expandedAvg) +
          Math.abs(goldAvg - TARGETS.goldAvg);

        candidates.push({
          hiddenMax,
          expandedMin,
          goldMin,
          hiddenAvg,
          collapsedAvg,
          expandedAvg,
          goldAvg,
          error,
        });
      }
    }
  }

  candidates.sort((a, b) => a.error - b.error);

  const matching = candidates.filter(
    (candidate) =>
      inRange(candidate.hiddenAvg, RANGES.hiddenAvg) &&
      inRange(candidate.collapsedAvg, RANGES.collapsedAvg) &&
      inRange(candidate.expandedAvg, RANGES.expandedAvg) &&
      inRange(candidate.goldAvg, RANGES.goldAvg)
  );

  console.log('='.repeat(72));
  console.log('Suggested Score Breakpoints (future events, feed filters)');
  console.log('='.repeat(72));
  console.log(`Date range:        ${summary.min_day} to ${summary.max_day}`);
  if (daysWindow && Number.isFinite(daysWindow)) {
    console.log(`Window:            next ${daysWindow} days`);
  }
  console.log(`Days in range:     ${daysInRange}`);
  console.log(`Total events:      ${summary.total_events}`);
  console.log(`Scored events:     ${summary.scored_events}`);
  console.log(`Missing score:     ${summary.missing_score}`);
  console.log('Assumption: missing scores are treated as collapsed.');
  console.log('');
  console.log('Target daily averages:');
  console.log(
    `Hidden ${TARGETS.hiddenAvg} | Collapsed ${TARGETS.collapsedAvg} | ` +
      `Expanded ${TARGETS.expandedAvg} | Gold ${TARGETS.goldAvg}`
  );
  console.log('');

  const toPrint = matching.length > 0 ? matching.slice(0, 8) : candidates.slice(0, 8);

  console.log(
    matching.length > 0
      ? 'Candidates within target ranges:'
      : 'Closest candidates (no exact range match):'
  );
  console.log('hidden<= | expanded>= | gold>= | hidden | collapsed | expanded | gold');
  for (const candidate of toPrint) {
    const line = [
      String(candidate.hiddenMax).padStart(7, ' '),
      String(candidate.expandedMin).padStart(10, ' '),
      String(candidate.goldMin).padStart(6, ' '),
      candidate.hiddenAvg.toFixed(2).padStart(7, ' '),
      candidate.collapsedAvg.toFixed(2).padStart(9, ' '),
      candidate.expandedAvg.toFixed(2).padStart(8, ' '),
      candidate.goldAvg.toFixed(2).padStart(5, ' '),
    ].join(' | ');
    console.log(line);
  }

  const evalSets = [
    { label: 'current', hiddenMax: 12, expandedMin: 17, goldMin: 21 },
    { label: 'old gold 20', hiddenMax: 12, expandedMin: 17, goldMin: 20 },
  ];

  const parsedEval = tiersArg
    ? tiersArg.split(',').map((value) => Number.parseInt(value.trim(), 10))
    : null;

  if (
    parsedEval &&
    parsedEval.length === 3 &&
    parsedEval.every((value) => Number.isFinite(value))
  ) {
    evalSets.push({
      label: `custom (${parsedEval.join(',')})`,
      hiddenMax: parsedEval[0],
      expandedMin: parsedEval[1],
      goldMin: parsedEval[2],
    });
  }

  for (const set of evalSets) {
    const hiddenCount = sumRange(scoreCounts, 0, set.hiddenMax);
    const expandedCount = sumRange(scoreCounts, set.expandedMin, maxScore);
    const goldCount = sumRange(scoreCounts, set.goldMin, maxScore);
    const collapsedCount = totalWithMissing - hiddenCount - expandedCount;
    console.log('');
    console.log(
      `Eval (${set.label}) hidden<=${set.hiddenMax}, expanded>=${set.expandedMin}, gold>=${set.goldMin}:`
    );
    console.log(
      `Hidden ${avg(hiddenCount, daysInRange).toFixed(2)} | ` +
        `Collapsed ${avg(collapsedCount, daysInRange).toFixed(2)} | ` +
        `Expanded ${avg(expandedCount, daysInRange).toFixed(2)} | ` +
        `Gold ${avg(goldCount, daysInRange).toFixed(2)}`
    );
  }
}

main().catch((error) => {
  console.error('Failed to suggest breakpoints:', error);
  process.exitCode = 1;
});
