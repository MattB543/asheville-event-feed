/**
 * News ingest (docs/news/05-v1-plan.md §6.1): run every source module, upsert
 * what comes back into news_articles keyed on the publisher URL, then fetch
 * full text for bodiless articles until the deadline.
 *
 * Ingest owns the outlet's own fields (title, dek, body, image, engagement)
 * and never touches the AI columns or `state`; lib/news/pipeline.ts owns
 * those. A changed title, dek or body changes `input_hash`, which is what
 * tells the AI pipeline to re-enrich.
 */

import { and, asc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { newsArticles, newsSources } from '@/lib/db/schema';
import { chunk, formatDuration } from '@/lib/utils/cron';
import { articleInputHash, articleInputHashSql, disabledDomains, type FulltextStatus } from './db';
import { articleIdentity, hostDomain, moduleDomain, type ArticleIdentity } from './identity';
import { NEWS_SOURCES } from './registry';
import type { NewsSourceModule, ScrapedArticle } from './types';

/** Modules get the first 120s of the run to list their articles. */
const SCRAPE_BUDGET_MS = 120_000;
/** A module still running this long after its deadline is abandoned. */
const SCRAPE_GRACE_MS = 10_000;
/** Overall budget when the caller gives no deadline (the route uses start + 270s). */
const DEFAULT_RUN_MS = 270_000;

const FULLTEXT_CONCURRENCY = 4;
const FULLTEXT_TIMEOUT_MS = 15_000;
/** A row that has failed this many times is left alone. */
const FULLTEXT_MAX_ATTEMPTS = 3;
/** Pause between two fetches to the same host. */
const FULLTEXT_HOST_GAP_MS = 1_000;

const UPSERT_BATCH = 100;

/** Same shape as the events scrape's `scrapers[]`, so scripts/check-cron-health.ts reads both. */
export interface NewsScraperStat {
  name: string;
  ok: boolean;
  events: number;
  ms: number;
  error?: string;
}

export interface NewsIngestResult {
  scraped: number;
  inserted: number;
  updated: number;
  /** Updated rows whose title, dek or body changed (so input_hash did). */
  textChanged: number;
  /** Items from a domain whose takedown switch is off. */
  droppedDisabled: number;
  /** Items with no title, an unparseable date or a non-http URL. */
  droppedInvalid: number;
  insertedBySource: Record<string, number>;
  fulltext: { fetched: number; unavailable: number; failed: number; backlog: number };
  scrapers: NewsScraperStat[];
  /** localOnly modules skipped because this isn't a local run. */
  skippedSources: string[];
  /** Modules whose own domain is disabled. */
  disabledSources: string[];
  failures: { upsert: number; scrapers: number };
  msByStep: { scrape: number; upsert: number; fulltext: number };
  /** The deadline stopped the upsert before every row was written; the next run picks them up. */
  hitDeadline: boolean;
}

type NewArticle = typeof newsArticles.$inferInsert;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error
    ? `${error.message}, cause=${error.cause.message}`
    : error.message;
}

/** Rejects if `promise` hasn't settled within `ms`. The work itself can't be cancelled. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${formatDuration(ms)}`)),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Trimmed text with NULs removed (Postgres rejects them), or null when empty. */
function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\u0000/g, '').trim();
  return text ? text : null;
}

/**
 * Upsert one row per module domain. When modules share a domain (a council
 * agenda module filed under its government's), the row takes its name, kind
 * and homepage from the module whose homepage is on that domain, i.e. one
 * without a `domain` override, else from the first listed. `enabled` is never
 * written: re-enabling is scripts/news/takedown.ts's job.
 */
async function seedSources(): Promise<void> {
  const owners = new Map<string, NewsSourceModule>();
  for (const m of NEWS_SOURCES) {
    const domain = moduleDomain(m);
    const owner = owners.get(domain);
    if (!owner || (hostDomain(owner.homepage) !== domain && hostDomain(m.homepage) === domain))
      owners.set(domain, m);
  }
  await db
    .insert(newsSources)
    .values(
      [...owners].map(([domain, m]) => ({
        domain,
        name: m.name,
        kind: m.kind,
        homepage: m.homepage,
      }))
    )
    .onConflictDoUpdate({
      target: newsSources.domain,
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        homepage: sql`excluded.homepage`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`(${newsSources.name}, ${newsSources.kind}, ${newsSources.homepage}) IS DISTINCT FROM (excluded.name, excluded.kind, excluded.homepage)`,
    });
}

