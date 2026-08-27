/**
 * Cron health digest — the "is everything still running clean?" check.
 *
 * Reads cron_job_runs (the durable record) rather than Vercel runtime logs, which
 * only survive ~1h. Run it every few days:
 *
 *   npm run cron:health          # last 3 days
 *   npm run cron:health -- 7     # last 7 days
 *
 * Exits 1 if anything looks wrong, so it can be wired into a check later.
 */
import '../lib/config/env';
import postgres from 'postgres';

const DAYS = Number(process.argv[2]) || 3;
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

type ScraperStat = { name: string; ok: boolean; events: number; ms: number; error?: string };

const problems: string[] = [];
const hr = (c = '-') => console.log(c.repeat(74));
const fmtAge = (h: number) => (h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);

async function jobSummary() {
  console.log(`\nJOB RUNS — last ${DAYS} days`);
  hr();
  console.log(
    'job'.padEnd(15) +
      'runs'.padEnd(7) +
      'failed'.padEnd(8) +
      'last run (UTC)'.padEnd(22) +
      'cadence'
  );
  hr();

  const rows = await sql<
    {
      job_name: string;
      runs: number;
      failed: number;
      last_run: string;
      age_hours: number;
      median_gap: number | null;
      max_gap: number | null;
    }[]
  >`
    with gaps as (
      select job_name, started_at,
             (extract(epoch from (started_at - lag(started_at)
               over (partition by job_name order by started_at))) / 3600)::float8 as gap_hours,
             status
      from cron_job_runs
      where started_at > now() - make_interval(days => ${DAYS})
    )
    select job_name,
           count(*)::int as runs,
           count(*) filter (where status <> 'success')::int as failed,
           to_char(max(started_at) at time zone 'UTC', 'MM-DD HH24:MI') as last_run,
           (extract(epoch from (now() - max(started_at))) / 3600)::float8 as age_hours,
           (percentile_cont(0.5) within group (order by gap_hours))::float8 as median_gap,
           max(gap_hours)::float8 as max_gap
    from gaps group by job_name order by job_name`;

  if (rows.length === 0) {
    problems.push(`No cron runs recorded at all in the last ${DAYS} days.`);
    console.log('(no runs recorded)');
    return;
  }

  for (const r of rows) {
    const median = r.median_gap ?? 0;
    const max = r.max_gap ?? 0;
    // A skipped run shows up as a gap well over the normal cadence.
    const missed = median > 0 && max > median * 1.75;
    const gapNote = median > 0 ? `${median.toFixed(1)}h typical` : 'n/a';
    console.log(
      r.job_name.padEnd(15) +
        String(r.runs).padEnd(7) +
        String(r.failed).padEnd(8) +
        `${r.last_run} (${fmtAge(r.age_hours)})`.padEnd(22) +
        gapNote +
        (missed ? `  <- MISSED RUN? max gap ${max.toFixed(1)}h` : '')
    );
    if (r.failed > 0) problems.push(`${r.job_name}: ${r.failed} failed run(s).`);
    if (missed)
      problems.push(`${r.job_name}: gap of ${max.toFixed(1)}h vs ${median.toFixed(1)}h typical.`);
  }
}

