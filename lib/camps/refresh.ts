/**
 * Summer camps refresh (docs/camps/01-context-and-plan.md §6.5, as simplified by 04-v2-plan.md §3):
 * re-read each provider's pages and re-extract with Sol only the providers whose pages changed, or
 * whose extraction was made with an older prompt or schema; then import those (importCamps) and
 * bring the camps' feed events in step (syncCampEvents). Run by /api/cron/camps-refresh daily and
 * by scripts/camps/refresh.ts (nightly from the local scheduled task, with the headless browser).
 *
 * Which providers. Every visible provider with an extraction and a known page that isn't a social
 * page, except the WebTrac catalog (below). One is due a week after its last check (the newer of
 * checked_at and extracted_at), or a day after when it's hot: in January, or when one of its camps
 * has a registration date within 3 days of today, either side (Matt wants daily checks then). A run
 * takes providers with a registration date near first, then the longest unchecked. Providers whose
 * last check failed stay due (checked_at didn't move) but go last, so a few unreadable sites can't
 * crowd out the rest.
 *
 * What's read. The bundle the extraction read (buildSourceBundle), plus every registration page
 * the provider's cards cite that its crawl doesn't reach (milestoneUrls), so a date Sol found by
 * web search is checked too.
 *
 * A failed check: no page could be read, or a page in the bundle failed for a reason other than a
 * 404/410 answer (a timeout, a block, or a page only a browser renders: Vercel has no browser, the
 * nightly local run does). It keeps every fact and the stored hash, records check_error and doesn't
 * advance checked_at. A page that answers 404/410 (or a soft 404) is left out of the bundle, so a
 * dead link changes the hash once. Social pages are never read.
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
import { campProviders, camps } from '@/lib/db/schema';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import geocodeCacheFile from '@/data/camps/geocode-cache.json';
import providersFile from '@/data/camps/providers.json';
import { campKeyFor, type CampCard, type Provider } from './contract';
import {
  EXTRACTION_FINGERPRINT,
  buildSourceBundle,
  extractProvider,
  type BundleLogEntry,
  type SavedExtraction,
} from './extract';
import { syncCampEvents } from './feedEvents';
import { createPageTextFetcher } from './fetchPageText';
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
const READ_TIMEOUT_MS = 120_000;
// Sol with web search took up to 183s on one attempt (bulk extraction, 2026-10-29)
const EXTRACT_TIMEOUT_MS = 300_000;
// Past endBy, the import's time to place new sites; callers keep ~2 min after endBy in all
const PLACE_AFTER_END_MS = 60_000;
// Reading the WebTrac catalog took ~4.5 min (pilot)
const WEBTRAC_READ_MS = 10 * 60_000;
// Gone, the same answer from anywhere: the bundle just lacks the page, and its hash says so
const GONE_ATTEMPT = /^[a-z-]+: (?:HTTP 404|HTTP 410|soft 404)/;

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
  sourceHash: campProviders.sourceHash,
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

/** Providers with a camp whose effective registration dates include one near today. */
async function providersWithOpeningNear(today: string): Promise<Set<string>> {
  const registration = sql`coalesce(${camps.override}->'registration', ${camps.card}->'registration')`;
  const rows = await db
    .selectDistinct({ key: camps.providerKey })
    .from(camps)
    .where(
      sql`exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(${registration}) = 'array' then ${registration} else '[]'::jsonb end
        ) as milestone
        where milestone->>'date' between ${shiftDay(today, -OPENING_WINDOW_DAYS)}
          and ${shiftDay(today, OPENING_WINDOW_DAYS)})`
    );
  return new Set(rows.map((row) => row.key));
}

