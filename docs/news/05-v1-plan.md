# 05 · News V1: the build plan

Written 2026-09-30. **This document is the source of truth for the V1 build.** It replaces the
much larger designs in `02-ai-pipeline-ideas.md` and `03-presentation-ideas.md`; those stay as
background and reference, especially for prompt wording. Where they disagree with this plan, this
plan wins.

Everything is built on the **`news` branch** in the worktree
`C:\Users\matth\projects\asheville-event-feed-news`. Another agent is building a "groups"
feature on `main` in the original checkout, so never edit files in
`C:\Users\matth\projects\asheville-event-feed`.

---

## 1. Decisions (Matt, 2026-09-30) and what each means for the build

| #   | Matt said                                                                                                                                                                                        | What we build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S19 | Drop the Top / All switch. The top items go in the AI summary and get bigger, more detailed cards. Less important items are minimal: just the title and a link, with no description or metadata. | One feed. Each day opens with an AI summary ("the short version") built from that day's top stories. Top stories render as **big cards**. Every other story renders as a **minimal row**: our headline, linking straight to the outlet's article, and nothing else.                                                                                                                                                                                                                                                                                                                                                                      |
| S20 | Retry Scry for Reddit. r/BlackMountain is fine. r/wnc is fine, filtered to news relevant to Asheville.                                                                                           | **The Scry check (2026-10-01) failed, so V1 doesn't use Scry.** Reddit stays on the existing RSS module, `localOnly`, so it only updates when Matt runs the local runner. The sources are r/asheville, r/BlackMountain and r/wnc, with r/wnc limited to posts about Buncombe. Why Scry failed: the API works and the key is fine, but r/asheville data runs about 10h behind with 30–45h gaps between reads; vote and comment counts are captured once and never refreshed; and personal keys are licensed only for non-commercial research. RSS carries no counts, so **the Reddit bar uses only the AI half** (`community_important`). |
| S21 | Google News: use it if it works and gives good data.                                                                                                                                             | Keep `googlenews.ts` as a source (D5) if it passes the source check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S22 | Send the User-Agent from Matt's regular Chrome. Don't tell outlets we're scraping public news.                                                                                                   | `NEWS_USER_AGENT` = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36` (Matt's installed Chrome is 153.0.8010.54; Chrome's reduced UA reports `153.0.0.0`). Every module uses it, except Reddit's own API etiquette and any source that needs something else to work. No outreach. **D0b is reversed.**                                                                                                                                                                                                                                                                   |
| S23 | Every 3 hours is fine.                                                                                                                                                                           | Crons run every 3 hours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S24 | Use a new branch if that's easy.                                                                                                                                                                 | The `news` branch, in its own worktree. Merging to `main` is Matt's call after review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S25 | Keep full text forever.                                                                                                                                                                          | No purge or retention job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S26 | Crime and privacy: take what news sites publicly show. We're an aggregator.                                                                                                                      | **D15 is dropped.** No name-scrubbing, `noindex`, public-safety collapsing or 12-month expiry. Crime is ordinary news. Our summaries stay neutral and only restate what the articles say.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S27 | Images if they're good, useful and look good; not essential.                                                                                                                                     | Big cards show the lead article's image when it passes a "real photo" filter (§7.4). Minimal rows never show images.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| S28 | Matt didn't know what the "Events · News switch" was.                                                                                                                                            | It was D21: a separate section switch next to the logo. **Dropped.** "News" becomes a fifth tab in the existing tab row (`components/EventTabSwitcher.tsx`): All Events · Top 30 · Your List · Posters · News.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| S29 | Are we on Azure? Then use gpt-6.1-sol for now.                                                                                                                                                   | Azure deployment `gpt-6.1-sol` exists and was tested on 2026-09-30. It accepts `reasoning_effort` low/medium/high/xhigh (no `none`, no `minimal`) and only `temperature` 1. News AI uses a **separate** env var, `AZURE_OPENAI_NEWS_DEPLOYMENT` (default `gpt-6.1-sol`), at `low` effort. Events stay on `AZURE_OPENAI_DEPLOYMENT` (`gpt-6-luna`). No fallback model.                                                                                                                                                                                                                                                                    |

