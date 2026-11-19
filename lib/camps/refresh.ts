/**
 * Summer camps refresh (docs/camps/01-context-and-plan.md §6.5, as simplified by 04-v2-plan.md §3):
 * re-read each provider's pages and re-extract with Sol only the providers whose pages changed, or
 * whose extraction was made with an older prompt or schema; then import those (importCamps) and
 * bring the camps' feed events in step (syncCampEvents). Run by /api/cron/camps-refresh daily and
 * by scripts/camps/refresh.ts (nightly from the local scheduled task, with the headless browser).
 *
 * Which providers. Every visible provider with an extraction and a known page that isn't a social
 * page, except the WebTrac catalog (below) and providers whose live camps are all more than
 * RADIUS_SLACK_MINUTES past the drive limit (they aren't listed; Matt, 2026-11-19). One is due a
 * week after its last check (the newer of checked_at and extracted_at), or a day after when it's
 * hot: in January, or when one of its live camps has a registration date within 3 days of today,
 * either side (Matt wants daily checks then). A run takes providers with a registration date near
 * first, then the longest unchecked. Providers whose last check failed stay due (checked_at didn't
 * move) but go last, so a few unreadable sites can't crowd out the rest.
 *
 * What's read. The bundle the extraction read (buildSourceBundle), plus the registration pages the
 * provider's cards name (watchedUrls): each registration date's page, so a date Sol found by web
 * search is checked too, and each card's registration link, which is where an opening date shows
 * up first.
 *
 * What counts as changed. The pages' fact lines (lib/camps/sourceLines.ts) against the baseline
 * stored with the newest extraction, page by page: a line no page had before, or a line gone from
 * a page that was read. A difference is believed only when a second read, right after, shows it
 * too (a captcha, a countdown or a shuffled carousel differs on every read), and lines the two
 * reads disagree on are remembered as unstable and never counted again. The run's outcome quotes a
 * few of the new lines, so a false alarm can be seen for what it is, and the model is shown them. A
 * provider with no baseline yet (extracted before 2026-11-19) is re-extracted once, as is one whose
 * last extraction left out a program for the first time (importCamps keeps it for one more round;
 * this is the second look).
 *
 * A failed check: none of the provider's own pages (its seeds) could be read. It keeps every fact
 * and the baseline, records check_error and doesn't advance checked_at; `npm run cron:health` lists
 * providers that have failed for two weeks. Any other page that can't be read no longer fails the
 * check (until 2026-11-19 one calendar link or share button froze the whole provider: 43 of them,
 * for three weeks): the check goes ahead on the pages it has, that page's stored lines stand, and
 * a registration date it was cited for stays on the card. A page that answers 404, 410 or 401 (or
 * a soft 404) is simply gone, and its lines with it. Social pages are never read.
 *
 * Only a run that may re-extract does (`extract`: the nightly local run; Matt keeps the updates on
 * his PC, which has the model key and the browser). The Vercel run still reads and compares, marks
 * unchanged providers checked and leaves the changed ones due ('deferred'). It also defers when a
 * page couldn't be read and nothing else changed: the page may only need the browser.
 *
 * Time. Each provider has one AbortSignal: its page reads get READ_TIMEOUT_MS, a re-extraction
 * EXTRACT_TIMEOUT_MS, and a timeout aborts every page read and model call in flight, retries
 * included. Work stops starting in time to finish by `endBy`; the import after it places new sites
 * only while that can finish within PLACE_AFTER_END_MS of `endBy` (the rest wait for the next import).
 *
 * WebTrac (Asheville Parks & Rec's catalog) is read without a model by lib/camps/webtrac.ts, which
 * needs the headless browser (Cloudflare), so only a local run with `webtrac: true` re-reads it, on
 * the same weekly / daily cadence, within WEBTRAC_READ_MS, and imports it with the rest. A read
 * that misses any search or detail page fails like a provider's check: the stored cards stay.
 *
 * A dry run (apply: false) reads and hashes; it calls no model and writes nothing.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { liveCamp, queryCamps } from '@/lib/db/queries/camps';
import { campProviders, camps } from '@/lib/db/schema';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import geocodeCacheFile from '@/data/camps/geocode-cache.json';
import providersFile from '@/data/camps/providers.json';
import { campKeyFor, type CampCard, type Provider } from './contract';
import {
  EXTRACTION_FINGERPRINT,
  buildSourceBundle,
  extractProvider,
  type SavedExtraction,
  type SourceBundle,
} from './extract';
import { syncCampEvents } from './feedEvents';
import { createPageTextFetcher, isHttpUrl } from './fetchPageText';
import { hashLines, pageId, readBaseline, writeBaseline, type FactLine } from './sourceLines';
import type { SiteGeo } from './geo';
import { importCamps, type ImportSummary } from './importCamps';
import { isSocialUrl } from './platforms';
import { readWebTracCatalog, webTracExtraction, type WebTracCatalog } from './webtrac';

/** A little under a week and a day, so a daily run at the same hour never misses by minutes. */
const CHECK_EVERY_HOURS = 7 * 24 - 4;
const HOT_CHECK_EVERY_HOURS = 20;
const OPENING_WINDOW_DAYS = 3;
const CONCURRENCY = 6;
// Up to 9 crawled pages plus the cards' registration pages, each with its own timeouts and retries
const READ_TIMEOUT_MS = 150_000;
// Sol with web search took up to 183s on one attempt (bulk extraction, 2026-10-29)
const EXTRACT_TIMEOUT_MS = 300_000;
// Past endBy, the import's time to place new sites; callers keep ~2 min after endBy in all
const PLACE_AFTER_END_MS = 60_000;
// Reading the WebTrac catalog took ~4.5 min (pilot)
const WEBTRAC_READ_MS = 10 * 60_000;
// Camps this far past the drive limit are still refreshed, in case the limit moves (39 providers
// sat 55-65 minutes out on 2026-11-19); the 200-odd farther out are not.
const RADIUS_SLACK_MINUTES = 10;
// The cards' registration links read per provider, beyond its crawl and the pages its registration
// dates cite (a provider with a link per program would otherwise spend its whole read time on them)
const MAX_REGISTRATION_LINKS = 6;
// A read starts no more links or watched pages this long in, so what it has read is kept instead of
// the whole read timing out at READ_TIMEOUT_MS. The gap is one page's worst case (fetch, Chrome
// TLS, then the browser: about 100s).
const READ_SOFT_MS = 45_000;
// New lines quoted in an outcome's reason, and pointed out to the model
const QUOTED_LINES = 3;
const CHANGED_LINES_SHOWN = 40;