interface ModuleOutcome {
  module: NewsSourceModule;
  items: ScrapedArticle[];
  stat: NewsScraperStat;
}

async function runModule(module: NewsSourceModule, deadline: number): Promise<ModuleOutcome> {
  const start = Date.now();
  try {
    const items = await withTimeout(
      module.scrape({ deadline }),
      Math.max(0, deadline + SCRAPE_GRACE_MS - start),
      module.name
    );
    if (!Array.isArray(items)) throw new Error('scrape() did not return an array');
    return {
      module,
      items,
      stat: { name: module.name, ok: true, events: items.length, ms: Date.now() - start },
    };
  } catch (error) {
    return {
      module,
      items: [],
      stat: {
        name: module.name,
        ok: false,
        events: 0,
        ms: Date.now() - start,
        error: formatError(error).slice(0, 200),
      },
    };
  }
}

/** The insert row for one scraped item, or undefined if the item is unusable. */
function toArticle(
  module: NewsSourceModule,
  item: ScrapedArticle,
  now: Date
): NewArticle | undefined {
  const title = clean(item.title);
  const publishedAt = item.publishedAt;
  if (!title || !(publishedAt instanceof Date) || isNaN(publishedAt.getTime())) return undefined;

  let identity: ArticleIdentity;
  try {
    identity = articleIdentity(module, item);
    if (!/^https?:$/.test(new URL(identity.url).protocol)) return undefined;
  } catch {
    return undefined;
  }

  const dek = clean(item.summary);
  const contentText = clean(item.contentText);
  const paywalled = item.paywalled ?? false;
  const fulltextStatus: FulltextStatus =
    !contentText && module.fetchFullText && !paywalled ? 'pending' : 'none_needed';

  return {
    url: identity.url,
    source: module.key,
    sourceId: clean(item.sourceId) ?? identity.url,
    outletDomain: identity.outletDomain,
    outletName: identity.outletName,
    kind: identity.kind,
    title,
    dek,
    contentText,
    author: clean(item.author),
    imageUrl: clean(item.imageUrl),
    linkedUrl: clean(item.linkedUrl),
    categories: (item.categories ?? []).flatMap((c) => clean(c) ?? []),
    engagement: item.engagement ?? null,
    paywalled,
    publishedAt,
    firstSeenAt: now,
    lastSeenAt: now,
    fulltextStatus,
    inputHash: articleInputHash(title, dek, contentText),
  };
}

const t = newsArticles;
// Text fields only follow the module that first inserted the row, so a second
// module carrying the same URL (an aggregator) can't flip-flop them.
const sameSource = sql`excluded.source = ${t.source}`;
const mergedTitle = sql`CASE WHEN ${sameSource} THEN excluded.title ELSE ${t.title} END`;
const mergedDek = sql`CASE WHEN ${sameSource} AND excluded.dek IS NOT NULL THEN excluded.dek ELSE ${t.dek} END`;
const mergedContent = sql`CASE WHEN ${sameSource} AND excluded.content_text IS NOT NULL THEN excluded.content_text ELSE ${t.contentText} END`;
const mergedHash = articleInputHashSql(mergedTitle, mergedDek, mergedContent);

/**
 * Insert new articles; on an existing URL refresh last_seen_at and engagement,
 * take a changed title/dek/body, and fill fields that are still empty.
 * Returns each row's url and resulting input_hash.
 */
