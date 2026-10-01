# 01: How the AVL GO event pipeline works (grounding for the news pipeline)

Written 2026-09-24. Everything below comes from reading the code on `main` and
running read-only SELECTs against prod. Line numbers are `file:line`. Cron times
are UTC.

## TL;DR

- **Four crons plus one table.** `scrape` (every 6h) → `ai` (every 3h) → `cleanup` (8x/day) →
  AI `dedup` (daily), all writing the single `events` table. Every run records one row in
  `cron_job_runs`, which is the only durable log.
- **Deletes are soft (in principle).** Duplicates get `deduped_at` and dead URLs get `dead_at`.
  Losers are merged into the winner first. The codebase breaks this rule in several places
  (see "Surprises").
- **Enrichment works well.** One Azure call (the `AZURE_OPENAI_DEPLOYMENT` deployment, `gpt-6-luna` since 09-25) writes tags and a summary, Gemini
  builds a 1536-d embedding, and a second Azure call writes a five-dimension score using
  "similar events" from pgvector as context. In the 3-month window, 100% of live events have
  all four. Per-row backoff columns keep the queue from getting stuck.
- **Users never search by embedding.** Feed search is `ILIKE`. Chat pulls up to 500 events for
  a date range and puts them all in the prompt. Embeddings are used only for scoring context,
  "similar events", personalization, and poster matching.
- **The biggest risk to copy is the time budget.** The scrape takes 490s on average (577s max)
  against Vercel's 800s limit. One slow source sets the pace: Theater Alliance re-fetches
  every detail page on every run (453s on average).

---

## 1. Architecture

```
 vercel.json (UTC)                                      Local only: scripts/run-full-cron-local.ts
 ───────────────────────────────────────────────        (MountainX, NC Stage, Facebook; gated by
 :00 every 6h  /api/cron/scrape   maxDuration 800        isLocalScrapeRuntime() = !process.env.VERCEL)
   SCRAPERS[] ──run in parallel, each timed──► ScrapedEvent[]   (scrapers apply the NC filter themselves)
   INSERT … ON CONFLICT(url) DO UPDATE  (chunks of 10; xmax=0 ⇒ inserted)
   rule dedup A–E over every live row ─► mergeFields ─► SET deduped_at
   revalidateTag('events') ─► cron_job_runs.result {inserted, updated, scrapers[], skippedSources}
 :05 every 3h  /api/cron/verify   Jina Reader ─► Azure: fill desc/price, hide cancelled (conf ≥ 0.8), 30 per run
 :20 every 3h  /api/cron/ai       1 tags+summary (Azure, 100) ─► 2 embedding (Gemini, 100)
                                  ─► 3 score (Azure + 20 pgvector neighbours, 50) ─► Top 30 emails ─► placeholder image
 :30 8x/day    /api/cron/cleanup  dead URL (HEAD, then Chrome re-probe) ─► non-NC ─► "CANCELLED" ─► rule dedup (1 txn per group)
 08:00 daily   /api/cron/dedup    Azure: one prompt per day, score ≥ 15, next 31 days ─► SET deduped_at
                         │
                         ▼   events (Postgres + pgvector 0.8.0, HNSW cosine)
 /events  /events/top30  /events/your-list   SSR with unstable_cache(tags:['events'], 1h)
 /api/events (cursor pagination)  /api/events/top30 (200-deep pool)  /events/[slug] (ISR 1h + similar events)
 EventFeed (client filters, score tiers, Top 30 multi-day collapse)   /api/chat (date range ─► 500 events in the prompt)
```

### 1.1 Scraping

- **Registry and gating.** The `SCRAPERS` registry is at `app/api/cron/scrape/route.ts:63-95`.
  Each entry is `{name, fn, stripTags?, localOnly?}`. Line 150-157 splits it into active and
  `skippedSources` using `isLocalScrapeRuntime()` (`lib/config/env.ts:160-162`). Facebook has its
  own gate, `isFacebookEnabled()` (`env.ts:140-153`), and its own interest threshold (≥4 going or
  ≥9 interested, `route.ts:260-264`).
- **Execution.** All sources run at once. Each one is wrapped so a failure becomes
  `{status:'rejected'}` instead of throwing (`route.ts:162-183`). Per-scraper stats
  `{name, ok, events, ms, error≤200 chars}` go into the run record (`:194-241`).
