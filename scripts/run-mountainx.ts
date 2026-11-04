/**
 * Scrape Mountain Xpress by hand, with someone at the screen. Cloudflare
 * challenges every request to mountainx.com, and only a person clicking its
 * "Verify you are human" checkbox gets the browser through, so no scheduled
 * job runs this source (it is `attended` in the scrape route's registry).
 *
 * Since 2026-11-03 the site blocks Matt's home IP outright ("Sorry, you have
 * been blocked"), so the run goes out through Windscribe: it connects to one
 * location (Atlanta unless --vpn says otherwise), runs, and puts Windscribe back
 * the way it was, Ctrl+C included. A block on that IP too ends the run; it never
 * moves on to another server. --no-vpn runs from the home IP.
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
 * Usage: npm run scrape:mountainx [-- --vpn <place> | --no-vpn]
 */

import { spawnSync } from 'child_process';
import { env } from '../lib/config/env';
import { GET as scrapeCron } from '../app/api/cron/scrape/route';

const WINDSCRIBE_CLI = 'C:\\Program Files\\Windscribe\\windscribe-cli.exe';
const DEFAULT_VPN_PLACE = 'Atlanta';

type ScrapeStats = {
  inserted?: number;
  updated?: number;
  duplicatesRemoved?: number;
  scrapers?: { name: string; ok: boolean; events: number; error?: string }[];
};

interface WindscribeState {
  connectedTo: string | null; // the server nickname, e.g. "Peachtree"
  firewallOn: boolean;
}

function windscribe(...args: string[]): string {
  const run = spawnSync(WINDSCRIBE_CLI, args, { encoding: 'utf8', timeout: 120_000 });
  if (run.error) throw new Error(`windscribe-cli ${args.join(' ')}: ${run.error.message}`);
  return `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
}

function readWindscribe(): WindscribeState {
  const status = windscribe('status');
  // "Connect state: Connected: Atlanta - Peachtree"
  const connected = status.match(/Connect state:\s*Connected:\s*(.+)/i);
  return {
    connectedTo: connected ? connected[1].split(' - ').pop()!.trim() : null,
    firewallOn: /Firewall state:\s*On/i.test(status),
  };
}

// curl, not Node's fetch: on one Windscribe server (Atlanta "Magic City") curl got
// through while Node's fetch failed for a minute straight.
function publicIp(): string | null {
  const run = spawnSync('curl', ['-s', '--max-time', '10', 'https://ipinfo.io/json'], {
    encoding: 'utf8',
  });
  try {
    const info = JSON.parse(run.stdout) as { ip: string; org?: string; city?: string };
    return `${info.ip} ${info.org ?? '?'} (${info.city ?? '?'})`;
  } catch {
    return null;
  }
}

async function connectVpn(place: string): Promise<void> {
  console.log(`[run-mountainx] Connecting Windscribe to ${place}: ${windscribe('connect', place)}`);
  // "Connected" comes back a few seconds before traffic flows through the tunnel.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const ip = publicIp();
    if (ip) {
      console.log(`[run-mountainx] Going out as ${ip}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`No internet after connecting Windscribe to ${place}`);
}

function restoreVpn(original: WindscribeState): void {
  console.log('[run-mountainx] Putting Windscribe back...');
  if (original.connectedTo) {
    console.log(`  ${windscribe('connect', original.connectedTo)}`);
  } else {
    console.log(`  ${windscribe('disconnect')}`);
  }
  const firewallOn = readWindscribe().firewallOn;
  if (firewallOn !== original.firewallOn) {
    console.log(`  ${windscribe('firewall', original.firewallOn ? 'on' : 'off')}`);
  }
}

async function scrape(): Promise<number> {
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
    return 1;
  }

  console.log(
    `\n[run-mountainx] Done in ${minutes} min: ${mx.events} events scraped, ` +
      `${stats.inserted} new, ${stats.updated} updated, ${stats.duplicatesRemoved} dupes removed`
  );
  return 0;
}

async function main() {
  // As in run-local-events.ts: under `next dev` a stray rejection inside a scraper
  // is logged and the scrape carries on; plain Node would kill the run.
  process.on('unhandledRejection', (reason) => {
    console.error('[run-mountainx] Unhandled rejection (continuing):', reason);
  });

  if (!env.CRON_SECRET) throw new Error('CRON_SECRET not set in .env');

  const vpnIndex = process.argv.indexOf('--vpn');
  const place = process.argv.includes('--no-vpn')
    ? null
    : vpnIndex > 0 && process.argv[vpnIndex + 1]
      ? process.argv[vpnIndex + 1]
      : DEFAULT_VPN_PLACE;
  if (!place) return scrape();

  const original = readWindscribe();
  let restored = false;
  const restoreOnce = () => {
    if (!restored) {
      restored = true;
      restoreVpn(original);
    }
  };
  process.on('SIGINT', () => {
    restoreOnce();
    process.exit(130);
  });

  try {
    await connectVpn(place);
    return await scrape();
  } finally {
    restoreOnce();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[run-mountainx] FAILED:', err);
    process.exit(1);
  });