async function upsertArticles(rows: NewArticle[]): Promise<{ url: string; inputHash: string }[]> {
  return db
    .insert(newsArticles)
    .values(rows)
    .onConflictDoUpdate({
      target: newsArticles.url,
      set: {
        title: mergedTitle,
        dek: mergedDek,
        contentText: mergedContent,
        inputHash: mergedHash,
        // A body that arrives in the feed settles a pending fetch.
        fulltextStatus: sql`CASE WHEN ${sameSource} AND excluded.content_text IS NOT NULL AND ${t.fulltextStatus} IN ('pending', 'failed') THEN 'none_needed' ELSE ${t.fulltextStatus} END`,
        author: sql`COALESCE(${t.author}, excluded.author)`,
        imageUrl: sql`COALESCE(${t.imageUrl}, excluded.image_url)`,
        linkedUrl: sql`COALESCE(${t.linkedUrl}, excluded.linked_url)`,
        categories: sql`CASE WHEN cardinality(${t.categories}) = 0 THEN excluded.categories ELSE ${t.categories} END`,
        paywalled: sql`${t.paywalled} OR excluded.paywalled`,
        engagement: sql`COALESCE(excluded.engagement, ${t.engagement})`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: sql`CASE WHEN ${mergedHash} IS DISTINCT FROM ${t.inputHash} THEN now() ELSE ${t.updatedAt} END`,
      },
    })
    .returning({ url: newsArticles.url, inputHash: newsArticles.inputHash });
}

interface FulltextRow {
  id: string;
  url: string;
  source: string;
}

/**
 * Fetch bodies for rows still waiting on one: `pending`, or `failed` fewer
 * than 3 times. Oldest first, 4 at a time with at most one per host, each
 * capped at 15s, and nothing starts after the deadline.
 */