These earlier settled decisions still hold:

- S1: Asheville and Buncombe County only.
- S2: store full text; show only our headlines and summaries, plus links out.
- S3: Reddit is in scope.
- S4, S13: `/news` is one page.
- S5: robots.txt and terms aren't blockers; take a source down when asked.
- S6: `news_*` tables in the prod database are OK.
- S10: sharing is first-class.
- S12: no following or bookmarks.
- S14: Reddit posts look like other stories and must clear a bar.
- S15: no "Developing" tag.
- S16: the "these sources" modal.
- S18: the page ends with the Top 30 events for the next 7 days.

S9 and S17 are superseded by S19.

---

## 2. What V1 deliberately leaves out

Each cut is from 02/03. Anything here can come back later; none of it blocks V1.

- **Story pages** (`/news/[slug]`), slugs and redirect tables. Everything happens on `/news`, and a share link is `/news?s=<short_id>`.
- **Merging and splitting stories, and the nightly audit.** Articles attach to stories. Two stories are never merged after the fact.
- **Fact/evidence extraction, sentence citations and validators**, and the summary revision table. The prompts say to use only the given text, and Sol is strong enough for V1. Judge that from real output in the Chrome pass, not with machinery.
- **Hysteresis and stored "incumbent" Top logic.** Top is recomputed for today and yesterday (ET) on each run. Older days are frozen.
- **Wire-copy collapse.** Clustering already puts copies in the same story, and `outlet_count` counts distinct outlet domains.
- **Linking news to events, agenda item parsing, meeting events, storylines, concept labels, "Only in AVL", the "Updated" tag, buzz scores and community summaries.**
- **Semantic search.** V1 search is Postgres full-text search over stories.
- **A separate full-text cron.** The scrape cron fetches full text for new articles inline, within a time budget.
- **Admin UI.** Takedown is a script.
- **Email, OG image rendering, a Sources page** (the modal is enough), and a generic full-text extractor for outlets without a module.

- **Story embeddings.** Without semantic search they'd go unused.

---

## 3. Shared interfaces (pinned by the orchestrator before any agent starts)

Agents build against these. Change them only by telling the orchestrator in your final report.