/** Hints and the WebTrac flag aren't stored in the database. */
type ListedProvider = Pick<Provider, 'key' | 'hint' | 'webtrac' | 'status' | 'status_reason'>;
const listedJson = providersFile as unknown as ListedProvider[] | { providers: ListedProvider[] };
const LISTED = new Map(
  (Array.isArray(listedJson) ? listedJson : listedJson.providers).map((p) => [p.key, p])
);
/** scripts/camps/import.ts's geocoder results, misses included, so known misses aren't retried. */
const GEOCODE_CACHE = geocodeCacheFile as unknown as Record<string, SiteGeo | null>;

const refreshColumns = {
  key: campProviders.key,
  name: campProviders.name,
  urls: campProviders.urls,
  area: campProviders.area,
  discoveredBy: campProviders.discoveredBy,
  sourceLines: campProviders.sourceLines,
  extractionFingerprint: campProviders.extractionFingerprint,
  extractedAt: campProviders.extractedAt,
  checkedAt: campProviders.checkedAt,
  checkError: campProviders.checkError,
};

export type RefreshRow = {
  [K in keyof typeof refreshColumns]: (typeof campProviders.$inferSelect)[K];
};

export interface RefreshCandidate {
  row: RefreshRow;
  /** Due daily: January, or a registration date within OPENING_WINDOW_DAYS. */
  hot: boolean;
  /** A registration date within OPENING_WINDOW_DAYS: checked first. */
  openingNear: boolean;
}

export interface RefreshOutcome {
  key: string;
  /** 'changed' is a dry run's 're-extracted'; 'deferred' changed too late in the run to re-extract. */
  outcome: 'unchanged' | 'changed' | 're-extracted' | 'deferred' | 'failed';
  /** Why it was (or would be) re-extracted, or why the check failed. */
  reason: string | null;
  hot: boolean;
  pages: number;
  ms: number;
  /** Cards in the new extraction. */
  cards?: number;
}

export interface CheckOptions {
  /** false: read and hash only, no model calls and no writes. */
  apply: boolean;
  /** Epoch ms all provider work must be done by: a read or extraction that might not finish isn't started. */
  endBy: number;
  /** The headless browser rung (none on Vercel). */
  browser: boolean;
  /** false: this run leaves changed providers due for one that re-extracts (the local run). */
  extract?: boolean;
  concurrency?: number;
  onOutcome?: (outcome: RefreshOutcome) => void;
  /** Each new extraction, e.g. for the script to save next to the others. */
  onExtracted?: (saved: SavedExtraction) => Promise<void>;
}