- **Upsert.** One `INSERT … ON CONFLICT (url)` per row, 10 at a time (`:298-373`). On conflict:
  - The longer description wins (`:333`).
  - `location`, `zip`, `organizer` and `imageUrl` only change when the new value is non-empty
    (`COALESCE(NULLIF(trim(new),''), old)`).
  - A null or `Unknown` price never overwrites a real one (`:339`).
  - `tags` are never touched (AI owns them), and `lastSeenAt` is bumped.
  - `RETURNING (xmax = 0)` tells an insert from an update at no extra cost (`:347-349`).
  - `updatedAt` is never bumped, so it is not a signal that anything changed.
- **AVL Today** (`lib/scrapers/avltoday.ts`) is the API-style scraper. It POSTs to CitySpark and
  pages by `skip` with a safety cap of 400 (`:87-144`). `StartUTC` is a real instant. Naive
  Eastern strings go through `parseAsEastern` (`:184-206`); plain `new Date()` would be 4-5h off
  on UTC hosts. It falls back through several ways to find a zip or organizer, then drops non-NC
  events (`:147`).
- **Grey Eagle** (`lib/scrapers/greyeagle.ts`) is the HTML-style scraper. It reads the calendar
  page, regex-extracts event URLs, then fetches each page one at a time with 150ms gaps
  (`:187-198`). It reads JSON-LD through `findJsonLdEvent` (`lib/scrapers/jsonld.ts`, which scans
  every block including `@graph`), takes the description from meta tags
  (`base.ts:41-68`), and the price from context regexes.
- **RHP venues** (`lib/scrapers/rhp.ts`) show how one module can serve many sites through config.
  It also has a circuit breaker: if more than 25% of cards fail to parse (and at least 5 do), the
  whole venue fails (`:41-46`). Its header documents WordPress pagination traps (`:14-26`).
- **Shared HTTP.**
  - `fetchEventData` in `lib/scrapers/base.ts:17-35` wraps `fetchWithRetry` with browser headers.
    `lib/utils/retry.ts` provides exponential backoff with jitter and a 15s per-attempt timeout.
  - `lib/scrapers/fetchAsChrome.ts` is an undici Agent with `allowH2` and Chrome's cipher order
    (`:48-51`). It makes 4 spaced attempts and treats a "Just a moment" page title as a failure
    (`:59-96`). `probeAsChrome` makes a single status-only attempt and returns 0 for "unknown"
    (`:106-124`).

### 1.2 Cleaning

- **Location filter.** `isNonNCEvent` (`lib/utils/geo.ts:452-482`) trusts an explicit NC location
  first, then a non-NC state or city in the location, then patterns like `, SC` / `in Atlanta` in
  the title. Scrapers run it themselves (8 call sites), and cleanup Phase 2 runs it again
  (`cleanup/route.ts:307-319`).
- **Rule-based dedup** (`lib/utils/deduplication.ts`) groups rows by Eastern date, then by time
  and by venue. It runs methods A-E (`:611-657`). Every method depends on same start time,
  same venue, or same day.
  - Winner (`chooseEventToKeep`, `:332-358`): a POSTER row never wins, then a known price wins,
    then the longer description, then the newer row.
  - `mergeFields` (`:408-460`): the longest description, gap-fill only for
    price/image/location/organizer/zip, the maximum engagement counts, and losers visited in id
    order so the result is deterministic.
  - The scrape job applies field updates and then soft-deletes (`route.ts:449-485`), not in a
    transaction. Cleanup does both in one transaction per group (`cleanup/route.ts:477-504`).
  - The dedup input excludes rows that are deduped, dead, `dedup_skip`, or hidden
    (`route.ts:414-423`).
- **Cleanup cron** (`app/api/cron/cleanup/route.ts`):
  - It checks only rows with `lastSeenAt` older than 24h, within a 0-7 or 8-14 day window that
    depends on the hour (`:25-34`, `:121-140`). That keeps it to roughly 56 candidates per run
    instead of 844.
  - Only 404/410 counts as dead (`:45`). Each one is re-probed as Chrome (`:180-187`).
  - If more than 20% of a source's checked rows look dead (at least 5 checked), the whole source
    is skipped (`:237-251`).
  - Removal is a soft delete with a restore statement printed to the log (`:255-276`).
  - Phases 2 (non-NC) and 3 (title starts with CANCELLED) **hard-delete** (`:332-345`,
    `:374-387`).