async function fetchFullTexts(
  modules: NewsSourceModule[],
  disabled: Set<string>,
  deadline: number
): Promise<NewsIngestResult['fulltext']> {
  const stats = { fetched: 0, unavailable: 0, failed: 0, backlog: 0 };
  const byKey = new Map(
    modules.filter((m) => m.fetchFullText !== undefined).map((m) => [m.key, m])
  );
  if (byKey.size === 0) return stats;

  const rows: FulltextRow[] = await db
    .select({ id: t.id, url: t.url, source: t.source })
    .from(t)
    .where(
      and(
        inArray(t.source, [...byKey.keys()]),
        eq(t.paywalled, false),
        or(
          eq(t.fulltextStatus, 'pending'),
          and(eq(t.fulltextStatus, 'failed'), lt(t.fulltextAttempts, FULLTEXT_MAX_ATTEMPTS))
        ),
        disabled.size > 0 ? notInArray(t.outletDomain, [...disabled]) : undefined
      )
    )
    .orderBy(asc(t.firstSeenAt), asc(t.id));

  // One queue per host; a worker drains a whole host before claiming the next,
  // which is what keeps it to one request per host at a time.
  const byHost = new Map<string, FulltextRow[]>();
  for (const row of rows) {
    const host = hostDomain(row.url);
    byHost.set(host, [...(byHost.get(host) ?? []), row]);
  }
  const hosts = [...byHost.keys()];
  let attempted = 0;

  const fetchOne = async (row: FulltextRow) => {
    const source = byKey.get(row.source)!;
    attempted++;
    try {
      const result = await withTimeout(
        source.fetchFullText!(row.url),
        Math.min(FULLTEXT_TIMEOUT_MS, deadline - Date.now()),
        `${source.name} full text`
      );
      const text = clean(typeof result === 'string' ? result : result?.text);
      if (!text) {
        // Terminal: the page has no body.
        await db
          .update(t)
          .set({
            fulltextStatus: 'unavailable',
            fulltextAttempts: sql`${t.fulltextAttempts} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(t.id, row.id));
        stats.unavailable++;
        return;
      }
      const imageUrl = typeof result === 'object' ? clean(result.imageUrl) : null;
      await db
        .update(t)
        .set({
          contentText: text,
          inputHash: articleInputHashSql(t.title, t.dek, text),
          imageUrl: sql`COALESCE(${t.imageUrl}, ${imageUrl}::text)`,
          fulltextStatus: 'fetched',
          fulltextAttempts: sql`${t.fulltextAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(t.id, row.id));
      stats.fetched++;
    } catch (error) {
      // Transient: retried by later runs until FULLTEXT_MAX_ATTEMPTS.
      stats.failed++;
      console.warn(`[NewsScrape] Full text failed for ${row.url}: ${formatError(error)}`);
      await db
        .update(t)
        .set({
          fulltextStatus: 'failed',
          fulltextAttempts: sql`${t.fulltextAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(t.id, row.id))
        .catch((err) =>
          console.error(`[NewsScrape] Could not record the failure: ${formatError(err)}`)
        );
    }
  };

  const worker = async () => {
    while (hosts.length > 0) {
      const queue = byHost.get(hosts.shift()!)!;
      for (let i = 0; i < queue.length; i++) {
        // Leave at least a second for the fetch itself.
        if (deadline - Date.now() < 1_000) return;
        if (i > 0) await sleep(FULLTEXT_HOST_GAP_MS);
        await fetchOne(queue[i]);
      }
    }
  };
  await Promise.all(Array.from({ length: FULLTEXT_CONCURRENCY }, worker));

  stats.backlog = rows.length - attempted;
  return stats;
}

/**
 * One ingest run. `includeLocalOnly` runs the modules marked localOnly (the
 * route passes isLocalScrapeRuntime()). `deadline` is absolute epoch ms;
 * modules get until min(start + 120s, deadline) and full text stops at it.
 * A module that fails is recorded in `scrapers` and the run carries on;
 * database errors throw.
 */
export async function runNewsIngest(opts: {
  includeLocalOnly: boolean;
  deadline?: number;
}): Promise<NewsIngestResult> {
  const start = Date.now();
  const deadline = opts.deadline ?? start + DEFAULT_RUN_MS;
  const scrapeDeadline = Math.min(start + SCRAPE_BUDGET_MS, deadline);

  await seedSources();
  const disabled = await disabledDomains();

  const skippedSources: string[] = [];
  const disabledSources: string[] = [];
  const modules = NEWS_SOURCES.filter((m) => {
    if (m.localOnly && !opts.includeLocalOnly) skippedSources.push(m.name);
    else if (disabled.has(moduleDomain(m))) disabledSources.push(m.name);
    else return true;
    return false;
  });
  if (skippedSources.length > 0) {
    console.log(`[NewsScrape] Skipping local-only source(s): ${skippedSources.join(', ')}`);
  }
  if (disabledSources.length > 0) {
    console.log(`[NewsScrape] Skipping disabled source(s): ${disabledSources.join(', ')}`);
  }

  // 1. Scrape every module in parallel.
  console.log(`[NewsScrape] Scraping ${modules.length} sources...`);
  const outcomes = await Promise.all(modules.map((m) => runModule(m, scrapeDeadline)));
  const scrapeMs = Date.now() - start;
  for (const { stat } of outcomes) {
    const line = stat.ok
      ? `${stat.events} items (${formatDuration(stat.ms)})`
      : `FAILED (${formatDuration(stat.ms)}) - ${stat.error}`;
    console.log(`[NewsScrape]   ${stat.name}: ${line}`);
  }

  // 2. Identify, drop disabled domains, and keep one row per URL. A module's
  // own item beats an aggregator's copy of the same URL.
  const now = new Date();
  const byUrl = new Map<string, { row: NewArticle; viaAggregator: boolean }>();
  const publishers = new Map<string, typeof newsSources.$inferInsert>();
  let droppedDisabled = 0;
  let droppedInvalid = 0;
  for (const { module, items } of outcomes) {
    for (const item of items) {
      const row = toArticle(module, item, now);
      if (!row) {
        droppedInvalid++;
        continue;
      }
      if (disabled.has(row.outletDomain)) {
        droppedDisabled++;
        continue;
      }
      const viaAggregator = !!item.publisher;
      const seen = byUrl.get(row.url);
      if (!seen || (seen.viaAggregator && !viaAggregator))
        byUrl.set(row.url, { row, viaAggregator });
      // Google sometimes names a publisher by its bare domain; a real name wins.
      if (
        viaAggregator &&
        (publishers.get(row.outletDomain)?.name ?? row.outletDomain) === row.outletDomain
      ) {
        publishers.set(row.outletDomain, {
          domain: row.outletDomain,
          name: row.outletName,
          kind: 'outlet',
          homepage: new URL(row.url).origin,
        });
      }
    }
  }

  // 3. Upsert. Aggregator publishers get a news_sources row on first sight;
  // an existing row (a module's own, or a disabled one) is left alone, apart
  // from a row still named by its bare domain taking a real name.
  const upsertStart = Date.now();
  if (publishers.size > 0) {
    await db
      .insert(newsSources)
      .values([...publishers.values()])
      .onConflictDoUpdate({
        target: newsSources.domain,
        set: { name: sql`excluded.name`, updatedAt: sql`now()` },
        setWhere: sql`${newsSources.name} = ${newsSources.domain} AND excluded.name <> excluded.domain`,
      });
  }

  const rows = [...byUrl.values()].map((v) => v.row);
  let inserted = 0;
  let updated = 0;
  let textChanged = 0;
  let upsertFailed = 0;
  let hitDeadline = false;
  const insertedBySource: Record<string, number> = {};
  const sourceByUrl = new Map(rows.map((r) => [r.url, r.source]));

  const tally = (before: Map<string, string>, after: { url: string; inputHash: string }[]) => {
    for (const { url, inputHash } of after) {
      const oldHash = before.get(url);
      if (oldHash === undefined) {
        inserted++;
        const source = sourceByUrl.get(url)!;
        insertedBySource[source] = (insertedBySource[source] ?? 0) + 1;
      } else {
        updated++;
        if (oldHash !== inputHash) textChanged++;
      }
    }
  };

  for (const batch of chunk(rows, UPSERT_BATCH)) {
    if (Date.now() >= deadline) {
      hitDeadline = true;
      break;
    }
    // input_hash before the upsert: tells inserts from updates, and which
    // updates changed the text.
    const before = new Map(
      (
        await db
          .select({ url: t.url, inputHash: t.inputHash })
          .from(t)
          .where(
            inArray(
              t.url,
              batch.map((r) => r.url)
            )
          )
      ).map((r) => [r.url, r.inputHash])
    );
    try {
      tally(before, await upsertArticles(batch));
    } catch (error) {
      // Retry row by row so one bad item can't sink the other 99.
      console.error(
        `[NewsScrape] Batch upsert failed, retrying rows singly: ${formatError(error)}`
      );
      for (const row of batch) {
        if (Date.now() >= deadline) {
          hitDeadline = true;
          break;
        }
        try {
          tally(before, await upsertArticles([row]));
        } catch (rowError) {
          upsertFailed++;
          console.error(
            `[NewsScrape] Upsert failed: "${row.title}" (${row.source}, ${row.url}): ${formatError(rowError)}`
          );
        }
      }
    }
  }
  const upsertMs = Date.now() - upsertStart;
  console.log(
    `[NewsScrape] Upserted ${rows.length} articles in ${formatDuration(upsertMs)}: ${inserted} new, ${updated} updated (${textChanged} text changed), ${upsertFailed} failed; dropped ${droppedDisabled} disabled, ${droppedInvalid} invalid${hitDeadline ? '; stopped at the deadline' : ''}`
  );

  // 4. Full text, until the deadline.
  const fulltextStart = Date.now();
  const fulltext = await fetchFullTexts(modules, disabled, deadline);
  const fulltextMs = Date.now() - fulltextStart;
  console.log(
    `[NewsScrape] Full text in ${formatDuration(fulltextMs)}: ${fulltext.fetched} fetched, ${fulltext.unavailable} unavailable, ${fulltext.failed} failed, ${fulltext.backlog} left for the next run`
  );

  const scrapers = outcomes.map((o) => o.stat);
  return {
    scraped: scrapers.reduce((n, s) => n + s.events, 0),
    inserted,
    updated,
    textChanged,
    droppedDisabled,
    droppedInvalid,
    insertedBySource,
    fulltext,
    scrapers,
    skippedSources,
    disabledSources,
    failures: { upsert: upsertFailed, scrapers: scrapers.filter((s) => !s.ok).length },
    msByStep: { scrape: scrapeMs, upsert: upsertMs, fulltext: fulltextMs },
    hitDeadline,
  };
}
