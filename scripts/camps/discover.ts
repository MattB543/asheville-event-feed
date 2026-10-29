/**
 * Camp discovery: every organization running kids' summer programs within the D3 radius
 * (docs/camps/01-context-and-plan.md §6.1; the logic is lib/camps/discovery.ts), written to
 * data/camps/providers.json for extraction.
 *
 * Each step is resumable: a run saved under data/camps/discovery/<method>/<id>.json is reused
 * unless --force, so the raw candidates of every call stay auditable.
 *
 *   npx tsx scripts/camps/discover.ts seeds           # pilot, exa sheet, 3 guides, our events (no web search)
 *   npx tsx scripts/camps/discover.ts grid            # category x town searches (Sol + web_search)
 *   npx tsx scripts/camps/discover.ts aggregator      # aggregator sweeps
 *   npx tsx scripts/camps/discover.ts gap --round 1   # gap-filling rounds (1, 2, then 3: VBS by town)
 *   npx tsx scripts/camps/discover.ts resolve         # official pages for name-only or failing providers
 *   npx tsx scripts/camps/discover.ts build           # merge, check each first page, write providers.json
 *
 * Run resolve after the search steps and again after a build (it also looks up providers whose
 * pages failed that build's check). Hand decisions live in data/camps/discovery/overrides.json.
 *
 * Options: --only id,id   --limit N   --concurrency N (default 5)   --dry-run   --force
 *
 * Our events table is PRODUCTION: it is read with one SELECT inside a READ ONLY transaction.
 */
import '../../lib/config/env';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import type { Provider } from '../../lib/camps/contract';
import {
  DISCOVERY_METHODS,
  aggregatorQueries,
  askForProviders,
  checkProviderPage,
  gapQueries,
  gridQueries,
  isSocialPage,
  guideBriefs,
  mergeCandidates,
  nameKey,
  ourDbBrief,
  pilotProviders,
  resolveBatch,
  sheetBrief,
  townKey,
  type DiscoveryMethod,
  type DiscoveryOverrides,
  type DiscoveryQuery,
  type DiscoveryRun,
  type EventListing,
  type GuidePage,
  type MergedProvider,
  type PageCheck,
  type ResolveItem,
} from '../../lib/camps/discovery';
import { createPageTextFetcher, type PageTextFetcher } from '../../lib/camps/fetchPageText';
import { fetchSeedSheet } from '../../lib/camps/seedSheet';
import { getTodayStringEastern } from '../../lib/utils/timezone';

const CAMPS_DIR = join(process.cwd(), 'data', 'camps');
const DISCOVERY_DIR = join(CAMPS_DIR, 'discovery');
const PROVIDERS_FILE = join(CAMPS_DIR, 'providers.json');
const PILOT_FILE = join(CAMPS_DIR, 'pilot', 'providers.json');
const PAGE_CHECKS_FILE = join(DISCOVERY_DIR, 'page-checks.json');
const MERGED_FILE = join(DISCOVERY_DIR, 'merged.json');
const OVERRIDES_FILE = join(DISCOVERY_DIR, 'overrides.json');
const RESOLVE_BATCH = 8;
const PAGE_CHECK_CONCURRENCY = 6;
const PAGE_CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = Number(arg('--concurrency') ?? 5);
const LIMIT = arg('--limit') ? Number(arg('--limit')) : Infinity;
const ONLY = arg('--only')?.split(',');

// ---------------------------------------------------------------------------
// Saved runs
// ---------------------------------------------------------------------------

function runPath(method: DiscoveryMethod, id: string): string {
  return join(DISCOVERY_DIR, method, `${id}.json`);
}

async function saveRun(run: DiscoveryRun): Promise<void> {
  await mkdir(join(DISCOVERY_DIR, run.method), { recursive: true });
  await writeFile(runPath(run.method, run.id), JSON.stringify(run, null, 2) + '\n');
}

async function loadRuns(): Promise<DiscoveryRun[]> {
  const runs: DiscoveryRun[] = [];
  for (const method of DISCOVERY_METHODS) {
    const dir = join(DISCOVERY_DIR, method);
    if (!existsSync(dir)) continue;
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.json')).sort()) {
      runs.push(JSON.parse(await readFile(join(dir, file), 'utf8')) as DiscoveryRun);
    }
  }
  return runs;
}

async function runPool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    })
  );
}

function describeRun(run: DiscoveryRun): string {
  const tokens = run.usage ? `${Math.round(run.usage.inputTokens / 1000)}k in` : 'no model';
  return `${run.method}/${run.id}: ${run.candidates.length} candidates, ${run.searches.length} searches, ${tokens}, ${Math.round(run.ms / 1000)}s`;
}