- **Verify cron** (`app/api/cron/verify/route.ts`) takes up to 30 future events from
  AVL_TODAY / EXPLORE_ASHEVILLE / MOUNTAIN_X. They must never have been verified and must be
  missing a description or price. Sorted by `startDate` (`:83-118`). Jina Reader turns each
  page into markdown (`lib/ai/eventVerification.ts:189-240`), then Azure decides
  keep/hide/update, and only confidence ≥0.8 is applied (`:69-80`). `lastVerifiedAt` is left
  unset when the fetch fails (`verify/route.ts:270`).
- **AI dedup.** The cron is `app/api/cron/dedup/route.ts`; the logic is
  `lib/ai/aiDeduplication.ts`.
  - Scope: only score ≥15 over the next 31 days (`route.ts:65-116`). This makes each day's list
    about 4x shorter, which saves tokens and improves accuracy.
  - It sends one prompt per day with small integer ids instead of UUIDs (`:93-116`), maps them
    back, and drops invalid indices (`:218-250`).
  - `enforceNonPosterKeeper` (`:285-326`) protects official listings.
  - It re-checks `hidden` at write time (`route.ts:169-174`).
  - **Known gap:** the prompt returns only rows to remove, with no keeper, so nothing gets merged.

### 1.3 Enrichment (`app/api/cron/ai/route.ts`)

| Pass | Selection | Per run | Model / client | Failure handling |
|---|---|---|---|---|
| Tags + summary | tags empty OR summary null; start in next 3 months; `ai_next_attempt_at` null or due; `ORDER BY ai_attempts, start_date` (`:132-160`) | 100, 5 concurrent, 1s gap | Azure JSON mode (deployment `gpt-6-luna` since 09-25), `lib/ai/tagAndSummarize.ts` (description cut to 500 chars, `maxTokens` 20000) | `transient` / `permanent` classes (`tagAndSummarize.ts:31-63`) set a backoff: 5m/30m/2h or 6h/24h/7d (`route.ts:45-51`). A partial result is saved but still counts as a failure (`:237-251`). |
| Embedding | summary not null, embedding null, next 3 months (`:293-310`) | 100, 10 concurrent | Gemini `gemini-embedding-001` at 1536-d, `lib/ai/embedding.ts`. Text is `title - summary - tags - organizer` (`:96-116`). | 30s timeout. **Aborted calls are never retried because they may still be billed** (`:27-36`). |
| Score | any of 7 score columns null, embedding present (`:359-397`) | 50, one at a time, 0.5s gap | Azure, `lib/ai/scoring.ts`. Five dimensions: rarity/unique/magnitude 0-10 each (total 0-30), plus weird and social 1-10. Context is 20 neighbours from `findSimilarEvents` with their dates, so the model can infer how often an event recurs. | Daily or weekly recurring events get a fixed 5/30 with no LLM call (`:408-443`, `lib/ai/recurringDetection.ts`). Parse or content-filter failures get a fallback 5/30 (`:485-523`). Values are clamped (`scoring.ts:223-234`), and only null columns are written (`:349-382`). |
| Images | null image or a known placeholder | 500 | none | Batch-sets `/asheville-default.jpg`; `hasRealEventImage` (`lib/utils/eventImages.ts`) treats it as "no image". |

- **Clients** (`lib/ai/provider-clients.ts`):
  - `azureChatCompletion` (`:305-370`): 90s timeout per request, because the SDK default of
    10 minutes would eat the whole cron (`:251`). SDK retries are off so they don't stack with
    `withRetry`, and only 408/409/429/5xx are retried (`:268-274`). It returns `finishReason`,
    so a truncated reply (`length`) counts as transient.
  - `parseJsonFromModel` (`:24-84`) removes code fences, then scans for the first balanced
    JSON value that parses.
  - The Gemini clients are created on first use (`:99-164`). `getModel()` (gemini-2.5-flash) is
    no longer on the tagging path.
- **Cost controls.** Per-pass limits (100/100/50), a 3-month window, the free recurring
  shortcut (51% of scored rows), and the dedup scope rule of score ≥15. **There is no wall-clock
  deadline check.** Only the limits keep the job under 800s. In the last 7 days the max was
  262s, during a backlog drain.
- **Human overrides stay in the score.** An admin override or curator boost is folded into
  `score` when it is written, and the raw JSON stays in `score_override` for audit
  (`app/api/admin/event/score/route.ts:148-158`). Reads just `ORDER BY score`.

### 1.4 Presentation

- **Routing.** `/` is a static landing page (`app/page.tsx`). The feed lives at `/events`
  (`app/events/page.tsx`).
