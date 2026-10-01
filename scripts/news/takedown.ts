/**
 * Take an outlet down from /news, or let it be ingested again.
 *
 * Usage:
 *   npx tsx scripts/news/takedown.ts <domain> [--dry-run] [--force]
 *   npx tsx scripts/news/takedown.ts --enable <domain> [--dry-run]
 *
 * A takedown refuses to start while a news-scrape or news-ai run is in
 * progress (a `running` cron_job_runs row that started in the last 15
 * minutes): the scrape could still insert the domain's articles, and the AI
 * run could republish what the takedown hides. Wait for it to finish and run
 * the takedown again. --force skips the check; use it only if that row is
 * stale (the run died without recording its end). --dry-run reports the
 * running job and goes ahead, since it changes nothing.
 *
 * A takedown runs in one transaction:
 *   1. news_sources.enabled = false (a row is created if the domain has none).
 *      Ingest then skips the domain's own module and drops its items from
 *      every other module (an aggregator's copy included).
 *   2. Every article from the domain -> state 'hidden', skip_reason 'takedown'.
 *   3. Every story with a member from the domain -> state 'hidden', dirty. The
 *      next AI run recomputes each one and republishes it only if other live
 *      members remain.
 *   4. news_days rows whose summary cites any of those stories are deleted,
 *      so the next AI run regenerates those days.
 *
 * --dry-run runs the same statements and rolls them back, printing the counts.
 *
 * --enable only turns ingest back on. The articles the takedown hid stay
 * hidden. To restore them too, send them back through enrichment (anything
 * older than the AI pipeline's 14-day window comes back as skipped/too_old):
 *
 *   UPDATE news_articles
 *   SET state = 'pending', skip_reason = NULL, enriched_hash = NULL,
 *       ai_attempts = 0, ai_error = NULL, updated_at = now()
 *   WHERE outlet_domain = '<domain>' AND state = 'hidden' AND skip_reason = 'takedown';
 *
 * Their stories are still dirty (or get marked dirty when the articles are
 * re-enriched), so the next AI run republishes them.
 */

import '../../lib/config/env';
import postgres from 'postgres';
import { normalizeDomain } from '../../lib/news/db';

/** A news run still `running` this long after it started is dead (news-ai's maxDuration is 800s). */
const RUN_STALE_MINUTES = 15;

class DryRunRollback extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const enable = args.includes('--enable');
  const force = args.includes('--force');
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length !== 1) {
    console.error(
      'Usage: npx tsx scripts/news/takedown.ts [--enable] <domain> [--dry-run] [--force]'
    );
    process.exit(1);
  }
  const domain = normalizeDomain(positional[0]);
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  console.log(`${dryRun ? '[dry run] ' : ''}${enable ? 'Enabling' : 'Taking down'} ${domain}`);

  try {
    if (!enable) {
      const running = await sql<{ id: string; job_name: string; started_at: Date }[]>`
        SELECT id, job_name, started_at FROM cron_job_runs
        WHERE job_name IN ('news-scrape', 'news-ai') AND status = 'running'
          AND started_at > now() - make_interval(mins => ${RUN_STALE_MINUTES}::int)
        ORDER BY started_at`;
      if (running.length > 0) {
        const list = running
          .map((r) => `${r.job_name} (run ${r.id}, started ${r.started_at.toISOString()})`)
          .join(', ');
        if (force) {
          console.warn(`  --force: going ahead although ${list} is running.`);
        } else if (dryRun) {
          console.warn(`  ${list} is running: a real takedown would refuse now.`);
        } else {
          console.error(
            `  Refusing: ${list} is running and could undo the takedown. Wait for it to ` +
              'finish, then run the takedown again. Pass --force only if that row is stale.'
          );
          process.exitCode = 1;
          return;
        }
      }
    }

    await sql.begin(async (tx) => {
      if (enable) {
        const rows = await tx`
          UPDATE news_sources SET enabled = true, updated_at = now()
          WHERE domain = ${domain} RETURNING name`;
        if (rows.length === 0) {
          console.log(`  No news_sources row for ${domain}; nothing to enable.`);
        } else {
          console.log(`  Ingest re-enabled for ${rows[0].name}.`);
          const [{ n }] = await tx`
            SELECT count(*)::int AS n FROM news_articles
            WHERE outlet_domain = ${domain} AND state = 'hidden' AND skip_reason = 'takedown'`;
          if (n > 0) {
            console.log(
              `  ${n} article(s) hidden by the takedown stay hidden; see this script's header to restore them.`
            );
          }
        }
      } else {
        const [source] = await tx`
          INSERT INTO news_sources (domain, name, kind, enabled)
          VALUES (${domain}, ${domain}, 'outlet', false)
          ON CONFLICT (domain) DO UPDATE SET enabled = false, updated_at = now()
          RETURNING name`;
        console.log(`  Ingest disabled for ${source.name}.`);

        const articles = await tx`
          UPDATE news_articles SET state = 'hidden', skip_reason = 'takedown', updated_at = now()
          WHERE outlet_domain = ${domain} RETURNING id`;
        console.log(`  ${articles.length} article(s) hidden.`);

        const stories = await tx`
          UPDATE news_stories SET state = 'hidden', dirty = true, updated_at = now()
          WHERE id IN (
            SELECT story_id FROM news_articles
            WHERE outlet_domain = ${domain} AND story_id IS NOT NULL
          )
          RETURNING short_id, headline`;
        console.log(`  ${stories.length} story/stories hidden and marked dirty.`);
        for (const s of stories) console.log(`    ${s.short_id}  ${s.headline}`);

        const shortIds = stories.map((s) => s.short_id as string);
        const days = shortIds.length
          ? await tx`
              DELETE FROM news_days d
              WHERE EXISTS (
                SELECT 1 FROM jsonb_array_elements(d.summary) e
                WHERE e->>'storyId' = ANY(${shortIds}::text[])
              )
              RETURNING day::text`
          : [];
        console.log(
          `  ${days.length} daily summary/summaries deleted${days.length ? `: ${days.map((d) => d.day).join(', ')}` : ''}.`
        );
      }

      if (dryRun) throw new DryRunRollback();
    });
    console.log('Committed.');
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    console.log('Rolled back (dry run). Nothing changed.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