/** Sol calls for queries that have no saved run yet. */
async function runQueries(queries: DiscoveryQuery[], webSearch: boolean): Promise<void> {
  const selected = queries.filter((query) => !ONLY || ONLY.includes(query.id));
  const pending = selected
    .filter((query) => FORCE || !existsSync(runPath(query.method, query.id)))
    .slice(0, LIMIT);
  console.log(`${selected.length} queries, ${pending.length} to run`);
  if (DRY_RUN) {
    for (const query of pending) console.log(`- ${query.method}/${query.id}: ${query.input}`);
    return;
  }
  const today = getTodayStringEastern();
  let done = 0;
  await runPool(pending, CONCURRENCY, async (query) => {
    try {
      const run = await askForProviders(query, today, { webSearch });
      await saveRun(run);
      console.log(`[${++done}/${pending.length}] ${describeRun(run)}`);
    } catch (error) {
      console.error(
        `[${++done}/${pending.length}] FAILED ${query.method}/${query.id}: ${String(error)}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// seeds: pilot, exa sheet, guides, our events table
// ---------------------------------------------------------------------------

const GUIDES: Array<{
  method: DiscoveryMethod;
  name: string;
  start: string;
  follow: RegExp;
  maxPages: number;
}> = [
  {
    method: 'macaroni_kid',
    name: "Macaroni Kid Asheville's summer camp guide and kids' activity directory",
    start:
      'https://asheville.macaronikid.com/directory/category/623a084d4aa4f27ce8606e46/summer-camp-guide',
    // The camp guide, its four subcategories, the three extracurricular categories, and listings.
    follow:
      /^https:\/\/asheville\.macaronikid\.com\/directory\/(?:category\/[0-9a-f]{24}\/(?:summer-camp-guide|adventure-and-outdoor-camps|steam-and-educational-camps|sports-camps|visual-and-performing-arts-camps|camps-and-school-break-programs|creative-visual-and-performing-arts|sports-and-fitness)|[0-9a-f]{24}\/[\w-]+)$/,
    maxPages: 60,
  },
  {
    method: 'beyond_school',
    name: "Asheville City Schools' Beyond School directory of afterschool and summer programs",
    start: 'https://beyondschool.ashevillecityschools.net/',
    follow: /^https:\/\/beyondschool\.ashevillecityschools\.net\/programs\/[\w-]+\/?$/,
    maxPages: 80,
  },
  {
    method: 'news828',
    name: "828newsNOW's 2026 WNC Summer Camp Guide",
    start: 'https://828newsnow.com/summer-camp-guide-asheville-western-north-carolina-2026/',
    follow: /^https:\/\/828newsnow\.com\/summer-camp-guide-[\w-]+\/?$/,
    maxPages: 12,
  },
];

async function crawlGuide(guide: (typeof GUIDES)[number], fetcher: PageTextFetcher) {
  const pages: GuidePage[] = [];
  const queue = [guide.start];
  const seen = new Set(queue);
  while (queue.length > 0 && pages.length < guide.maxPages) {
    const url = queue.shift() as string;
    try {
      const page = await fetcher.get(url);
      pages.push({ url, text: page.text, links: page.links });
      for (const link of page.links) {
        const href = link.href.split('#')[0];
        if (guide.follow.test(href) && !seen.has(href)) {
          seen.add(href);
          queue.push(href);
        }
      }
    } catch (error) {
      console.error(`  ${guide.method}: could not read ${url}: ${String(error)}`);
    }
  }
  return pages;
}

async function seeds(): Promise<void> {
  const fetcher = createPageTextFetcher();
  const today = getTodayStringEastern();
  try {
    if (FORCE || !existsSync(runPath('pilot', 'pilot'))) {
      const file = JSON.parse(await readFile(PILOT_FILE, 'utf8')) as Parameters<
        typeof pilotProviders
      >[0];
      const pilot = pilotProviders(file);
      await saveRun({ ...seedRun('pilot', 'pilot', 'data/camps/pilot/providers.json'), pilot });
      console.log(`pilot: ${pilot.length} providers`);
    }

    if (FORCE || !existsSync(runPath('seed_sheet', 'exa-sheet-1'))) {
      const rows = await fetchSeedSheet();
      console.log(`seed_sheet: ${rows.length} rows`);
      // Thirds, so a long answer never runs into the output limit.
      const third = Math.ceil(rows.length / 3);
      const queries = [0, 1, 2].map((part) => ({
        method: 'seed_sheet' as const,
        id: `exa-sheet-${part + 1}`,
        input: sheetBrief(rows.slice(part * third, (part + 1) * third)),
      }));
      if (!DRY_RUN) {
        await runPool(queries, CONCURRENCY, async (query) => {
          const run = await askForProviders(query, today, { webSearch: false });
          await saveRun(run);
          console.log(`  ${describeRun(run)}`);
        });
      }
    }

    for (const guide of GUIDES) {
      if (!FORCE && existsSync(runPath(guide.method, 'part-1'))) continue;
      const pages = await crawlGuide(guide, fetcher);
      const briefs = guideBriefs(guide.name, pages);
      console.log(`${guide.method}: ${pages.length} pages, ${briefs.length} briefs`);
      if (DRY_RUN) continue;
      await runPool(
        briefs.map((input, index) => ({ method: guide.method, id: `part-${index + 1}`, input })),
        CONCURRENCY,
        async (query) => {
          const run = await askForProviders(query, today, { webSearch: false });
          await saveRun(run);
          console.log(`  ${describeRun(run)}`);
        }
      );
    }

    if (FORCE || !existsSync(runPath('our_db', 'events'))) {
      const listings = await readEventListings();
      console.log(`our_db: ${listings.length} camp-like listing groups`);
      if (!DRY_RUN) {
        const run = await askForProviders(
          { method: 'our_db', id: 'events', input: ourDbBrief(listings) },
          today,
          { webSearch: false }
        );
        await saveRun(run);
        console.log(`  ${describeRun(run)}`);
      }
    }
  } finally {
    await fetcher.close();
  }
}

function seedRun(method: DiscoveryMethod, id: string, input: string): DiscoveryRun {
  return {
    method,
    id,
    input,
    at: new Date().toISOString(),
    webSearch: false,
    calls: 0,
    usage: null,
    searches: [],
    ms: 0,
    candidates: [],
  };
}

/** Camp-like titles in our feed, summers 2025-2027, grouped by organizer and title. */
async function readEventListings(): Promise<EventListing[]> {
  const sql = postgres(process.env.DATABASE_URL as string, { prepare: false, max: 1 });
  try {
    const rows = await sql.begin(
      'read only',
      (tx) => tx<
        Array<{
          source: string;
          organizer: string | null;
          title: string;
          location: string | null;
          url: string;
        }>
      >`
      SELECT source, organizer, title, location, url
      FROM events
      WHERE start_date >= '2025-05-01' AND start_date < '2027-09-01'
        AND EXTRACT(MONTH FROM start_date AT TIME ZONE 'America/New_York') BETWEEN 5 AND 8
        AND title ~* ${'(^|[^a-z])(camps?|vbs|vacation bible|clinics?|summer program)([^a-z]|$)'}
      ORDER BY organizer, title`
    );
    const groups = new Map<string, EventListing>();
    for (const row of rows) {
      const key = `${(row.organizer ?? '').toLowerCase()}|${row.title
        .toLowerCase()
        .replace(/[\d/-]+/g, '')
        .slice(0, 30)}`;
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { ...row, count: 1 });
    }
    return [...groups.values()];
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// resolve: official pages for providers we know only by name (or only on Facebook)
// ---------------------------------------------------------------------------

async function resolve(): Promise<void> {
  const runs = await loadRuns();
  const asked = new Set(
    runs
      .flatMap((run) => run.asked ?? [])
      .map((item) => `${nameKey(item.name)}|${townKey(item.town)}`)
  );
  const { providers } = mergeCandidates(runs, await loadPrior(), await loadOverrides());
  // The last build's page checks: a provider whose pages all failed gets looked up too.
  const lastChecks = new Map<string, PageCheck | undefined>();
  if (existsSync(MERGED_FILE)) {
    const last = JSON.parse(await readFile(MERGED_FILE, 'utf8')) as {
      providers: Array<MergedProvider & { check?: PageCheck }>;
    };
    for (const merged of last.providers) lastChecks.set(merged.provider.key, merged.check);
  }
  const pending: ResolveItem[] = [];
  for (const merged of providers) {
    const { provider } = merged;
    const failed = lastChecks.get(provider.key);
    const hasPage = provider.urls.some((url) => !isSocialPage(url));
    // A pilot keeps its own pages; only one with none (Kanuga) is looked up.
    if (provider.discovered_by.includes('pilot') && provider.urls.length > 0) continue;
    if (hasPage && (!failed || failed.ok)) continue;
    const town = merged.towns[0] ?? null;
    const item: ResolveItem = {
      name: provider.name,
      town: town?.replace(/, [A-Z]{2}$/, '') ?? null,
      state: town?.match(/, ([A-Z]{2})$/)?.[1] ?? null,
      note: hasPage
        ? `the page we have (${failed?.url}) failed: ${failed?.reason?.slice(0, 80)}`
        : provider.urls[0]
          ? `has a Facebook page: ${provider.urls[0]}`
          : null,
    };
    if (!asked.has(`${nameKey(item.name)}|${townKey(item.town)}`)) pending.push(item);
  }
  const batches: ResolveItem[][] = [];
  for (let i = 0; i < pending.length; i += RESOLVE_BATCH) {
    batches.push(pending.slice(i, i + RESOLVE_BATCH));
  }
  const selected = batches.slice(0, LIMIT);
  console.log(`${pending.length} providers without an official page, ${selected.length} batches`);
  if (DRY_RUN) {
    for (const batch of selected) console.log(`- ${batch.map((item) => item.name).join(' | ')}`);
    return;
  }
  const today = getTodayStringEastern();
  let done = 0;
  await runPool(selected, CONCURRENCY, async (batch) => {
    const id = `batch-${createHash('sha1')
      .update(batch.map((item) => item.name).join('\n'))
      .digest('hex')
      .slice(0, 10)}`;
    try {
      const run = await resolveBatch(id, batch, today);
      await saveRun(run);
      const found = run.candidates.filter((candidate) => candidate.url).length;
      console.log(`[${++done}/${selected.length}] ${describeRun(run)}, ${found} pages found`);
    } catch (error) {
      console.error(`[${++done}/${selected.length}] FAILED ${id}: ${String(error)}`);
    }
  });
}

// ---------------------------------------------------------------------------
// build: merge, page checks, providers.json + audit files
// ---------------------------------------------------------------------------

async function loadPrior(): Promise<Provider[]> {
  if (!existsSync(PROVIDERS_FILE)) return [];
  return (JSON.parse(await readFile(PROVIDERS_FILE, 'utf8')) as { providers: Provider[] })
    .providers;
}

async function loadOverrides(): Promise<DiscoveryOverrides> {
  if (!existsSync(OVERRIDES_FILE)) return {};
  return JSON.parse(await readFile(OVERRIDES_FILE, 'utf8')) as DiscoveryOverrides;
}

async function build(): Promise<void> {
  const runs = await loadRuns();
  const merge = mergeCandidates(runs, await loadPrior(), await loadOverrides());
  console.log(
    `${runs.length} runs -> ${merge.providers.length} providers (${merge.outOfArea.length} candidates out of area)`
  );

  const cache = existsSync(PAGE_CHECKS_FILE)
    ? (JSON.parse(await readFile(PAGE_CHECKS_FILE, 'utf8')) as Record<string, PageCheck>)
    : {};
  const fetcher = createPageTextFetcher();
  const checks = new Map<string, PageCheck>();
  const check = async (name: string, url: string | undefined): Promise<PageCheck> => {
    const cacheKey = `${url ?? ''}|${name}`;
    const cached = cache[cacheKey];
    // Social pages are judged without a fetch, so never from the cache.
    const fresh =
      cached?.ok &&
      !(url && isSocialPage(url)) &&
      Date.now() - Date.parse(cached.checkedAt) < PAGE_CHECK_TTL_MS &&
      !FORCE;
    const result = fresh ? cached : await checkProviderPage(name, url, fetcher);
    cache[cacheKey] = result;
    return result;
  };
  let done = 0;
  try {
    await runPool(merge.providers, PAGE_CHECK_CONCURRENCY, async ({ provider }) => {
      // The first page is what extraction reads first. When it fails, a later page of ours that
      // passes moves to the front; a pilot's pages keep their order.
      const pilot = provider.discovered_by.includes('pilot');
      const tries =
        pilot || provider.urls.length === 0 ? [provider.urls[0]] : provider.urls.slice(0, 3);
      let first: PageCheck | undefined;
      for (const url of tries) {
        const result = await check(provider.name, url);
        first ??= result;
        if (result.ok) {
          if (url && url !== provider.urls[0]) {
            provider.urls = [url, ...provider.urls.filter((other) => other !== url)];
          }
          checks.set(provider.key, result);
          break;
        }
      }
      if (!checks.has(provider.key) && first) checks.set(provider.key, first);
      if (++done % 50 === 0) console.log(`  checked ${done}/${merge.providers.length}`);
    });
  } finally {
    await fetcher.close();
  }
  await writeFile(PAGE_CHECKS_FILE, JSON.stringify(cache, null, 2) + '\n');

  const providers: Provider[] = merge.providers.map(({ provider, rejected }) => {
    const check = checks.get(provider.key);
    const reason = !check?.ok
      ? (check?.reason ?? 'not checked')
      : rejected.length > 0
        ? `a search found no kids' summer program: ${rejected[0]}`
        : null;
    return reason
      ? { ...provider, status: 'review', status_reason: reason }
      : { ...provider, status: 'ok' };
  });

  await writeFile(
    PROVIDERS_FILE,
    JSON.stringify(
      {
        about:
          'Camp providers from discovery (scripts/camps/discover.ts, lib/camps/discovery.ts): one organization per row, its official camp pages in `urls`. status "review" means its first page did not load, did not mention a kids\' program, or did not name the provider; it is kept, since a failed fetch can be a block. Raw candidates per discovery call are in data/camps/discovery/.',
        generated_at: new Date().toISOString(),
        providers,
      },
      null,
      2
    ) + '\n'
  );

  const summary = summarize(runs, merge.providers, providers);
  await writeFile(
    MERGED_FILE,
    JSON.stringify(
      {
        providers: merge.providers.map((merged) => ({
          ...merged,
          check: checks.get(merged.provider.key),
        })),
        out_of_area: merge.outOfArea,
        excluded: merge.excluded,
        possible_duplicates: merge.possibleDuplicates,
      },
      null,
      2
    ) + '\n'
  );
  await writeFile(join(DISCOVERY_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

function count<T>(items: T[], keyOf: (item: T) => string | string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const keys = keyOf(item);
    for (const key of Array.isArray(keys) ? keys : [keys]) counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarize(runs: DiscoveryRun[], merged: MergedProvider[], providers: Provider[]) {
  const status = new Map(providers.map((provider) => [provider.key, provider.status]));
  const ok = merged.filter((m) => status.get(m.provider.key) === 'ok');

  // A gap round's "new" providers (the stop rule): verified, and found by nothing but that round.
  const newInRound = (round: number) =>
    ok.filter((m) => {
      const found = m.runs.filter((run) => !run.startsWith('resolve/'));
      return found.length > 0 && found.every((run) => run.startsWith(`gap_fill/r${round}-`));
    }).length;

  const spend: Record<string, Record<string, number>> = {};
  for (const run of runs) {
    const row = (spend[run.method] ??= {
      runs: 0,
      calls: 0,
      webSearchCalls: 0,
      searches: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    row.runs++;
    row.calls += run.calls;
    if (run.webSearch) row.webSearchCalls += run.calls;
    row.searches += run.searches.length;
    row.inputTokens += run.usage?.inputTokens ?? 0;
    row.outputTokens += run.usage?.outputTokens ?? 0;
  }

  return {
    providers: providers.length,
    ok: ok.length,
    review: providers.length - ok.length,
    review_reasons: count(
      providers.filter((p) => p.status === 'review'),
      (p) => (p.status_reason ?? '').replace(/[:(][\s\S]*$/, '').trim()
    ),
    by_method: count(providers, (p) => p.discovered_by),
    only_method: count(
      providers.filter((p) => p.discovered_by.length === 1),
      (p) => p.discovered_by[0]
    ),
    new_ok_in_gap_round: Object.fromEntries(
      [
        ...new Set(
          runs
            .filter((run) => run.method === 'gap_fill')
            .flatMap((run) => run.id.match(/^r(\d+)-/)?.[1] ?? [])
        ),
      ]
        .sort()
        .map((round) => [round, newInRound(Number(round))])
    ),
    by_town: count(providers, (p) => (p.area ?? 'unknown').split(/[,(]/)[0].trim()),
    by_kind: count(merged, (m) => (m.kinds.length > 0 ? m.kinds : ['unknown'])),
    by_category: count(merged, (m) => (m.categories.length > 0 ? m.categories : ['unknown'])),
    spend,
    totals: Object.values(spend).reduce(
      (total, row) => {
        for (const [key, value] of Object.entries(row)) total[key] = (total[key] ?? 0) + value;
        return total;
      },
      {} as Record<string, number>
    ),
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const step = process.argv[2];
  switch (step) {
    case 'seeds':
      return seeds();
    case 'grid':
      return runQueries(gridQueries(), true);
    case 'aggregator':
      return runQueries(aggregatorQueries(), true);
    case 'gap':
      return runQueries(gapQueries(Number(arg('--round') ?? 1)), true);
    case 'resolve':
      return resolve();
    case 'build':
      return build();
    default:
      console.error(
        'Usage: discover.ts seeds|grid|aggregator|gap --round N|resolve|build [options]'
      );
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