export interface RefreshOptions extends CheckOptions {
  /** Check at most this many due providers. */
  limit?: number;
  /** Check these providers, due or not. */
  only?: string[];
  /** Re-read the WebTrac catalog when it's due (local runs: it needs the browser). */
  webtrac?: boolean;
  /** Each WebTrac catalog read, e.g. for the script to save as scripts/camps/extract.ts's cache. */
  onWebTracCatalog?: (catalog: WebTracCatalog) => Promise<void>;
}

export interface RefreshResult {
  /** Providers the refresh looks after (WebTrac's not counted). */
  eligible: number;
  /** Providers left alone because their camps are all too far away to list (cron:health reads it). */
  outOfRange: string[];
  due: number;
  checked: number;
  unchanged: number;
  changed: number;
  reExtracted: number;
  deferred: number;
  failed: number;
  /** Due but not reached: out of time, or past the limit. */
  notStarted: number;
  imported: ImportSummary | null;
  feedEvents: { created: number; updated: number; removed: number } | null;
  outcomes: RefreshOutcome[];
}

function providerFor(row: RefreshRow): Provider {
  const listed = LISTED.get(row.key);
  return {
    key: row.key,
    name: row.name,
    urls: row.urls,
    area: row.area,
    ...(listed?.hint && { hint: listed.hint }),
    discovered_by: row.discoveredBy,
    status: listed?.status ?? 'ok',
    ...(listed?.status_reason && { status_reason: listed.status_reason }),
  };
}

function lastChecked(row: RefreshRow): number {
  return Math.max(row.checkedAt?.getTime() ?? 0, row.extractedAt?.getTime() ?? 0);
}

/** YYYY-MM-DD, `days` days from an Eastern date (calendar arithmetic in UTC, so DST can't shift it). */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** Providers with a live camp whose effective registration dates include one near today. */
async function providersWithOpeningNear(today: string): Promise<Set<string>> {
  const registration = sql`coalesce(${camps.override}->'registration', ${camps.card}->'registration')`;
  const rows = await db
    .selectDistinct({ key: camps.providerKey })
    .from(camps)
    .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
    .where(
      and(
        liveCamp,
        sql`exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(${registration}) = 'array' then ${registration} else '[]'::jsonb end
        ) as milestone
        where milestone->>'date' between ${shiftDay(today, -OPENING_WINDOW_DAYS)}
          and ${shiftDay(today, OPENING_WINDOW_DAYS)})`
      )
    );
  return new Set(rows.map((row) => row.key));
}

/**
 * Providers with live camps, none of them within RADIUS_SLACK_MINUTES of being listed. A provider
 * with no live camp at all isn't one: its next extraction may find its first.
 */
async function providersOutOfRange(): Promise<Set<string>> {
  const [live, near] = await Promise.all([
    db
      .selectDistinct({ key: camps.providerKey })
      .from(camps)
      .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
      .where(liveCamp),
    queryCamps(undefined, RADIUS_SLACK_MINUTES, true),
  ]);
  const nearKeys = new Set(near.map((camp) => camp.providerKey));
  return new Set(live.map((row) => row.key).filter((key) => !nearKeys.has(key)));
}

/** `due`: the providers to check by reading their pages; `webTrac`: the catalog's, when it's due. */
export async function dueProviders(only?: string[]): Promise<{
  eligible: RefreshRow[];
  due: RefreshCandidate[];
  webTrac: RefreshCandidate[];
  outOfRange: string[];
}> {
  const today = getTodayStringEastern();
  const rows = await db
    .select(refreshColumns)
    .from(campProviders)
    .where(and(eq(campProviders.hidden, false), isNotNull(campProviders.extractionFingerprint)));
  const isWebTrac = (row: RefreshRow) =>
    !!row.extractionFingerprint?.startsWith('webtrac:') || !!LISTED.get(row.key)?.webtrac;
  // A provider known only by social pages has nothing we can read (login walls). Naming a provider
  // (`only`) checks it however far away its camps are.
  const outOfRange = only ? new Set<string>() : await providersOutOfRange();
  const eligible = rows.filter(
    (row) =>
      !isWebTrac(row) && row.urls.some((url) => !isSocialUrl(url)) && !outOfRange.has(row.key)
  );
  const openingNear = await providersWithOpeningNear(today);
  const january = today.slice(5, 7) === '01';

  const candidate = (row: RefreshRow): RefreshCandidate => ({
    row,
    hot: january || openingNear.has(row.key),
    openingNear: openingNear.has(row.key),
  });
  const candidates = eligible.map(candidate);
  const webTrac = rows.filter(isWebTrac).map(candidate);
  if (only) {
    const named = (c: RefreshCandidate) => only.includes(c.row.key);
    return {
      eligible,
      due: candidates.filter(named),
      webTrac: webTrac.filter(named),
      outOfRange: [],
    };
  }

  const now = Date.now();
  const isDue = (c: RefreshCandidate) => {
    const every = c.hot ? HOT_CHECK_EVERY_HOURS : CHECK_EVERY_HOURS;
    return now - lastChecked(c.row) >= every * 3_600_000;
  };
  const due = candidates
    .filter(isDue)
    .sort(
      (a, b) =>
        Number(a.row.checkError !== null) - Number(b.row.checkError !== null) ||
        Number(b.openingNear) - Number(a.openingNear) ||
        lastChecked(a.row) - lastChecked(b.row)
    );
  return { eligible, due, webTrac: webTrac.filter(isDue), outOfRange: [...outOfRange].sort() };
}

