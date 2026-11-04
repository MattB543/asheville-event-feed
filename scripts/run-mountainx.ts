/**
 * Scrape Mountain Xpress by hand, with someone at the screen. Cloudflare
 * challenges every request to mountainx.com, and only a person clicking its
 * "Verify you are human" checkbox gets the browser through, so no scheduled
 * job runs this source (it is `attended` in the scrape route's registry).
 *
 * A Chrome window opens once the two HTTP paths have been refused, and loads
 * one calendar month at a time (2-3 months), each in a fresh session, so expect
 * to click once per month. Each month waits up to 2 minutes for the click and
 * retries twice. Don't close the window; the script closes it.
 *
 * Same as the nightly job otherwise: calls the scrape route handler directly
 * (/api/cron/scrape?source=Mountain Xpress, no dev server), so the upsert and
 * rule-based dedup run and the run is recorded in cron_job_runs. AI enrichment
 * of the new events is left to the Vercel cron.
 *
 * Usage: npm run scrape:mountainx
 */

import { env } from '../lib/config/env';
import { GET as scrapeCron } from '../app/api/cron/scrape/route';

type ScrapeStats = {
  inserted?: number;
  updated?: number;
  duplicatesRemoved?: number;
  scrapers?: { name: string; ok: boolean; events: number; error?: string }[];
};

async function main() {
  // As in run-local-events.ts: under `next dev` a stray rejection inside a scraper
  // is logged and the scrape carries on; plain Node would kill the run.
  process.on('unhandledRejection', (reason) => {
    console.error('[run-mountainx] Unhandled rejection (continuing):', reason);
  });

  if (!env.CRON_SECRET) throw new Error('CRON_SECRET not set in .env');
  console.log(
    '[run-mountainx] A Chrome window will open. Click "Verify you are human" each time it ' +
      'shows the Cloudflare check (about once per month page).'
  );

  const started = Date.now();
  const response = await scrapeCron(
    new Request('http://localhost/api/cron/scrape?source=Mountain%20Xpress', {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    })
  );
  const body = (await response.json()) as {
    success?: boolean;
    error?: string;
    stats?: ScrapeStats;
  };
  if (!response.ok || !body.success || !body.stats) {
    throw new Error(`Scrape failed (HTTP ${response.status}): ${body.error ?? 'no error message'}`);
  }

  const { stats } = body;
  const mx = stats.scrapers?.find((s) => s.name === 'Mountain Xpress');
  const minutes = Math.round((Date.now() - started) / 6000) / 10;
  if (!mx?.ok) {
    console.error(`\n[run-mountainx] Mountain Xpress FAILED after ${minutes} min: ${mx?.error}`);
    if (mx?.error?.includes("Blocked by the site's Cloudflare rules")) {
      console.error(
        '[run-mountainx] That is a block page, not the checkbox: clicking cannot get past it. ' +
          'Try again in a few hours.'
      );
    }
    process.exit(1);
  }

  console.log(
    `\n[run-mountainx] Done in ${minutes} min: ${mx.events} events scraped, ` +
      `${stats.inserted} new, ${stats.updated} updated, ${stats.duplicatesRemoved} dupes removed`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[run-mountainx] FAILED:', err);
  process.exit(1);
});
