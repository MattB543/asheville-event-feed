/**
 * Summer camps refresh (docs/camps/01-context-and-plan.md §6.5, as simplified by 04-v2-plan.md §3):
 * re-read each provider's pages and re-extract with Sol only the providers whose pages changed, or
 * whose extraction was made with an older prompt or schema; then import those (importCamps) and
 * bring the camps' feed events in step (syncCampEvents). Run by /api/cron/camps-refresh daily and
 * by scripts/camps/refresh.ts.
 *
 * Which providers. Every visible provider with an extraction and a known page that isn't a social
 * page, except the WebTrac catalog (scripts/camps/read-webtrac.ts + extract.ts refresh that,
 * locally). One is due a week after its last check (the newer of checked_at and extracted_at), or
 * a day after when it's hot: in January, or when one of its camps has a registration date within 3
 * days of today, either side (Matt wants daily checks then). A run takes providers with a
 * registration date near first, then the longest unchecked. Providers whose last check failed stay
 * due (checked_at didn't move) but go last, so a few unreadable sites can't crowd out the rest.
 * Work stops starting in time to finish by `endBy`.
 *
 * A failed check: the pages read nothing, or one of the provider's own pages (Provider.urls)
 * couldn't be read for a reason other than a 404/410 answer (a timeout, a block, or a page only a
 * browser renders: Vercel has no browser, scripts/camps/refresh.ts does). It keeps every fact,
 * records check_error and doesn't advance checked_at. A linked page that fails is left out of the
 * bundle, as in extraction, so a dead link changes the hash once.
 *
 * A dry run (apply: false) reads and hashes; it calls no model and writes nothing.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campProviders, camps } from '@/lib/db/schema';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import providersFile from '@/data/camps/providers.json';
import type { Provider } from './contract';
import {
  EXTRACTION_FINGERPRINT,
  SOURCE_HASH_VERSION,
  buildSourceBundle,
  extractProvider,
  type BundleLogEntry,
  type SavedExtraction,
} from './extract';
import { syncCampEvents } from './feedEvents';
import { createPageTextFetcher } from './fetchPageText';
import { importCamps, type ImportSummary } from './importCamps';
import { isSocialUrl } from './platforms';

/** A little under a week and a day, so a daily run at the same hour never misses by minutes. */
const CHECK_EVERY_HOURS = 7 * 24 - 4;
const HOT_CHECK_EVERY_HOURS = 20;
const OPENING_WINDOW_DAYS = 3;
const CONCURRENCY = 6;
// Up to 8 pages, each with its own fetch timeouts and retries
const READ_TIMEOUT_MS = 120_000;
// Sol with web search took up to 183s on one attempt (bulk extraction, 2026-10-29)
const EXTRACT_TIMEOUT_MS = 300_000;
// Gone, the same answer from anywhere: the bundle just lacks the page, and its hash says so
const GONE_ATTEMPT = /^[a-z-]+: (?:HTTP 404|HTTP 410|soft 404)/;

/** Hints and the WebTrac flag aren't stored in the database. */
type ListedProvider = Pick<Provider, 'key' | 'hint' | 'webtrac' | 'status' | 'status_reason'>;
const listedJson = providersFile as unknown as ListedProvider[] | { providers: ListedProvider[] };
const LISTED = new Map(
  (Array.isArray(listedJson) ? listedJson : listedJson.providers).map((p) => [p.key, p])
);

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
}