/** Aborts `controller` with a timeout error after `ms`; returns the function that calls it off. */
function abortAfter(controller: AbortController, ms: number, label: string): () => void {
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out after ${ms / 1000}s`)),
    ms
  );
  return () => clearTimeout(timer);
}

/**
 * How a bundle's reads went. `failed`: pages that couldn't be read for a reason that may pass
 * (anything but a gone page; social pages are never read). `unreadable`: none of the provider's own
 * pages (its seeds) was read, so the check can't go ahead: what a home page or a registration
 * system says by itself is no ground for replacing the provider's cards.
 */
export function readState(bundle: SourceBundle): { failed: string[]; unreadable: string | null } {
  const tried = bundle.log.filter((entry) => !isSocialUrl(entry.url));
  const failed = tried.filter((entry) => entry.error && !entry.gone);
  const detail = (entries: typeof tried) =>
    entries.map((entry) => `${entry.url}: ${entry.error}`).join(' | ');
  const seeds = tried.filter((entry) => entry.role === 'seed');
  let unreadable: string | null = null;
  if (bundle.pages.length === 0) {
    unreadable = `no page could be read: ${detail(tried.filter((entry) => entry.error))}`;
  } else if (!seeds.some((entry) => !entry.error)) {
    unreadable = `none of the provider's own pages could be read: ${detail(seeds)}`;
  }
  return { failed: failed.map((entry) => entry.url), unreadable };
}

/** Fact lines the baseline doesn't know, and baseline lines ("page:hash") the pages no longer have. */
export interface LineChange {
  added: FactLine[];
  removed: string[];
}

/**
 * Page by page. A stored line counts as removed only when its own page was read this time (or is
 * gone) and no longer has it: a page that couldn't be read, or wasn't among the ones read this
 * time, says nothing about its lines. A line is new when its page was in the baseline without it;
 * on a page the baseline has never seen, when no page had it (a new link to the same text isn't
 * news). Lines known to be unstable never count.
 */
export function lineChange(stored: string[], bundle: SourceBundle): LineChange {
  const baseline = readBaseline(stored);
  const before = new Set(baseline.lines.map((line) => `${line.page}:${line.hash}`));
  const knownPages = new Set(baseline.lines.map((line) => line.page));
  const now = new Set(bundle.lines.map((line) => `${line.page}:${line.hash}`));
  const read = new Set(
    bundle.log.filter((entry) => !entry.error || entry.gone).map((entry) => pageId(entry.url))
  );
  const added = new Map<string, FactLine>();
  for (const line of bundle.lines) {
    if (baseline.unstable.has(line.hash)) continue;
    const isNew = knownPages.has(line.page)
      ? !before.has(`${line.page}:${line.hash}`)
      : !baseline.known.has(line.hash);
    if (isNew) added.set(line.hash, line);
  }
  return {
    added: [...added.values()],
    removed: baseline.lines
      .map((line) => `${line.page}:${line.hash}`)
      .filter((entry) => read.has(entry.split(':')[0]) && !now.has(entry)),
  };
}

/**
 * Lines the first read had on a page the second read too, without them: the model is given the
 * second read, so it is shown these as well (they are about to be remembered as unstable, and one
 * of them may be a fact that loaded late).
 */
function onlyInFirst(first: SourceBundle, second: SourceBundle): FactLine[] {
  const pages = new Set(
    second.log.filter((entry) => !entry.error).map((entry) => pageId(entry.url))
  );
  const lines = new Set(second.lines.map((line) => line.hash));
  return first.lines.filter((line) => pages.has(line.page) && !lines.has(line.hash));
}

/** What both reads agree changed. */
export function inBoth(first: LineChange, second: LineChange): LineChange {
  const added = new Set(second.added.map((line) => line.hash));
  const removed = new Set(second.removed);
  return {
    added: first.added.filter((line) => added.has(line.hash)),
    removed: first.removed.filter((entry) => removed.has(entry)),
  };
}