async function scrapeDetail() {
  console.log(`\nSCRAPE RUNS — newest first`);
  hr();
  console.log(
    'when (UTC)'.padEnd(14) +
      'scrapers'.padEnd(16) +
      'new'.padEnd(7) +
      'updated'.padEnd(9) +
      'dupes'.padEnd(7) +
      'dur'
  );
  hr();

  const runs = await sql<{ t: string; result: Record<string, unknown>; secs: number }[]>`
    select to_char(started_at at time zone 'UTC','MM-DD HH24:MI') as t,
           result, (duration_ms / 1000.0)::float8 as secs
    from cron_job_runs
    where job_name = 'scrape' and started_at > now() - make_interval(days => ${DAYS})
    order by started_at desc`;

  const failureTally = new Map<string, { n: number; error: string }>();
  const zeroEvent = new Map<string, number>();
  let sawNewFields = false;

  for (const run of runs) {
    const r = run.result ?? {};
    const scrapers = (r.scrapers as ScraperStat[] | undefined) ?? [];
    const inserted = r.inserted as number | undefined;
    const updated = r.updated as number | undefined;
    if (inserted !== undefined) sawNewFields = true;

    const okCount = scrapers.filter((s) => s.ok).length;
    const scraperCell = scrapers.length ? `${okCount}/${scrapers.length} ok` : '(not recorded)';

    console.log(
      run.t.padEnd(14) +
        scraperCell.padEnd(16) +
        String(inserted ?? '?').padEnd(7) +
        String(updated ?? '?').padEnd(9) +
        String((r.duplicatesRemoved as number) ?? '?').padEnd(7) +
        `${run.secs.toFixed(0)}s`
    );

    for (const s of scrapers) {
      if (!s.ok) {
        const prev = failureTally.get(s.name);
        failureTally.set(s.name, { n: (prev?.n ?? 0) + 1, error: s.error ?? 'unknown' });
      } else if (s.events === 0) {
        zeroEvent.set(s.name, (zeroEvent.get(s.name) ?? 0) + 1);
      }
    }
  }

  if (runs.length && !sawNewFields) {
    console.log('\n  Note: these runs predate per-scraper tracking. Deploy and wait one run.');
  }

  const latest = runs[0]?.result as Record<string, unknown> | undefined;
  const skipped = (latest?.skippedSources as string[] | undefined) ?? [];
  if (skipped.length) {
    console.log(`\n  Skipped by design (local-only): ${skipped.join(', ')}`);
  }

  const insertedBySource = (latest?.insertedBySource as Record<string, number> | undefined) ?? {};
  const topSources = Object.entries(insertedBySource).sort((a, b) => b[1] - a[1]);
  if (topSources.length) {
    console.log(
      `  New events on last run by source: ${topSources.map(([s, n]) => `${s}=${n}`).join(', ')}`
    );
  }

  if (failureTally.size) {
    console.log(`\nSCRAPER FAILURES — last ${DAYS} days`);
    hr();
    for (const [name, { n, error }] of [...failureTally].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`${name.padEnd(24)} x${String(n).padEnd(4)} ${error.slice(0, 44)}`);
      problems.push(`Scraper "${name}" failed ${n}x: ${error.slice(0, 60)}`);
    }
  }

  // A scraper that never throws but always returns nothing is the quiet failure mode.
  const alwaysEmpty = [...zeroEvent].filter(([, n]) => n === runs.length && runs.length > 1);
  if (alwaysEmpty.length) {
    console.log(`\nSILENT SCRAPERS — returned 0 events on all ${runs.length} runs`);
    hr();
    for (const [name] of alwaysEmpty) {
      console.log(`${name.padEnd(24)} 0 events every run (no error raised)`);
      problems.push(`Scraper "${name}" returned 0 events on every run.`);
    }
  }
}

// Sources with no scraper behind them: they only change when a human submits an
// event or uploads a poster, so "stale" is normal here and not a problem.
const UNSCRAPED_SOURCES = ['MANUAL', 'POSTER'];

async function staleSources() {
  console.log('\nSTALE SOURCES — no event refreshed in over 24h');
  hr();
  // last_seen_at is `timestamp without time zone` holding UTC, so compare against
  // UTC-naive now() rather than letting the client reinterpret it as local time.
  const rows = await sql<{ source: string; total: number; age_hours: number }[]>`
    select source, count(*)::int as total,
           (extract(epoch from ((now() at time zone 'UTC') - max(last_seen_at))) / 3600)::float8 as age_hours
    from events
    where source <> all(${UNSCRAPED_SOURCES})
    group by source
    having extract(epoch from ((now() at time zone 'UTC') - max(last_seen_at))) / 3600 > 24
    order by 3 desc`;

  if (rows.length === 0) {
    console.log('(none — every source refreshed within 24h)');
    return;
  }
  for (const r of rows) {
    console.log(`${r.source.padEnd(24)} ${fmtAge(r.age_hours).padEnd(8)} ${r.total} events`);
    problems.push(`Source ${r.source} has not refreshed in ${fmtAge(r.age_hours)}.`);
  }
}

async function enrichment() {
  console.log('\nAI ENRICHMENT — events inside the 3-month enrichment window');
  hr();
  const [row] = await sql<{ total: number; missing: number; retry_capped: number }[]>`
    select count(*)::int as total,
           count(*) filter (where score is null or embedding is null or ai_summary is null)::int as missing,
           count(*) filter (where (score is null or embedding is null or ai_summary is null)
                              and ai_attempts >= 3)::int as retry_capped
    from events
    where start_date >= now() and start_date <= now() + interval '3 months'`;

  const pct = row.total ? ((1 - row.missing / row.total) * 100).toFixed(1) : '100.0';
  console.log(`In window:      ${row.total}`);
  console.log(`Enriched:       ${pct}%`);
  console.log(`Missing:        ${row.missing}  (of which ${row.retry_capped} are retry-capped)`);
  if (row.retry_capped > 10) {
    problems.push(`${row.retry_capped} events are retry-capped and will never be enriched.`);
  }
  if (row.missing - row.retry_capped > 200) {
    problems.push(
      `${row.missing - row.retry_capped} events awaiting enrichment — AI cron may be behind.`
    );
  }
}

async function main() {
  console.log('='.repeat(74));
  console.log(`CRON HEALTH  —  generated ${new Date().toISOString()}`);
  console.log('='.repeat(74));

  await jobSummary();
  await scrapeDetail();
  await staleSources();
  await enrichment();

  console.log('\n' + '='.repeat(74));
  if (problems.length === 0) {
    console.log('VERDICT: clean — no issues detected.');
  } else {
    console.log(`VERDICT: ${problems.length} thing(s) to look at:`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  console.log('='.repeat(74) + '\n');

  await sql.end();
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