- **`lib/news/types.ts`:**
  - `ScrapedArticle` gets `publisher?: { name: string; domain: string }` and `linkedUrl?: string`.
  - `NewsSourceModule` gets a required `domain: string` (the outlet domain we attribute its items to; for an aggregator, the aggregator's own domain).
  - `scrape(ctx: ScrapeContext)` with `ScrapeContext = { deadline: number }` (epoch ms). Modules that make many requests must stop when `Date.now() > deadline` and return what they have.
  - `fetchFullText?(url): Promise<FullText | undefined>`, where `FullText = string | { text: string; imageUrl?: string }`. Return `undefined` when there's no body (terminal). Throw on a transient error.
- **`lib/news/registry.ts`:** `NEWS_SOURCES: NewsSourceModule[]`, an explicit import list. Nothing scans the directory.
- **`lib/news/identity.ts`:** `articleIdentity(module, item) → { url, outletDomain, outletName, kind }`:
  - `url` is the canonical **publisher** URL. It is the only unique ingest key.
  - `outletDomain` is `item.publisher.domain` for aggregator items, and `module.domain` for everything else. It is not the URL's host, so government documents hosted on `docs.google.com` still belong to their government.
  - `kind` is `'outlet'` for aggregator items, otherwise `module.kind`.
- **`lib/cron/jobTracker.ts`:** `CronJobName` gains `'news-scrape' | 'news-ai'`.
- **Model access:** `azureChatCompletion` gains optional `deployment` and `reasoningEffort`. The shared client is built **without** a pinned `deployment`; every request passes `model`. All existing callers already pass `model`, so events behavior doesn't change. News calls pass `deployment: newsDeployment()` (`AZURE_OPENAI_NEWS_DEPLOYMENT`, default `gpt-6.1-sol`), `reasoningEffort: 'low'`, `maxRetries: 1`, and a 60s timeout. A failed call is retried by the next run, never inside this one.
- **`package.json`** scripts (`news:test`, `news:local`, `news:eval`), **`vercel.json`** crons and the worktree `.env`: the orchestrator owns all of them.

---

## 4. Sources (workstream A)

Owns `lib/news/sources/**`, `lib/news/feeds.ts`, `lib/news/registry.ts`, `scripts/news/test-source.ts` and `data/news/eval/*.ts|*.js`.

1. **User-Agent.** Set `NEWS_USER_AGENT` per S22. Any module that hard-codes a browser UA uses the constant. Reddit RSS keeps its descriptive UA.
2. **Implement the pinned contract** in every module: `domain`, the `scrape(ctx)` deadline, and the `FullText` return.
3. **Google News.**
   - Set `kind: 'outlet'`.
   - Emit **only items whose URL resolved to the publisher's**, with `publisher {name, domain}`. Drop unresolved items; they're retried next run while they stay in Google's feed.
   - Keep the `DIRECT_DOMAINS` skip. It saves the resolution calls, and URL dedup is the backstop.
   - Respect the deadline. If the resolver no longer works, take Google News out of the registry and report that.
4. **Reddit** stays on RSS with `localOnly: true` (S20). Move the link target into `linkedUrl` and keep the existing filters.
5. **Health pass.**
   - Run `npx tsx scripts/news/test-source.ts --all` and fix anything broken or garbled: dates, entities, empty bodies.
   - Set `localOnly: true` where a datacenter IP can't work. Buncombe County is already marked. Also mark Mountain Xpress news, which uses `fetchAsChrome`, unless it plainly uses another path.
6. **Images.** Fill `imageUrl` whenever the feed or API has one. If a module already fetches the article page in `fetchFullText`, return the page's `og:image` from there.
7. **Delete the prototype scripts** in `data/news/eval/` (`*.ts`, `*.js`). Keep the JSON files.

---

## 5. Data model (workstream B1)

Add a marked `// ===== News =====` section to `lib/db/schema.ts`. Write `drizzle/0019_news.sql` by hand. `0017` and `0018_groups.sql` already exist uncommitted on `main`, so check `../asheville-event-feed/drizzle/` again before applying, and take the next free number if 0019 is gone too.

In **one transaction**, the migration must:

1. Create the four tables.
2. Enable RLS on them.
3. `REVOKE ALL ON <table> FROM anon, authenticated`.

The result is deny-all, like `poster_uploads`. Apply it to prod with a postgres.js script. The orchestrator adds the tables to `CLAUDE.md`.

### `news_sources` (takedown switch)

| column                 | type                 | notes                                                 |
| ---------------------- | -------------------- | ----------------------------------------------------- |
| domain                 | text pk              | e.g. `wlos.com`, `citizen-times.com`, `reddit.com`    |
| name                   | text                 |                                                       |
| kind                   | text                 | `outlet` / `government` / `institution` / `community` |
| homepage               | text null            |                                                       |
| enabled                | boolean default true |                                                       |
| created_at, updated_at | timestamptz          |                                                       |

- Seed from `NEWS_SOURCES` (`module.domain`).
- An aggregator publisher gets a row on first sight (upsert on ingest).
- A disabled domain's module doesn't run, and its new items are dropped from every module.

### `news_articles`

| column                                    | type                  | notes                                                                                                                                                    |
| ----------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                        | uuid pk               |                                                                                                                                                          |
| url                                       | text **unique**       | canonical publisher URL; the only ingest identity                                                                                                        |
| source, source_id                         | text                  | module key and the source's id; metadata, non-unique index                                                                                               |
| outlet_domain, outlet_name, kind          | text                  | from `articleIdentity`                                                                                                                                   |
| title, dek                                | text                  | the outlet's own; shown only as link labels                                                                                                              |
| content_text                              | text null             | full text, kept forever                                                                                                                                  |
| author, image_url, linked_url             | text null             |                                                                                                                                                          |
| categories                                | text[]                |                                                                                                                                                          |
| engagement                                | jsonb null            | refreshed on each scrape                                                                                                                                 |
| paywalled                                 | boolean default false |                                                                                                                                                          |
| published_at, first_seen_at, last_seen_at | timestamptz           |                                                                                                                                                          |
| fulltext_status                           | text                  | `none_needed` / `pending` / `fetched` / `unavailable` / `failed`                                                                                         |
| fulltext_attempts                         | int default 0         | gives up after 3 transient failures                                                                                                                      |
| input_hash                                | text                  | hash of the enrichment input (title, dek, content text)                                                                                                  |
| enriched_hash                             | text null             | the `input_hash` that was last enriched; differs from `input_hash` → needs enrichment                                                                    |
| state                                     | text                  | `pending` (never enriched) / `live` / `skipped` / `hidden`                                                                                               |
| skip_reason                               | text null             | `not_local`, `opinion`, `letter`, `sponsored`, `obituary`, `service`, `roundup`, `community_noise`, `content_filter`, `too_old`, `ai_failed`, `takedown` |
| ai_headline, ai_summary, what_happened    | text null             | ours                                                                                                                                                     |
| entities, topics                          | text[]                |                                                                                                                                                          |
| place, buncombe                           | text null             |                                                                                                                                                          |
| importance                                | int null              | 0–10                                                                                                                                                     |
| community_important                       | boolean null          |                                                                                                                                                          |
| ai_attempts                               | int default 0         | gives up after 3 → `skipped/ai_failed`                                                                                                                   |
| ai_error                                  | text null             |                                                                                                                                                          |
| enriched_at                               | timestamptz null      |                                                                                                                                                          |
| embedding                                 | vector(1536) null     | set to null whenever enrichment reruns                                                                                                                   |
| story_id                                  | uuid null             |                                                                                                                                                          |
| cluster_reason                            | text null             |                                                                                                                                                          |
| created_at, updated_at                    | timestamptz           |                                                                                                                                                          |

Indexes: `(published_at)`, `(story_id)`, `(state)`, `(outlet_domain)`, `(source, source_id)`.

### `news_stories`

| column                              | type                 | notes                                        |
| ----------------------------------- | -------------------- | -------------------------------------------- |
| id                                  | uuid pk              |                                              |
| short_id                            | text unique          | 8 chars `[a-z0-9]`, random, never reused     |
| tier                                | text                 | `newsroom` / `community`                     |
| state                               | text                 | `pending` (not shown) / `live` / `hidden`    |
| headline, summary                   | text                 | ours                                         |
| image_url                           | text null            |                                              |
| topics                              | text[]               |                                              |
| place                               | text null            |                                              |
| importance, score                   | int                  |                                              |
| top_rank                            | int null             | non-null means a Top story on its filing day |
| filing_day                          | date                 | ET                                           |
| lead_article_id                     | uuid null            |                                              |
| article_count, outlet_count         | int                  | newsroom-tier members only                   |
| first_published_at, last_article_at | timestamptz          |                                              |
| dirty                               | boolean default true | needs recompute (§6.4)                       |
| search_tsv                          | tsvector generated   | headline + summary; GIN index                |
| created_at, updated_at              | timestamptz          |                                              |

Indexes: `(filing_day)`, `(state)`, `(dirty) WHERE dirty`, GIN `(search_tsv)`.

### `news_days`

| column       | type        | notes                                                                                      |
| ------------ | ----------- | ------------------------------------------------------------------------------------------ |
| day          | date pk     | ET                                                                                         |
| summary      | jsonb       | `[{storyId: short_id, text}]`                                                              |
| input_hash   | text        | hash of the ordered Top stories' ids, headlines and summaries; a mismatch means regenerate |
| generated_at | timestamptz |                                                                                            |

All feed reads go through one live-only helper in `lib/news/db.ts`.

---

## 6. Pipeline

### 6.1 Ingest (workstream B1): `lib/news/ingest.ts` and `app/api/cron/news-scrape/route.ts`

- **Schedule:** `40 */3 * * *`, `maxDuration` 300. **One absolute deadline:** start + 270s, leaving time to record the run.

1. **Load and run modules.** Load `news_sources`. Run the enabled modules in parallel with `scrape({deadline: start + 120s})`. `localOnly` modules run only when `isLocalScrapeRuntime()` (`lib/config/env.ts`). Each module also gets a `Promise.race` guard at deadline + 10s.
2. **Identify and filter.** Compute `articleIdentity` for each item and drop disabled domains.
3. **Upsert on `url`.**
   - **New row:** `state='pending'`, `input_hash` set, and `fulltext_status='pending'` when there's no body and the module has `fetchFullText`, otherwise `none_needed`.
   - **Existing row:** refresh `last_seen_at` and `engagement`. Update `title`, `dek` and `content_text` when the source's value is non-empty and different; this covers corrections and agenda drafts becoming final. Recompute `input_hash`. Fill other empty fields. Never touch AI columns.
4. **Full text** for rows with `fulltext_status` `pending`, or `failed` with fewer than 3 attempts, oldest first:
   - Only for enabled domains, not paywalled, and with a runnable module (skip `localOnly` modules on Vercel).
   - Concurrency 4, at most 1 per domain, 15s per fetch, stopping at the overall deadline.
   - A fetched body updates `content_text` and `input_hash`.
5. **Failures.** Config or auth problems, like missing env, fail the run. One source's outage is recorded per source, and the run still succeeds.
6. **Record the run** (`news-scrape`): `{inserted, updated, textChanged, droppedDisabled, fulltext:{fetched,unavailable,failed}, scrapers:[{name, ok, items, ms, error}], skippedSources}`.

### 6.2 AI (workstream B2): `lib/news/ai/*`, `lib/news/pipeline.ts` and `app/api/cron/news-ai/route.ts`

- **Schedule:** `55 */3 * * *`, `maxDuration` 800. **One absolute deadline:** start + 660s. No new model call starts after it, leaving time for commits and the run record.

**Lease.** Skip the run if `cron_job_runs` has a `news-ai` row in `running` that started within the last 15 minutes. Local runs record themselves too, so this also stops a local run and the cron from overlapping. Don't use advisory locks: Supabase pools connections in transaction mode.

Steps:

1. **Enrich.** Articles with `state <> 'hidden'` and `enriched_hash IS DISTINCT FROM input_hash`, published in the last 14 days. A never-enriched article older than that becomes `skipped/too_old`. Full text must be settled: not `pending`, or the row is more than 1 hour old.
   - Order **oldest first**, ties by id. 8 in parallel, capped at 200 per run.
   - One Sol call per article (§6.5) sets `state` to `live` or `skipped`, the AI fields, `enriched_hash = input_hash`, and `embedding = NULL`. It marks the article's story `dirty`.
   - A content-filter 400 → `skipped/content_filter`. Any other failure → `ai_attempts++`, and at 3 → `skipped/ai_failed`.
2. **Embed** live articles with no embedding, using `"${ai_headline}. ${what_happened}"` and `RETRIEVAL_DOCUMENT`.
3. **Cluster** live, embedded articles with `story_id IS NULL`: **newsroom-tier articles first, then Reddit**, each in `published_at ASC, id` order.
   - **Reddit link posts.** If `linked_url` matches an article that has a story, attach to that story with no LLM call. If the target exists but has no story yet, defer the post to the next run. If the target isn't in our data, cluster it like any other post.
   - **Candidates.** Live articles with a story in `[published_at − 10 days, published_at + 1 day]` of **this** article, excluding stories in state `hidden`. Group them by story, taking the **max** similarity per story. Keep the best 4 stories with similarity ≥ 0.72.
   - **Decision.** With candidates, one Sol multiple-choice call: `same` → attach, `new` → new story. Without candidates → new story.
   - **Writes.** Each decision writes `cluster_reason`. Story creation and article assignment commit in **one transaction**. Any attach marks the story `dirty`.
4. **Recompute dirty stories** (§6.4). Synthesis is one Sol call per story that needs it.
5. **Top and daily summaries** (§6.4).
6. **Record the run** (`news-ai`): `{enriched, skipped:{byReason}, contentFiltered, aiFailed, clustered:{attachedLlm, attachedLink, deferred, newStories}, recomputed, synthesized, topDaysChanged, daysSummarized, tokens:{in,out}, backlog:{needsEnrich, unclustered, dirty}, msByStep, hitDeadline}`.

`/news` is uncached, so nothing needs revalidating (§7.1).

### 6.3 The local gate

- **An article is local only when `buncombe='core'`.** The prompt defines `core` as: Asheville/Buncombe is the **subject**, or the article describes a specific local impact (a road closing in Swannanoa, a Buncombe school decision). Anything else is `skipped/not_local`.
- Source identity, place lists and the gazetteer never override the gate. The gazetteer stays a cheap prefilter inside the scrapers.

### 6.4 Story recompute, filing, Top and daily summaries

**Recompute a dirty story.** Its eligible members are its live articles. The story's `tier` is `newsroom` if any member's `kind` isn't `community`.

- **0 eligible members:** `state='hidden'`.
- **Newsroom tier with 1 newsroom member:** copy that article's `ai_headline`, `ai_summary` and `importance`.
- **Newsroom tier with 2+ newsroom members:** synthesize from at most 8 newsroom members; community posts are never input. This also covers a community story promoted by a newsroom article, and a story cut down to one member by a takedown.
- **Community tier:** use the earliest post's attributive headline and summary. Importance is 0.

Then:

- **Counts.** `article_count`, and `outlet_count` (distinct `outlet_domain`).
- **`lead_article_id`.** In priority order: an `outlet` article; then a government or institution article; then the article with full text; then the earliest.
- **`topics` and `place`** are the most common among members.
- **`image_url`** follows §7.4.
- **`state`.**
  - Newsroom tier → `live`.
  - Community tier → `live` only if a member has `community_important=true`, or `engagement.score ≥ 25` or `engagement.comments ≥ 15` when counts exist (D25b). At most 3 community stories are live per filing day, ranked across the whole day by engagement and then recency. The rest stay `pending`.
- **`score`** = `2·importance + min(4, 2·(outlet_count − 1)) + (2 if any member is an outlet article)`.
- Clear `dirty` in the same transaction that writes the recomputed fields. An interrupted run leaves it set, so the next run picks the story up again.

**Filing day.**

- Set once, at creation, to the ET date of the first article's `published_at`.
- Moves **forward only**, and only when synthesis returns `newDevelopment=true`, to the ET date of the newest newsroom member. A re-report or a community post never moves it.
- A move clears `top_rank` and marks both the old and the new day for Top recompute.

**Top.**

- For a day: live newsroom stories filed that day with `score ≥ 14`, by score then `first_published_at`, at most **5**.
- If fewer than 2 qualify, top up to 2 from stories with `score ≥ 8`. Community stories are never Top. Write `top_rank` 1..n and null for everyone else.
- **Which days are recomputed each run:**
  - today and yesterday (ET);
  - any day with no `news_days` row yet, which covers the initial backfill;
  - any day that lost a Top story to a refile, a hide or a takedown.

  All other days stay frozen.

**Daily summary.**

- For each recomputed day, hash its ordered Top stories' short ids, headlines and summaries. If the hash differs from `news_days.input_hash`, regenerate with one Sol call: `[{storyId, text}]`, one neutral sentence per Top story, at most 28 words, in rank order.
- A day with no Top stories has its `news_days` row deleted.

### 6.5 Prompts

Every call parses its output with `parseJsonFromModel`, clamps and validates the fields (unknown topics and places are dropped) and records its tokens. The prompt wording borrows from 02 §12.

- **Enrichment, newsroom mode** (02 §12.1, cut down). Returns:
  - `buncombe` (`core | affects | mentions | none`, with the strict `core` definition from §6.3);
  - `articleType` (`news | analysis | opinion | letter | press_release | event_announcement | roundup | obituary | sponsored | service | sports_result | other`);
  - `topics` (1–2) and `place`;
  - `headline`: ours, ≤ 90 characters, neutral, never the outlet's wording;
  - `summary`: 1–3 sentences, ≤ 50 words; who, what, where, when and what's next; no quotes;
  - `whatHappened` (≤ 30 words), `entities` (≤ 8), and `importance` (0–10, rubric from 02 §8.3).

  `articleType` in `opinion | letter | sponsored | obituary | service | roundup` is skipped with that type as the reason. Input: outlet, kind, date, title, dek, and the body capped at 8,000 characters.

- **Enrichment, community mode** (Reddit). Returns:
  - `buncombe` and `communityType` (`local_report | discussion | link_to_news | event_promo | question | recommendation | classified | personal | other`);
  - `important`: true only for a civic matter, public safety, public health, or a big local change; complaints, asks and chatter are false;
  - an **attributive** `headline` and `summary` ("r/asheville posters report…");
  - `whatHappened`, `entities`, `topics` and `place`.

  `question | recommendation | classified | personal` → `skipped/community_noise`.

- **Cluster confirmation:** 02 §12.2, nearly verbatim. Keep the "a bounded event is one story" line and the rule that an overview never absorbs a specific story.
- **Synthesis.** Input: the current headline and summary (if any), plus each newsroom member's outlet, date, kind, original title, dek and first 1,500 characters of text. Output: `{headline, summary (≤ 80 words), importance, newDevelopment}`. Rules:
  - neutral, no quotes;
  - attribute single-outlet claims;
  - **different domains carrying the same syndicated text are not independent confirmation**;
  - use only the given text.
- **Daily summary:** §6.4.

### 6.6 Config: `lib/news/topics.ts` (workstream B2)

- **Topics:** the 12 from 02 §5.1 (label and guidance), the single source for prompts and the UI.
- **Places:** Downtown, West Asheville, North Asheville, East Asheville, South Asheville, Black Mountain, Montreat, Biltmore Forest, Weaverville, Woodfin, Swannanoa, Fairview, Candler, Leicester, Arden, Enka, Barnardsville, Asheville (city-wide), Buncombe County (county-wide).

### 6.7 Local runner and takedown

- **`scripts/news/run-local.ts`** (B2). Runs ingest with the `localOnly` modules included, then the AI pipeline, by calling the same exported functions the routes call. Both runs are recorded in `cron_job_runs`.
- **`scripts/news/takedown.ts <domain>`** (B1). In one transaction:
  - set `news_sources.enabled=false`;
  - set that domain's articles to `hidden/takedown`;
  - set **every story with a member from that domain** to `hidden` and `dirty`, so the next AI run recomputes it, and republishes it only if other live members remain;
  - delete `news_days` rows containing any of those stories, so the next run regenerates them.

  **`--enable <domain>`** only turns ingest back on. Articles hidden by the takedown stay hidden; the script's header comment documents the manual SQL to restore them.

### 6.8 Clustering eval: `scripts/news/eval-clustering.ts` (B2)

- Replays `data/news/eval/corpus.json` against `golden.json` through the **production** enrichment, embedding and cluster-decision functions, in memory with no database.
- Pins "now" to the corpus dates. Caches model answers in a scratch file, keyed by a hash of prompt + model + options.
- Reports B-cubed P/R/F1 and the false merges by title, **and lists the golden articles the enrichment gate skipped**, so the denominator is visible.
- **Ship bar:** F1 ≥ 0.90 with ≤ 2 false merges on the articles that reached clustering. If it misses, tune the prompt or threshold first.

---

## 7. The `/news` page (workstream C)

Owns `app/news/**`, `components/news/**`, `lib/news/queries.ts`, `components/EventTabSwitcher.tsx`, `components/Header.tsx`, and any small helper extracted for the end cap. Must not edit `lib/db/schema.ts`, the pipeline or the sources.

### 7.1 Route and data

- `app/news/page.tsx` is a **dynamic, uncached** server component, like `/posters`. News reads aren't cached at all, so there's nothing to invalidate. The end cap's events data reuses the existing cached Top 30 function under the `events` tag.
- Search params: `?s=<short_id>`, `?q=<text>` (`websearch_to_tsquery` on `search_tsv`, live stories, newest first, ≤ 50), `?topic=<topic>`.
- Default view: the last **7 filing days** that have live stories.
- `generateMetadata`: with a live `?s=`, the story's headline, the first sentence of its summary, and its image. Otherwise "Asheville News · AVL GO".

### 7.2 Layout, top to bottom

1. **Header and tab row.** `Header`, then the tab row with **News** active. Add `'news'` to `EventTabSwitcher` and `Header`'s `activeTab` type. The News link drops the other tabs' params.
2. **Intro.** "Asheville news" and the line "Headlines and summaries by AVL GO, from reporting by **these sources**".
   - "these sources" opens a modal listing enabled `news_sources`, grouped as Newsrooms, Government & institutions, and Community, each linking to its homepage.
   - The modal ends with: "Want your outlet removed? Email hello@avlgo.com."
3. **Search box and a Topic filter** (the 12 topics). Both drive the URL params.
4. **Days, newest first.** For each day:
   - a sticky day header ("Today", "Yesterday", "Mon, Sep 28");
   - **the short version:** that day's `news_days.summary` sentences as one paragraph, each sentence linking to its card's anchor;
   - **big cards** for the Top stories, in `top_rank` order;
   - **More news:** every other live story that day, highest score first, as **minimal rows**.
5. **Search or topic results** replace the days with a flat list: Top stories as big cards, the rest as minimal rows, plus a "Clear" link.
6. **End cap.** "That's the news. Now go do something.", then the overall Top 30 events (the same ranking the Top 30 page shows) filtered to events in the next 7 ET calendar days, **keeping their Top 30 ranks**. Use `EventCard`, and hide actions that make no sense here instead of passing no-op handlers. If the ranking and multi-date collapse live privately inside `EventFeed`, extract only that helper; don't mount `EventFeed`.

### 7.3 Card anatomy

- **Big card:**
  1. The image, if any: 16:9, `object-cover`, plain `<img loading="lazy" referrerPolicy="no-referrer">` (no Next image optimizer), hidden on error.
  2. Our headline, larger.
  3. Our summary.
  4. One bottom row:
     - an outlined **"Read at {outlet} ↗"** to the lead article, in a new tab with `utm_source=avlgo`;
     - small chips for the other outlets, each linking to its article;
     - "r/asheville discussion ↗" when a Reddit post is attached;
     - the topic · place tag;
     - a relative time;
     - **Share**: the native share sheet on mobile, copy plus a toast on desktop, sharing `https://avlgo.com/news?s=<short_id>`.
- **Minimal row:** our headline, linked to the lead article (new tab, `utm_source=avlgo`), with a subtle ↗. Nothing else. That's S19, taken literally.
- **Shared story (`?s=`).**
  - The id resolves on its own, regardless of the date window, search or topic.
  - If the story is on the page, scroll to it and give it a fading highlight, copying the `/posters?p=` pattern.
  - If it isn't rendered for any reason, show it once as a big card in a "Shared with you" slot at the top.
  - A hidden or unknown id shows "That story is no longer available".

### 7.4 Story image

- Take the lead article's `image_url`, or failing that, any `outlet` member's.
- Keep it only if it's `https` and its URL doesn't match `/logo|placeholder|default|favicon|avatar|icon|blank|spacer/i`.
- No server-side image fetching. The Chrome pass judges whether this is good enough.

### 7.5 Look and feel

Match the events pages: Tailwind, the brand color, dark mode, mobile first at 375px. News is text-first, and big cards get modest emphasis. Minimal rows are a dense list. No purple or violet for Reddit (S14).

---

## 8. Order of work and gates

0. **The orchestrator pins §3:** types, registry stub, identity helper, `CronJobName`, the Azure options, `package.json`, `vercel.json` and `.env`.
1. **Step 1, in parallel:** A (sources) and B1 (schema, migration, ingest, scrape route, takedown). B1 ends with one real local ingest that fills `news_articles`.
2. **Step 2, in parallel:**
   - B2: the AI pipeline, topics, local runner and eval. Run it on the real data until stories exist.
   - C: the UI. Build it against the schema, then verify it on real data once B2 has filled it.
   - B1 and B2 never edit the same files.
3. **Gate:**
   - `npx tsc --noEmit`, `npm run lint` and `npm run build`;
   - a full `npm run news:local`;
   - the orchestrator adds the news jobs to `scripts/check-cron-health.ts`, which reads `job_name='scrape'` and `events` today, and updates `CLAUDE.md` and `docs/news/decisions.md`.
4. **Final Codex review** of the branch diff. Triage it, then fix.
5. **Chrome pass** by an Opus agent: function, design, mobile, dark mode. Then fix.
6. **Commit on `news`.** Don't merge to `main`, push or deploy; that's Matt's call.