function hasChange(change: LineChange | null): change is LineChange {
  return !!change && change.added.length + change.removed.length > 0;
}

function describeChange(change: LineChange): string {
  const quoted = change.added
    .slice(0, QUOTED_LINES)
    .map((line) => `"${line.text.slice(0, 90)}"`)
    .join(', ');
  return `${change.added.length} lines new, ${change.removed.length} gone${quoted ? `: ${quoted}` : ''}`;
}

/**
 * The baseline to store with a new extraction: the lines of `next` (the pages the next check will
 * read) for the pages the model was given or the new cards name. What was stored stands for every
 * other page: one that couldn't be read, one that wasn't among the pages read this time (the
 * registration links take turns), and one `second` (the model's read) failed on, whose lines the
 * model never saw even if `next` read it. A line that one of the two reads before the extraction
 * had and the other, reading the same page, didn't is unstable (a rotating list): it is remembered
 * as such and never taken for a change again. Without that, a site that shows a different handful
 * of items on each read was re-extracted on every check.
 */
export function nextBaseline(
  stored: string[] | null,
  first: SourceBundle,
  second: SourceBundle,
  next: SourceBundle
): string[] {
  const old = readBaseline(stored ?? []);
  const readPages = (bundle: SourceBundle) =>
    new Set(bundle.log.filter((entry) => !entry.error).map((entry) => pageId(entry.url)));
  const hashes = (bundle: SourceBundle) => new Set(bundle.lines.map((line) => line.hash));
  const unstable = new Set(old.unstable);
  const oneSided = (a: SourceBundle, b: SourceBundle) => {
    const [pages, lines] = [readPages(b), hashes(b)];
    for (const line of a.lines)
      if (pages.has(line.page) && !lines.has(line.hash)) unstable.add(line.hash);
  };
  oneSided(first, second);
  oneSided(second, first);

  const unseen = new Set(
    second.log.filter((entry) => entry.error && !entry.gone).map((entry) => pageId(entry.url))
  );
  // Read now (or gone now), and seen by the model if it was among its pages: the new lines stand
  const settled = new Set(
    next.log
      .filter((entry) => !entry.error || entry.gone)
      .map((entry) => pageId(entry.url))
      .filter((page) => !unseen.has(page))
  );
  return writeBaseline(
    [
      ...next.lines.filter((line) => settled.has(line.page)),
      ...old.lines.filter((line) => !settled.has(line.page)),
    ],
    unstable
  );
}

/**
 * The registration pages a provider's cards name (buildSourceBundle reads the ones its crawl
 * doesn't reach): every page a registration date cites, then the cards' registration links,
 * MAX_REGISTRATION_LINKS of them a day, taking turns by `day` (YYYY-MM-DD) when there are more.
 * Cited pages first, so they are read first when time is short. On 2026-11-19, 133 providers had
 * no registration date yet and a registration link the crawl never read, which is where the date
 * would first appear. Not every card source: 492 of 741 providers cited one outside their bundle
 * (2026-10-29).
 */
export function watchedUrls(cards: Iterable<CampCard>, day: string): string[] {
  const readable = (url: string | null | undefined): url is string =>
    !!url && isHttpUrl(url) && !isSocialUrl(url);
  const cited = new Set<string>();
  const links = new Set<string>();
  for (const card of cards) {
    for (const milestone of card.registration)
      if (readable(milestone.url)) cited.add(milestone.url);
    if (readable(card.registration_url)) links.add(card.registration_url);
  }
  const more = [...links].filter((url) => !cited.has(url)).sort();
  const turn =
    more.length > MAX_REGISTRATION_LINKS
      ? Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % more.length
      : 0;
  const taken = [...more.slice(turn), ...more.slice(0, turn)].slice(0, MAX_REGISTRATION_LINKS);
  return [...[...cited].sort(), ...taken.sort()];
}

/**
 * A registration date whose page couldn't be read this time stays on the card when the new
 * extraction has no date of that kind for that audience: the model never saw the page, so its
 * silence isn't the camp withdrawing the date. Audience "other" is several groups, each with its
 * own page, so there only a date from the same page replaces it.
 */
export function keepUnreadDates(
  old: CampCard | undefined,
  card: CampCard,
  unread: Set<string>
): CampCard {
  const kept = (old?.registration ?? []).filter(
    (milestone) =>
      unread.has(milestone.url) &&
      !card.registration.some(
        (other) =>
          other.audience === milestone.audience &&
          other.kind === milestone.kind &&
          (milestone.audience !== 'other' || other.url === milestone.url)
      )
  );
  return kept.length > 0 ? { ...card, registration: [...card.registration, ...kept] } : card;
}