- **Caching.**
  - SSR loads the first 250 rows, filter metadata, and Top 30 candidates through `unstable_cache`
    with `{tags:['events'], revalidate:3600}` (`app/events/page.tsx:25-52`).
  - Every mutating cron calls `invalidateEventsCache()`, which is
    `revalidateTag('events','default')`; Next 16 requires the profile argument
    (`lib/cache/invalidation.ts`).
  - `/api/events/top30` adds `s-maxage=3600`.
- **Server filter** (`lib/db/queries/events.ts:152-580`):
  - SQL handles date, time of day, tags, and the live flags (`:174-190`).
  - Search is `ILIKE` over title, description, aiSummary, organizer, location, and tags
    (`:320-334`).
  - Spam, blocked keywords, hidden fingerprints, price, and location are filtered in JS.
    Rows are fetched 150 at a time, up to 10 rounds, until `limit+1` survive (`:472-556`).
  - Cursor format is `startDate_id`. `DbEvent` never includes the embedding (`:37-40`).
- **Client filter twin.** `lib/utils/eventFilterMatch.ts` must stay in step with the server
  (its header, `:1-15`, says so). It is used for the Top 30 pool, which is cached unfiltered for
  everyone.
- **Top 30** (`queries/events.ts:712-790`): the next 30 days, `ORDER BY score, start_date, id`.
  Ending on `id` means a 50-row query and a 200-row query agree on their shared prefix. On the
  client:
  - Multi-day repeats of one listing collapse into a single card with several dates, in a
    forward pass so ranks stay stable (`components/EventFeed.tsx:279-325`).
  - The deeper pool is appended, never swapped in, so a rank the visitor has already seen never
    moves.
- **Craft details.**
  - Score tiers: ≤14 hidden, 15-18 "quality", 19+ "outstanding" (`EventFeed.tsx:196-201`).
  - Cards show the AI summary first, with "View original" for the raw description.
    `cleanAshevilleFromSummary` strips redundant "in Asheville, NC" (`lib/utils/parsers.ts:113`).
  - All formatters are pinned to Eastern time, and "Today" is computed in Eastern.
  - An unknown time shows the date only. An unknown price shows "$ Unknown", never a guess.
  - Hide by (title, organizer) fingerprint, block a host, Google/Apple calendar, favorites
    without login, and share by slug. Filters live in localStorage, and URL params override
    them.
- **Detail page** (`app/events/[slug]/page.tsx`): ISR for 1h, OG and Twitter metadata,
  schema.org Event JSON-LD, `noindex` for hidden events, and 50 similar events from pgvector
  (`lib/events/getEvent.ts:86-117`).
- **Chat** (`app/api/chat/route.ts`):
  - The LLM extracts a date range, with Azure first and OpenRouter as fallback.
  - `queryFilteredEvents` returns up to 500 events for that range as markdown in the system
    prompt (`:308-324`), and the reply is streamed.
  - Rate limit is in memory, per instance, 1 request per 2s per IP (`:584-585`).
  - **It never uses the embeddings.**

---

## 2. What the database shows (prod, read-only, 2026-09-24)

Script: `scratchpad/news/db-audit.ts`. Raw output: `scratchpad/news/db-audit.out.txt`.

**Tables.** There are 17 public tables and all have RLS on. The `ensure_rls` event trigger is
active, so a new table starts as deny-all.

| Table | Rows | Size |
|---|---|---|
| `events` | 37,897 | 662 MB |
| `cron_job_runs` | 7,560 | 4.3 MB |
| `matching_*` (8 TEDx/vibe tables) | small | |
| `user_preferences` | 126 | |
| `newsletter_settings` | 22 | |
| `submitted_events` | 84 | |
| `poster_uploads` | 15 | |
| `poster_extractions` | 18 | |
| `curator_profiles` | 10 | |
| `curated_events` | 8 | |

Storage buckets: `event-images` (public) and `poster-uploads` (private).

**Events state.**
- 37,897 total. 35,158 are live (not deduped, dead, or hidden).
- 2,647 deduped (7.0%), 37 dead, 55 hidden, 1 `dedup_skip`.
- 33,094 are past. 3,842 are future and live.
- The first row was created 2025-11-24.