/** `due`: the providers to check by reading their pages; `webTrac`: the catalog's, when it's due. */
export async function dueProviders(
  only?: string[]
): Promise<{ eligible: RefreshRow[]; due: RefreshCandidate[]; webTrac: RefreshCandidate[] }> {
  const today = getTodayStringEastern();
  const rows = await db
    .select(refreshColumns)
    .from(campProviders)
    .where(and(eq(campProviders.hidden, false), isNotNull(campProviders.extractionFingerprint)));
  const isWebTrac = (row: RefreshRow) =>
    !!row.extractionFingerprint?.startsWith('webtrac:') || !!LISTED.get(row.key)?.webtrac;
  // A provider known only by social pages has nothing we can read (login walls)
  const eligible = rows.filter(
    (row) => !isWebTrac(row) && row.urls.some((url) => !isSocialUrl(url))
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
    return { eligible, due: candidates.filter(named), webTrac: webTrac.filter(named) };
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
  return { eligible, due, webTrac: webTrac.filter(isDue) };
}

/** Aborts `controller` with a timeout error after `ms`; returns the function that calls it off. */
function abortAfter(controller: AbortController, ms: number, label: string): () => void {
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out after ${ms / 1000}s`)),
    ms
  );
  return () => clearTimeout(timer);
}

/** A page that failed for a reason that may not hold next time: anything but a 404/410 answer. */
function failedRead(entry: BundleLogEntry): boolean {
  if (!entry.error || isSocialUrl(entry.url)) return false;
  return !entry.error.split('; ').every((attempt) => GONE_ATTEMPT.test(attempt));
}

/**
 * The registration pages a provider's cards cite, sorted (buildSourceBundle reads the ones its crawl
 * doesn't reach). Only these, not every card source: on 2026-10-29, 492 of 741 providers cited a
 * source outside their bundle, and reading those would have re-extracted two thirds of them at once,
 * while the registration dates are what matter; 26 cited a registration page outside it.
 */
function milestoneUrls(cards: Iterable<CampCard>): string[] {
  const urls = new Set<string>();
  for (const card of cards) {
    for (const milestone of card.registration) {
      if (milestone.url && !isSocialUrl(milestone.url)) urls.add(milestone.url);
    }
  }
  return [...urls].sort();
}

/**
 * The provider's cards as extracted, oldest program first: `current`, by camp key, those in its
 * newest extraction; `names`, every program's name, retired ones too, so a program that comes back
 * keeps its key (and its saves, overrides and review).
 */
async function storedCards(
  providerKey: string
): Promise<{ current: Map<string, CampCard>; names: string[] }> {
  const rows = await db
    .select({
      campKey: camps.campKey,
      card: camps.card,
      current: sql<boolean>`${camps.lastExtractedAt} = ${campProviders.extractedAt}`,
    })
    .from(camps)
    .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
    .where(eq(camps.providerKey, providerKey))
    .orderBy(camps.firstSeenAt);
  return {
    current: new Map(rows.filter((row) => row.current).map((row) => [row.campKey, row.card])),
    names: [...new Set(rows.map((row) => row.card.name))],
  };
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
  // retries included. One fetcher per provider, so no page outlives its provider in memory, and no
  // disk cache: a refresh must read the pages as they are now.
  const controller = new AbortController();
  const { signal } = controller;
  const fetcher = createPageTextFetcher({ cacheTtlMs: 0, browser: options.browser, signal });
  let stopTimer = abortAfter(controller, READ_TIMEOUT_MS, 'reading the pages');

  try {
    const stored = await storedCards(row.key);
    const evidence = milestoneUrls(stored.current.values());
    const bundle = await buildSourceBundle(provider, fetcher, evidence);
    signal.throwIfAborted();
    stopTimer();
    pages = bundle.pages.length;
    const failed = bundle.log.filter(failedRead);
    if (pages === 0 || failed.length > 0) {
      const detail = (failed.length > 0 ? failed : bundle.log)
        .map((entry) => `${entry.url}: ${entry.error}`)
        .join(' | ');
      throw new Error(
        `${pages === 0 ? 'no page could be read' : 'a page could not be read'}: ${detail}`
      );
    }

    const reasons = [
      bundle.sourceHash !== row.sourceHash && 'pages changed',
      row.extractionFingerprint !== EXTRACTION_FINGERPRINT && 'prompt changed',
    ].filter(Boolean);
    if (reasons.length === 0) {
      if (options.apply) await markChecked([row.key]);
      return outcome({ outcome: 'unchanged', reason: null });
    }
    const reason = reasons.join(', ');
    if (!options.apply) return outcome({ outcome: 'changed', reason });
    if (Date.now() + EXTRACT_TIMEOUT_MS > options.endBy)
      return outcome({ outcome: 'deferred', reason: `${reason}; no time left to re-extract` });

    stopTimer = abortAfter(controller, EXTRACT_TIMEOUT_MS, 'extraction');
    // The fetcher remembers the pages, so the extraction's bundle is the one just hashed
    const run = await extractProvider(provider, today, {
      fetcher,
      existingPrograms: stored.names,
      evidence,
      signal,
    });
    // Store the hash of what the next check will read: the registration pages of the new cards,
    // the provider's current ones after the import (which retires the programs this extraction
    // dropped and keeps the first of two with one name), so a page Sol newly cites isn't taken
    // for a change next time.
    const after = new Map<string, CampCard>();
    for (const card of run.extraction.cards) {
      const campKey = campKeyFor(row.key, card.name);
      if (!after.has(campKey)) after.set(campKey, card);
    }
    const next = await buildSourceBundle(provider, fetcher, milestoneUrls(after.values()));
    signal.throwIfAborted();
    // A newly cited page that can't be read fails the check like any other: nothing is imported
    const failedNext = next.log.filter(failedRead);
    if (failedNext.length > 0) {
      const detail = failedNext.map((entry) => `${entry.url}: ${entry.error}`).join(' | ');
      throw new Error(`a page the new extraction cites could not be read: ${detail}`);
    }

    const saved: SavedExtraction = {
      provider,
      extractedAt: new Date().toISOString(),
      fingerprint: EXTRACTION_FINGERPRINT,
      sourceHash: next.sourceHash,
      response: run.response,
      bundle: run.bundle,
      extraction: run.extraction,
    };
    extractions.push(saved);
    await options.onExtracted?.(saved);
    return outcome({ outcome: 're-extracted', reason, cards: run.extraction.cards.length });
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
  const { eligible, due, webTrac: webTracDue } = await dueProviders(options.only);
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