interface StoredCamp {
  /** As extracted. */
  card: CampCard;
  override: Partial<CampCard> | null;
  hidden: boolean;
  /** In the provider's newest extraction. */
  current: boolean;
  /** Missing from that extraction, and kept for one more (importCamps). */
  missed: boolean;
}

/**
 * The provider's camps by camp key, oldest program first; `names`, every program's name, retired
 * ones too, so a program that comes back keeps its key (and its saves, overrides and review).
 */
async function storedCards(
  providerKey: string
): Promise<{ camps: Map<string, StoredCamp>; names: string[] }> {
  const rows = await db
    .select({
      campKey: camps.campKey,
      card: camps.card,
      override: camps.override,
      hidden: camps.hidden,
      missedAt: camps.missedAt,
      current: sql<boolean>`${camps.lastExtractedAt} = ${campProviders.extractedAt}`,
    })
    .from(camps)
    .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
    .where(eq(camps.providerKey, providerKey))
    .orderBy(camps.firstSeenAt);
  return {
    camps: new Map(
      rows.map((row) => [
        row.campKey,
        {
          card: row.card,
          override: row.override,
          hidden: row.hidden,
          current: row.current,
          missed: row.missedAt !== null,
        },
      ])
    ),
    names: [...new Set(rows.map((row) => row.card.name))],
  };
}

/** The cards a parent can see, as shown (Matt's fixes applied): the ones whose pages are watched. */
function shownCards(stored: Iterable<StoredCamp>): CampCard[] {
  return [...stored]
    .filter((camp) => camp.current && !camp.hidden)
    .map((camp) => ({ ...camp.card, ...camp.override }));
}

async function markChecked(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .update(campProviders)
    .set({ checkedAt: new Date(), checkError: null })
    .where(inArray(campProviders.key, keys));
}

async function markFailed(key: string, reason: string): Promise<void> {
  await db
    .update(campProviders)
    .set({ checkError: reason.slice(0, 2000) })
    .where(eq(campProviders.key, key));
}