**AI coverage.**
- Live events in the next 3 months (the AI cron's window): 3,509 rows, **100%** with tags,
  summary, embedding, and score.
  - 1,788 (51%) were scored by the recurring shortcut with no LLM call.
  - 969 (28%) have score ≥15.
  - 1 fallback score, 1 row in backoff, 359 on the default image.
  - Only 4 have ever been verified.
- Across all rows, coverage is 97.2% for each field.

**pgvector.**
- Extension version 0.8.0.
- `events_embedding_idx` is HNSW with `vector_cosine_ops` and no reloptions (so the defaults
  m=16, ef_construction=64).
- **The index is 288 MB, 43% of the table.** It covers all rows, including 33k past events that
  are almost never queried.
- Other vector columns: `user_preferences.positive_centroid` and `negative_centroid`, both 1536-d.
- Other indexes: btree on `start_date`, `source`, `deduped_at`, and a partial index on
  `dead_at IS NULL`; GIN on `tags`; unique on `url`.

**cron_job_runs, last 7 days.**

| Job | Runs | OK | Avg | p50 | Max | Key result stats |
|---|---|---|---|---|---|---|
| scrape | 28 | 28 | 490s | 480s | **577s** | About 3,400 scraped per run. **11-60 inserted per run (~0.8%)**; everything else is re-confirmation. Dedup removes 0-28. `skippedSources` = MX, NC Stage, Facebook; 0 scraper failures since 9/18 (before that, MX failed on Vercel with Playwright missing) |
| ai | 56 | 56 | 55s | 33s | 262s | **Every other run has nothing to do** (AI runs every 3h, scrape every 6h). 2 tag/summary failures in 7 days. Scoring is roughly 40% recurring shortcut. |
| cleanup | 56 | 56 | 30s | 30s | 39s | 11,950 URLs checked → 8 dead; 91 dups soft-deleted; 0 non-NC; 0 cancelled |
| dedup | 7 | 7 | 57s | 54s | 69s | 31 days per run, **75-86k tokens per day**, 22 removed in total |
| verify | 56 | 56 | 5s | 5s | 10s | **0 events actually checked in 7 days** (see Surprises) |

Slowest scrapers (average): Theater Alliance 453s (max 538s), Eventbrite 177s, Grey Eagle 106s.
Every other scraper averages under 35s. `cleanupOldRuns()` exists in `lib/cron/jobTracker.ts`
but nothing calls it, so every run ever recorded is kept.

**Sources.**
- MOUNTAIN_X is the largest source by row count (10,811 total, 777 future and live). It has
  been **stale since 2026-09-18** because it is local-only.
- NC_STAGE has the same problem, last seen 9/18. FACEBOOK was last seen 9/20.

**Naming conflicts with news.**
- No table or column contains news, article, story, headline, publisher, outlet, or cluster.
- The only near-collision is `newsletter_settings`, which is for the event email newsletter. Keep
  news tables off the `newsletter` prefix to avoid confusion.
- `cron_job_runs.job_name` is free text, but the `CronJobName` union in
  `lib/cron/jobTracker.ts:5-12` and its two hard-coded job lists would need the new names.

---

## 3. Reuse for news

### As-is (import directly)

| Module | Use for news |
|---|---|
| `lib/cron/jobTracker.ts` | Start, complete, and fail runs in `cron_job_runs`. Add `'news-scrape' \| 'news-ai' \| …` to `CronJobName`. Tracker failures are already non-fatal (the `runId: null` path). |
| `lib/utils/auth.ts` `verifyAuthToken` + `CRON_SECRET` | Cron auth, with the same header convention. |
| `lib/utils/cron.ts` | `formatDuration`, `chunk`. |
| `lib/utils/retry.ts` | `withRetry` (with `shouldRetry`), `fetchWithRetry`, `DEFAULT_FETCH_TIMEOUT_MS`, `HttpResponseError`. |
| `lib/scrapers/base.ts` | `fetchEventData` is generic despite its name. Also `BROWSER_HEADERS`, `extractMetaDescription`, and `debugSave` (set `DEBUG_DIR` to dump raw HTML). |
| `lib/scrapers/fetchAsChrome.ts` | Any outlet behind Cloudflare. `probeAsChrome` for URL liveness. |
| `lib/config/env.ts` | `isLocalScrapeRuntime()`, `isAIEnabled()`, `isJinaEnabled()`. `lib/news/types.ts` already mirrors `localOnly`. |
| `lib/ai/provider-clients.ts` | `azureChatCompletion` (timeouts, retries, `finishReason`), `parseJsonFromModel`, `shouldRetryAzureError`, `getEmbeddingModel`. |
| `lib/ai/embedding.ts` | `generateEmbedding(text, {taskType})` at 1536-d, compatible with the existing index strategy. Use `RETRIEVAL_QUERY` for search queries and the default `RETRIEVAL_DOCUMENT` for articles. `cosineSimilarity` for in-memory clustering. |
| `lib/ai/eventVerification.ts` `fetchPageContent` | Jina Reader turns a URL into markdown, which could produce full article text. It currently appears to fail on every call (see Surprises), so check the key first. |
| `lib/utils/parsers.ts` | `decodeHtmlEntities`, `stripHtml`, `cleanMarkdown`. Also `lib/utils/htmlToMarkdown.ts`. |
| `lib/utils/timezone.ts` | Eastern-time helpers (`parseAsEastern`, `getDayBoundariesEastern`, `getTodayStringEastern`). |
| `lib/notifications/slack.ts`, `postmark.ts` | Alerts and digests. |
| `scripts/run-full-cron-local.ts` pattern | Import the route `GET` handlers and call them with a synthetic `Request` carrying the bearer token. Local runs then use the same code as prod, including localOnly sources. |
| `scripts/check-cron-health.ts` pattern | Cadence gaps, silent sources, stale sources, a `VERDICT` line, and a non-zero exit. |
| `cron_job_runs` table | Use as-is with new job names. Keep the result shape `{inserted, updated, scrapers[], skippedSources, insertedBySource}`. |

### Generalize (the pattern carries over; the code needs parameters)

- **Scrape route skeleton** (`scrape/route.ts`): registry, localOnly split, parallel timed
  sources, per-source stats, upsert with `xmax`, then invalidate and record. The news team's
  `NewsSourceModule[]` already has the right shape for the registry. Add a per-source timeout,
  which events lack.
- **Upsert conflict policy** (`:326-346`). "Never replace good data with worse data" applies
  directly:
  - The longer body wins.
  - Non-empty values replace empty ones only.
  - AI-owned columns are never touched.
  - For news, also keep a content hash and a real `updated_at`, so corrections and updates can
    be detected. The events upsert never bumps `updatedAt`.
- **AI backoff columns** `ai_attempts`, `ai_last_attempt_at`, `ai_next_attempt_at`, plus the
  transient/permanent classifier and the rule "partial result counts as a failure but is saved."
  Copy them onto the news table as they are. This is the best-proven part of the pipeline.
- **Merge before remove** (`mergeFields`, `chooseEventToKeep`) plus `deduped_at` and
  `dedup_skip`. For news, merging probably means a story cluster that articles point to, rather
  than removing articles. The keeper rules translate: primary source beats aggregator, original
  reporting beats a rewrite, a community submission never beats an official listing.
- **AI dedup mechanics**: day buckets, integer ids in the prompt, index validation, a keeper
  invariant, and scoping to what is visible. The prompt must return keeper and members, which
  also closes the known event gap.
- **Scoring**: a rubric with integer dimensions, clamping, a fallback score, write-only-missing
  columns, "similar items with dates" as context, and overrides folded into the score. News
  would score newsworthiness and local impact with the same machinery.
- **A free path before the LLM** (`recurringDetection.ts`). Detect routine content by rules
  (obituaries, weather, police blotter, recurring meeting notices) and give it a fixed score, as
  events do for recurring listings.
- **Similarity search** (`lib/db/similaritySearch.ts`): parameterize by table, and add the
  missing live-row filters.
- **Presentation patterns**:
  - `unstable_cache` with a tag, plus `revalidateTag` after each cron. Use a separate `'news'`
    tag; the shared `'events'` tag would flush the event pages on every news run.
  - A cached unfiltered "Top" pool with filtering on the client, ORDER BY ending in `id`, and
    append-not-swap ranking.
  - Summary first with "view original".
  - A client filter twin that stays in step with the server.
  - Cursor pagination.

### Event-specific (don't reuse)

- **Rule dedup methods A-E.** All depend on the same start time, venue, or date. News has no
  start time.
- **`geo.ts` `isNonNCEvent`.** It is a regex over venue addresses. News needs "is this about
  Asheville/WNC", which is a relevance classification. The `NC_LOCATIONS` / `KNOWN_CITIES` lists
  could seed a gazetteer.
- **`venues.ts`, price parsing, `timeUnknown`, recurring detection,** and everything else about
  event dates.
- **`tagCategories.ts`, `defaultFilters.ts`,** the score rubric text, and the Top 30 categories
  (weird, social). These are event vocabulary.
- **Cleanup's dead-URL semantics.** For an event, a 404 means cancelled. For news it may mean
  unpublished or retracted, which needs different handling. Also the startDate windows.
- **The verify cron** (it fills price and description).
- **The `events` table.** `start_date` is NOT NULL, and the Top 30, cleanup, and AI windows all
  key off start date. **Don't put articles in it.**

---

## 4. Lessons already built into the event pipeline

1. **Soft-delete, never hard-delete.**
   - Restore is one UPDATE, and the removal log prints the restore SQL (`cleanup/route.ts:272`).
   - CLAUDE.md requires every live query to filter both `deduped_at` and `dead_at`. **The code
     already breaks this in 4 places** (see Surprises), which shows how easy the filter is to
     forget.
   - For news, use a single visibility or status column, or a `live_articles` view, so there is
     one filter instead of N.
2. **Merge before remove, and do it in a transaction.**
   - The winner is not necessarily the row with the best data.
   - Merges are deterministic (losers in id order) and only fill gaps.
   - Cleanup wraps each group in a transaction (`:483-488`). Scrape does not (`:449-485`), so a
     failure between the two statements can leave a merged winner beside a live loser.
3. **Manual decisions must stick.**
   - `dedup_skip` keeps a restored row from being deduped again.
   - Hidden rows are excluded from dedup input so moderated content cannot come back.
   - The `hidden` flag is re-checked at write time for decisions made earlier in the run
     (`dedup/route.ts:169-174`).
4. **`cron_job_runs` is the only durable log.**
   - Vercel keeps runtime logs for about 1 hour. Record inserted vs updated (`upserted` counts
     every row touched), per-source `{ok, events, ms, error}`, and `skippedSources`.
   - **Health checks must confirm work was done, not just `status='success'`.** The verify cron
     proves it (lesson 6).
5. **Every queue needs per-row backoff and fair ordering.** The AI cron gets this right:
   `ORDER BY ai_attempts, start_date`, and a failure pushes `ai_next_attempt_at` into the future.
   The verify cron doesn't, and it is stuck (lesson 6).
6. **Watch for queues that stall silently at the head.** Verify runs
   `ORDER BY start_date LIMIT 30` and leaves `last_verified_at` unset when the Jina fetch fails.
   So the same 30 rows come back every run: 56 "successful" runs and 0 events checked. 3 of the
   30 slots are also taken by spam that is filtered after the LIMIT. Filter before the LIMIT, and
   back off failures.
7. **Budget against Vercel's 800s.**
   - The scrape runs at 61-72% of the limit. The slowest parallel source sets the pace:
     Theater Alliance re-fetches every detail page on every run, one at a time
     (`lib/scrapers/theateralliance.ts:254-265`).
   - For news:
     - Fetch each article body once (skip URLs that already have content).
     - Put a timeout on each source.
     - Keep ingest and enrichment in separate crons.
     - Add a wall-clock deadline check. The AI cron relies only on row limits.
8. **Every outbound call gets a timeout.**
   - Azure 90s (the SDK default of 10 minutes would sink the cron), embedding 30s, fetch 15s.
   - Turn off SDK retries when `withRetry` handles retries.
   - Don't retry an aborted paid call, because it may still be running and billed.
9. **Cloudflare checks the TLS fingerprint, not the IP.**
   - `fetchAsChrome` fixed the fingerprint problem, but since 2026-09-15 Cloudflare challenges
     every request from Vercel's egress. MX and NC Stage were moved back to `localOnly` on
     2026-09-17.
   - The price is staleness: MX, the biggest source, has not been seen since 9/18.
   - Classify each news source's hosting on day one. Log `skippedSources`. Make sure someone
     actually runs the local runner.
10. **Only a confirmed 404 means gone.**
    - Only 404/410 counts, re-probed as Chrome.
    - 403/429/5xx or a network error means "unknown" and must never delete anything.
    - Circuit breakers:
      - If more than 20% of one source looks dead at once, skip that source for the run.
      - `rhp.ts` fails the whole venue when more than 25% of cards fail to parse.
    - The news version: a feed that suddenly returns zero or half its usual items has changed
      its site, not run out of news.
11. **Zero results is not always an error.** REVOLVE and PECHAKUCHA are legitimately empty
    between events. Each news source needs its own expected cadence (a weekly paper vs a daily
    outlet).
12. **Only check what the scraper stopped confirming.** Dead checks apply only to rows with
    `lastSeenAt` older than 24h. The same idea works for re-fetching articles to catch updates.
13. **Invalidate the cache after every mutating cron.** Call `revalidateTag` with the profile
    argument, as Next 16 requires. Keep an ISR fallback of 1h.
14. **Everything is keyed to Eastern time.** That covers dedup date keys, filters, and display
    formatters. Naive strings go through `parseAsEastern`. News "today" and "this week" must use
    the same helpers.
15. **Clean up LLM output.**
    - Parse JSON tolerantly and clamp numbers.
    - Draw the allowed tags from one source of truth that feeds both the prompt and the UI
      (`TAG_CATEGORIES`).
    - Save partial results but still back off.
    - Treat `finish_reason=length` as transient.
    - Keep the raw output for debugging (posters store `rawModelOutput`; `AI_DEDUP_DEBUG_DIR`
      dumps prompts and replies).
16. **Keep the LLM's scope to what users see.**
    - AI dedup covers only the "Top" tier (score ≥15) for 31 days, which is 4x fewer rows and
      more accurate.
    - AI enrichment covers only the next 3 months.
    - Rules handle routine content, which saved 51% of scoring calls.
17. **Drizzle doesn't manage RLS.**
    - New tables start deny-all through the `ensure_rls` trigger, and policies and grants are
      written by hand.
    - The app writes through `DATABASE_URL` (postgres role, which bypasses RLS).
    - drizzle-kit uses the direct port 5432. Migrations are in `drizzle/0000-0016`.
    - Use `postgres.js` for scripts (`pg` is not installed).
18. **Plan embedding storage.**
    - HNSW over every row takes 288 MB for 38k events.
    - News only grows, and unlike events, old articles stay searchable.
    - Options to decide on up front: `halfvec`, 768 dimensions, or a partial or time-partitioned
      index.
19. **Keep hidden and removed rows out of recommendations.** A hidden event 404s, so
    recommending it gives the user a dead link (`similaritySearch.ts:90-91`).

---

## 5. Surprises and drift (worth knowing before copying)

- **Semantic search is not user-facing.** CLAUDE.md says the AI chat uses embeddings for
  recommendations. It doesn't: chat puts a date range of events into the prompt
  (`chat/route.ts:308-324`), and feed search is `ILIKE`. If news wants real semantic search, it
  will be the first user-facing consumer of the embeddings.
- **CLAUDE.md is out of date on AI.** (The first two points were fixed in CLAUDE.md on 09-25.)
  - Tags and summaries come from Azure (the `AZURE_OPENAI_DEPLOYMENT` deployment) in `lib/ai/tagAndSummarize.ts`, not Gemini
    `tagging.ts`.
  - `lib/ai/client.ts`, `azure-client.ts`, `tagging.ts` and `summary.ts` don't exist; the code
    is in `provider-clients.ts`.
  - The AI route's header comment says "every 6 hours at :10", but `vercel.json` runs it every
    3h at :20.
- **The soft-delete rule is broken in several places:**
  - `findSimilarEvents` filters only `hidden`, and `findSimilarByEmbedding` filters nothing
    (`similaritySearch.ts:86-101`, `:149`). Deduped and dead rows can appear in "similar events"
    and in scoring context. `promoteExtractions.ts` works around this.
  - None of the AI cron passes filter `deduped_at`, `dead_at` or `hidden`, so money is spent
    enriching removed rows.
  - Cleanup Phases 2 and 3 hard-delete (0 rows in the last 7 days, but the path exists).
- **The verify cron has done nothing for at least 7 days.** All 27 Jina fetches finish in about
  4s in total, which looks like an immediate HTTP error (a key or credit problem, not
  confirmed). Combined with the missing backoff, verify is stuck (lessons 5-6), and
  `cron:health` does not notice.
- **The scrape dedup reads all 35k live rows every run, past events included,** with
  descriptions. The cost grows with history. News rows never become "past", so news dedup must
  be limited by `published_at` from the start.
- **Each scrape runs about 3,400 single-row upserts to find about 25 new rows.** That is fine
  at this scale, but a news pipeline polling roughly 30 feeds every 6h should skip
  already-stored GUIDs before fetching bodies.
- **Half of the AI cron runs are no-ops** because AI runs every 3h and scrape every 6h. That is
  harmless, but it shows the schedule was set by feel. Enrichment for news can simply follow
  ingest.