export interface RefreshResult {
  /** Providers the refresh looks after. */
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

export async function dueProviders(
  only?: string[]
): Promise<{ eligible: RefreshRow[]; due: RefreshCandidate[] }> {
  const today = getTodayStringEastern();
  const rows = await db
    .select(refreshColumns)
    .from(campProviders)
    .where(and(eq(campProviders.hidden, false), isNotNull(campProviders.extractionFingerprint)));
  // A provider known only by social pages has nothing we can read (login walls)
  const eligible = rows.filter(
    (row) =>
      !row.extractionFingerprint?.startsWith('webtrac:') &&
      !LISTED.get(row.key)?.webtrac &&
      row.urls.some((url) => !isSocialUrl(url))
  );
  const openingNear = await providersWithOpeningNear(today);
  const january = today.slice(5, 7) === '01';

  const candidates = eligible.map((row) => ({
    row,
    hot: january || openingNear.has(row.key),
    openingNear: openingNear.has(row.key),
  }));
  if (only) return { eligible, due: candidates.filter((c) => only.includes(c.row.key)) };

  const now = Date.now();
  const due = candidates
    .filter((c) => {
      const every = c.hot ? HOT_CHECK_EVERY_HOURS : CHECK_EVERY_HOURS;
      return now - lastChecked(c.row) >= every * 3_600_000;
    })
    .sort(
      (a, b) =>
        Number(a.row.checkError !== null) - Number(b.row.checkError !== null) ||
        Number(b.openingNear) - Number(a.openingNear) ||
        lastChecked(a.row) - lastChecked(b.row)
    );
  return { eligible, due };
}

/** Rejects if `promise` hasn't settled within `ms`. The work itself can't be cancelled. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One of the provider's own pages that failed for a reason that may not hold next time. */
function unreadableKnownPage(provider: Provider, entry: BundleLogEntry): boolean {
  if (!entry.error || !provider.urls.includes(entry.url) || isSocialUrl(entry.url)) return false;
  return !entry.error.split('; ').every((attempt) => GONE_ATTEMPT.test(attempt));
}

async function markChecked(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .update(campProviders)
    .set({ checkedAt: new Date(), checkError: null })
    .where(inArray(campProviders.key, keys));
}

async function adoptSourceHash(key: string, sourceHash: string): Promise<void> {
  await db.update(campProviders).set({ sourceHash }).where(eq(campProviders.key, key));
}

async function markFailed(key: string, reason: string): Promise<void> {
  await db
    .update(campProviders)
    .set({ checkError: reason.slice(0, 2000) })
    .where(eq(campProviders.key, key));
}

/** The provider's program names as extracted, so Sol keeps them and the camp keys don't drift. */
async function programNames(providerKey: string): Promise<string[]> {
  const rows = await db
    .select({ name: sql<string>`${camps.card}->>'name'` })
    .from(camps)
    .where(eq(camps.providerKey, providerKey))
    .orderBy(camps.firstSeenAt);
  return rows.map((row) => row.name);
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
  // One fetcher per provider: closing it stops a read that timed out, and no page outlives its
  // provider in memory. No disk cache: a refresh must read the pages as they are now.
  const fetcher = createPageTextFetcher({ cacheTtlMs: 0, browser: options.browser });

  try {
    const bundle = await withTimeout(
      buildSourceBundle(provider, fetcher),
      READ_TIMEOUT_MS,
      'reading the pages'
    );
    pages = bundle.pages.length;
    const unreadable = bundle.log.filter((entry) => unreadableKnownPage(provider, entry));
    if (pages === 0 || unreadable.length > 0) {
      const detail = (unreadable.length > 0 ? unreadable : bundle.log)
        .map((entry) => `${entry.url}: ${entry.error}`)
        .join(' | ');
      throw new Error(
        `${pages === 0 ? 'no page could be read' : 'a known page could not be read'}: ${detail}`
      );
    }

    // Every extraction so far was made on Oct 28-29, 2026, before hashes ignored repeated
    // boilerplate: take the first new-style hash as the baseline instead of re-extracting.
    let storedHash = row.sourceHash;
    if (storedHash && !storedHash.startsWith(SOURCE_HASH_VERSION) && bundle.sourceHash) {
      if (options.apply) await adoptSourceHash(row.key, bundle.sourceHash);
      storedHash = bundle.sourceHash;
    }
    const reasons = [
      bundle.sourceHash !== storedHash && 'pages changed',
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

    // The fetcher remembers the pages, so the extraction's bundle is the one just hashed
    const run = await withTimeout(
      extractProvider(provider, today, { fetcher, existingPrograms: await programNames(row.key) }),
      EXTRACT_TIMEOUT_MS,
      'extraction'
    );
    const saved: SavedExtraction = {
      provider,
      extractedAt: new Date().toISOString(),
      fingerprint: EXTRACTION_FINGERPRINT,
      sourceHash: run.sourceHash,
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

export async function refreshCamps(options: RefreshOptions): Promise<RefreshResult> {
  const { eligible, due } = await dueProviders(options.only);
  const queue = due.slice(0, options.limit ?? due.length);
  const { outcomes, extractions } = await checkProviders(queue, options);

  let imported: ImportSummary | null = null;
  let feedEvents: RefreshResult['feedEvents'] = null;
  if (options.apply) {
    if (extractions.length > 0) {
      imported = await importCamps({
        source: `${extractions.length} re-extracted providers`,
        providers: extractions.map((saved) => saved.provider),
        extractions,
        geocodeCache: {},
        apply: true,
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
    due: due.length,
    checked: outcomes.length,
    unchanged: count('unchanged'),
    changed: count('changed'),
    reExtracted: count('re-extracted'),
    deferred: count('deferred'),
    failed: count('failed'),
    notStarted: due.length - outcomes.length,
    imported,
    feedEvents,
    outcomes,
  };
}