async function checkProvider(
  candidate: RefreshCandidate,
  today: string,
  options: CheckOptions,
  extractions: SavedExtraction[]
): Promise<RefreshOutcome> {
  const { row, hot } = candidate;
  const provider = providerFor(row);
  const started = Date.now();
  let pages = 0;
  const outcome = (
    result: Pick<RefreshOutcome, 'outcome' | 'reason' | 'cards'>
  ): RefreshOutcome => ({ key: row.key, hot, pages, ms: Date.now() - started, ...result });
  // One signal for all of this provider's work: a timeout stops its page reads and model calls,
  // retries included. No disk cache: a refresh must read the pages as they are now.
  const controller = new AbortController();
  const { signal } = controller;
  const newFetcher = () =>
    createPageTextFetcher({ cacheTtlMs: 0, browser: options.browser, signal });
  let fetcher = newFetcher();
  let stopTimer = () => {};

  /** One read of the provider's pages, given READ_TIMEOUT_MS; throws when its own pages can't be read. */
  const read = async (label: string, watched: string[]) => {
    stopTimer = abortAfter(controller, READ_TIMEOUT_MS, label);
    const bundle = await buildSourceBundle(provider, fetcher, watched, Date.now() + READ_SOFT_MS);
    signal.throwIfAborted();
    stopTimer();
    pages = bundle.pages.length;
    const state = readState(bundle);
    if (state.unreadable) throw new Error(state.unreadable);
    return { bundle, failed: state.failed };
  };

  try {
    const stored = await storedCards(row.key);
    const watched = watchedUrls(shownCards(stored.camps.values()), today);
    const first = await read('reading the pages', watched);
    const baseline = row.sourceLines;
    const firstChange = baseline ? lineChange(baseline, first.bundle) : null;
    // Reasons to re-extract whatever the pages say
    const standing = [
      !baseline && 'no page lines stored yet',
      row.extractionFingerprint !== EXTRACTION_FINGERPRINT && 'prompt changed',
      // The second look that settles whether a program left out once is really gone
      [...stored.camps.values()].some((camp) => camp.current && camp.missed) &&
        'a program was missing from the last extraction',
    ].filter((reason): reason is string => !!reason);

    const unchanged = async (failed: string[]) => {
      const unread = failed.length > 0 ? `${failed.length} pages could not be read` : null;
      // Without a browser an unread page may just need one (a registration system's pages
      // usually do): not a full check, so the provider stays due for the run that has it
      if (unread && !options.browser)
        return outcome({ outcome: 'deferred', reason: `nothing new; ${unread} without a browser` });
      if (options.apply) await markChecked([row.key]);
      return outcome({ outcome: 'unchanged', reason: unread });
    };
    if (standing.length === 0 && !hasChange(firstChange)) return await unchanged(first.failed);
    if (options.apply && options.extract === false && standing.length > 0)
      return outcome({
        outcome: 'deferred',
        reason: `${standing.join(', ')}; this run doesn't re-extract`,
      });

    // A second read from scratch: a difference is believed only when both reads show it, and the
    // lines the two reads disagree on are what the new baseline leaves out
    if (Date.now() + READ_TIMEOUT_MS > options.endBy)
      return outcome({
        outcome: 'deferred',
        reason: `${[...standing, hasChange(firstChange) ? `pages may have changed (${describeChange(firstChange)})` : ''].filter(Boolean).join(', ')}; no time left to read them again`,
      });
    await fetcher.close();
    fetcher = newFetcher();
    const second = await read('reading the pages again', watched);
    const change =
      baseline && firstChange ? inBoth(firstChange, lineChange(baseline, second.bundle)) : null;
    const failed = [...new Set([...first.failed, ...second.failed])];
    const reasons = [
      ...standing,
      ...(hasChange(change) ? [`pages changed (${describeChange(change)})`] : []),
    ];
    if (reasons.length === 0) return await unchanged(failed);

    const unread = failed.length > 0 ? `; ${failed.length} pages could not be read` : '';
    const reason = `${reasons.join(', ')}${unread}`;
    if (!options.apply) return outcome({ outcome: 'changed', reason });
    if (options.extract === false)
      return outcome({ outcome: 'deferred', reason: `${reason}; this run doesn't re-extract` });
    if (Date.now() + EXTRACT_TIMEOUT_MS > options.endBy)
      return outcome({ outcome: 'deferred', reason: `${reason}; no time left to re-extract` });

    stopTimer = abortAfter(controller, EXTRACT_TIMEOUT_MS, 'extraction');
    const run = await extractProvider(provider, today, {
      fetcher,
      existingPrograms: stored.names,
      bundle: second.bundle,
      changed: [...(change?.added ?? []), ...onlyInFirst(first.bundle, second.bundle)]
        .slice(0, CHANGED_LINES_SHOWN)
        .map((line) => line.text),
      signal,
    });
    // A registration date whose page went unread this time isn't dropped on the model's silence
    const unreadUrls = new Set(second.failed);
    const cards = run.extraction.cards.map((card) =>
      keepUnreadDates(stored.camps.get(campKeyFor(row.key, card.name))?.card, card, unreadUrls)
    );

    // Store the lines of what the next check will read: the registration pages of the cards as
    // they'll stand after the import (the first of two with one name; Matt's fixes applied; hidden
    // ones left out; a program missing for the first time stays), so a page Sol newly cites isn't
    // taken for a change next time.
    const after = new Map<string, StoredCamp>();
    for (const card of cards) {
      const campKey = campKeyFor(row.key, card.name);
      if (after.has(campKey)) continue;
      const was = stored.camps.get(campKey);
      after.set(campKey, {
        card,
        override: was?.override ?? null,
        hidden: was?.hidden ?? false,
        current: true,
        missed: false,
      });
    }
    for (const [campKey, camp] of stored.camps)
      if (camp.current && !camp.missed && !after.has(campKey)) after.set(campKey, camp);
    const next = await buildSourceBundle(
      provider,
      fetcher,
      watchedUrls(shownCards(after.values()), today),
      Date.now() + READ_SOFT_MS
    );
    signal.throwIfAborted();
    const sourceLines = nextBaseline(baseline, first.bundle, second.bundle, next);

    const saved: SavedExtraction = {
      provider,
      extractedAt: new Date().toISOString(),
      fingerprint: EXTRACTION_FINGERPRINT,
      sourceHash: hashLines(sourceLines),
      sourceLines,
      response: run.response,
      bundle: run.bundle,
      extraction: { ...run.extraction, cards },
    };
    extractions.push(saved);
    await options.onExtracted?.(saved);
    return outcome({ outcome: 're-extracted', reason, cards: cards.length });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (options.apply) await markFailed(row.key, reason);
    return outcome({ outcome: 'failed', reason });
  } finally {
    stopTimer();
    await fetcher.close();
  }
}

/** Check providers in order until they run out or the time does. */
export async function checkProviders(
  candidates: RefreshCandidate[],
  options: CheckOptions
): Promise<{ outcomes: RefreshOutcome[]; extractions: SavedExtraction[] }> {
  const today = getTodayStringEastern();
  const outcomes: RefreshOutcome[] = [];
  const extractions: SavedExtraction[] = [];
  let next = 0;

  async function worker() {
    while (next < candidates.length && Date.now() + READ_TIMEOUT_MS <= options.endBy) {
      const outcome = await checkProvider(candidates[next++], today, options, extractions);
      outcomes.push(outcome);
      options.onOutcome?.(outcome);
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? CONCURRENCY }, worker));
  return { outcomes, extractions };
}

/**
 * Read the WebTrac catalog once, aborted after WEBTRAC_READ_MS, and make each WebTrac provider's
 * cards from it (no model).
 */
async function readWebTrac(
  candidates: RefreshCandidate[],
  options: RefreshOptions
): Promise<{ outcomes: RefreshOutcome[]; extractions: SavedExtraction[] }> {
  const started = Date.now();
  const outcomes = (result: Pick<RefreshOutcome, 'outcome' | 'reason' | 'cards'>) =>
    candidates.map(({ row, hot }) => ({
      key: row.key,
      hot,
      pages: 0,
      ms: Date.now() - started,
      ...result,
    }));
  const controller = new AbortController();
  const stopTimer = abortAfter(controller, WEBTRAC_READ_MS, 'reading the WebTrac catalog');
  try {
    const catalog = await readWebTracCatalog(controller.signal);
    stopTimer();
    const reason = `catalog read: ${catalog.rows.length} summer rows`;
    if (!options.apply)
      return { outcomes: outcomes({ outcome: 'changed', reason }), extractions: [] };
    await options.onWebTracCatalog?.(catalog);

    // As scripts/camps/extract.ts makes them from the saved catalog
    const sourceHash = createHash('sha256').update(JSON.stringify(catalog.rows)).digest('hex');
    const extractions = candidates.map(({ row }): SavedExtraction => {
      const provider = providerFor(row);
      return {
        provider,
        extractedAt: catalog.readAt,
        fingerprint: `webtrac:${catalog.readAt}`,
        sourceHash,
        response: null,
        bundle: null,
        extraction: webTracExtraction(catalog, provider),
      };
    });
    for (const saved of extractions) await options.onExtracted?.(saved);
    const cards = extractions[0]?.extraction.cards.length ?? 0;
    return { outcomes: outcomes({ outcome: 're-extracted', reason, cards }), extractions };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (options.apply) for (const { row } of candidates) await markFailed(row.key, reason);
    return { outcomes: outcomes({ outcome: 'failed', reason }), extractions: [] };
  } finally {
    stopTimer();
  }
}

export async function refreshCamps(options: RefreshOptions): Promise<RefreshResult> {
  const { eligible, due, webTrac: webTracDue, outOfRange } = await dueProviders(options.only);
  const queue = due.slice(0, options.limit ?? due.length);

  // The catalog first: it takes minutes, and only a local run reads it
  const webTrac = options.webtrac ? webTracDue : [];
  const catalog =
    webTrac.length > 0 && Date.now() + WEBTRAC_READ_MS <= options.endBy
      ? await readWebTrac(webTrac, options)
      : { outcomes: [], extractions: [] };
  catalog.outcomes.forEach((outcome) => options.onOutcome?.(outcome));

  const checked = await checkProviders(queue, options);
  const outcomes = [...catalog.outcomes, ...checked.outcomes];
  const extractions = [...catalog.extractions, ...checked.extractions];

  let imported: ImportSummary | null = null;
  let feedEvents: RefreshResult['feedEvents'] = null;
  if (options.apply) {
    if (extractions.length > 0) {
      imported = await importCamps({
        source: `${extractions.length} re-extracted providers`,
        providers: extractions.map((saved) => saved.provider),
        extractions,
        geocodeCache: { ...GEOCODE_CACHE },
        apply: true,
        placeBy: options.endBy + PLACE_AFTER_END_MS,
      });
      await markChecked(extractions.map((saved) => saved.provider.key));
    }
    // Every run, so admin edits and file imports reach the feed too
    feedEvents = await syncCampEvents();
  }

  const count = (kind: RefreshOutcome['outcome']) =>
    outcomes.filter((o) => o.outcome === kind).length;
  return {
    eligible: eligible.length,
    outOfRange,
    due: due.length + webTrac.length,
    checked: outcomes.length,
    unchanged: count('unchanged'),
    changed: count('changed'),
    reExtracted: count('re-extracted'),
    deferred: count('deferred'),
    failed: count('failed'),
    notStarted: due.length + webTrac.length - outcomes.length,
    imported,
    feedEvents,
    outcomes,
  };
}
