# 02 · The AI layer for AVL GO local news: clean, enrich, combine

Written 2026-09-25 by the design-ai agent.

**Revision 3.** It follows Matt's settled decisions (S1–S10 in `docs/news/decisions.md`; see "Settled" at the end) and the field list in design-ux's 03 v2 §9. Changes since revision 2:
- Every headline and dek is ours.
- New per-article fields: `fullStoryHas`, typed entities, concept labels.
- New community fields.
- Top vs All (§8.4).
- Stable ids, slugs and OG cards for sharing (§8.5).
- Full text is kept forever.

It builds on:
- The code: `CLAUDE.md`, `lib/news/types.ts` (including the new `engagement` and `fetchFullText`), the source modules, `lib/news/feeds.ts`, `lib/ai/*`, `app/api/cron/ai/route.ts`, `lib/utils/deduplication.ts`, `lib/db/schema.ts`, `lib/db/similaritySearch.ts`, `lib/config/env.ts`.
- The sibling briefs 01 (event pipeline) and 03 (presentation).
- The scout catalogs in `data/news/`.
- An offline prototype over 250 real items from Sept 16–25 (§11): no DB, no repo edits, about $0.65 of AI spend.

> **Model update (09-25, after this revision):** the pipeline now targets Azure **`gpt-6-luna`** with no fallback model (decisions S11, D11). Wherever this doc says gpt-5-mini, read Luna. Luna has no `minimal` effort, so use `none`. The costs in §10.3 and the F1 figures were measured before the switch, so re-measure them on Luna.

> **UI update (09-27):** Matt's review of the mockup (decisions S12–S18) removed the "Around town" strand, following, and the "Developing" tag. A Reddit post that matches no story now becomes an ordinary, attributive story only if it clears a bar (S14, D25b). §4, §8.3–8.6, §12 and the decisions below are updated to match. `phase` stays as internal data.

---

## TL;DR

- **Pipeline:**
  1. Ingest (`news-scrape`).
  2. Fetch full text for new articles (`news-fetch`, a separate pass like the verify cron).
  3. Free rules and wire-copy collapse.
  4. **One enrichment call per article.** It covers the Buncombe relevance gate, type, topics, places, entities, facts with verbatim evidence, and a neutral one-line "what happened".
  5. Embed that line.
  6. Cluster into **stories**.
  7. Summarize: every visible story gets **our** headline, dek and cited summary.
     - A single-article story reuses its enrichment output, at no extra cost.
     - A multi-article story gets an incremental synthesis.
  8. Rank (a stored `news_score`, and a stable per-day **Top** set with hysteresis), index, and link to events.

  Crons: `news-scrape`, `news-fetch` and `news-ai` every 3h, plus a daily `news-maintenance`.
- **Buncombe-only gate.** It combines four signals:
  - the LLM's categorical relevance;
  - a Buncombe gazetteer (towns, neighborhoods, landmarks);
  - per-outlet priors;
  - story-level propagation.

  In the prototype, the LLM and the gazetteer each found about 148 Buncombe items out of 226, and together 163. Only 1 of 20 FOX Carolina items and 3 of 15 BPR items survive the gate.
- **Clustering.** Embeddings alone can't do it: different "Two years after Helene" pieces scored 0.91–0.965, above the median same-story pair (0.83). The design:
  - embeddings retrieve candidates;
  - rare person/"matter" entities corroborate auto-merges;
  - a cheap LLM multiple-choice call decides the ambiguous band;
  - a scope rule stops overview pieces (anniversary packages, meeting recaps) from absorbing specific stories.

  Measured on 24 hand-labeled multi-outlet stories: **F1 0.94–0.97, 19–22 recovered whole, 1–2 real false merges**, against 0.91 for the best embedding threshold alone.
- **Community tier (Reddit).** A distinct trust tier: a **signal, never a source.**
  - Link posts attach deterministically to the article they link, or seed a fetch of it when we missed it.
  - Local reports and discussion attach to stories as "Community discussion", each with a neutral ≤20-word paraphrase. They feed a **buzz** signal from `engagement` (score and comments, when the feed has it; Scry may) or from thread and author counts.
  - A post that matches no story becomes a **community-only story** only if it clears the bar (S14): score ≥ 25 or ≥ 15 comments when engagement exists, or the AI rates it important (civic, public safety, public health, a big local change). At most 3 a day, attributive, labeled not verified, never in Top. The rest are dropped. `exclude_reason` gates still apply.
  - Community text is never a fact in synthesized text, and never re-files a story.
- **Summaries inform without substituting.**
  - Our headline (≤90 characters) and dek (≤30 words, the latest development).
  - Summary: ≤45 words for a single article, ≤80 for multi-article.
  - The "what" layer only, no quotes, at most 3 facts per source.
  - Each article gets a `fullStoryHas` line (≤25 words) naming, without stating, what the full story adds, which gives readers a reason to click "Read at X".
- **Top vs All.** `news_score` and Top membership are **stored** and recomputed each run, using design-ux's parameters.
  - Top per filing day: at least 15/30 to enter, at most 5 a day, at least 2 a day (topped up from ≥ 8). The UI adds the Only in AVL slot.
  - Hysteresis: a story leaves only below 13, incumbents are displaced only by a +2 challenger, importance moves ±1 per update, and past days freeze.
  - Calibrated on the prototype: typical days have 3–4 stories at ≥ 15, which is 38–50% of eligible stories.
- **Sharing.** Permanent, never-reused `short_id`s for stories (and articles). Slugs are `<words>-<shortId>` and resolve by `shortId`. There's no `?c=` link for posts (D25e).
  - Every merge writes a `news_story_redirects` row (path-compressed) and 308s to the survivor.
  - A split keeps the original id on the parent.
  - Removed stories show "no longer available".
  - OG cards are rendered per request with `ImageResponse`, cache-busted by `summary_version`.
- **Takedown in minutes, with no deploy.** `news_sources` is keyed by **outlet domain**, so it also covers Google News and Reddit-discovered items.
  - `enabled=false` stops ingest.
  - "Purge" is an admin action (with a script twin). It hides and strips the outlet's articles, deletes their sentences from story summaries immediately, hides stories left with no source, and queues full re-synthesis.
- **One state column per table** (`state`, plus a reason) instead of N soft-delete timestamps. **Every candidate query is bounded by `published_at`.**
- **Cost:** about **$0.35/day, $11/month** at list price. Budget $15–25/month, plus about $20 one-time for a 90-day backfill.
- **Storage:** full text is kept forever. It adds about 90 MB/year after compression, and article embeddings about 210 MB/year.

---

## 1. Stages

| # | Stage | Cron | Cost | What it does |
|---|---|---|---|---|
| 0 | Ingest | `news-scrape` | free | `scrape()` per enabled source, with a per-source timeout. Upsert; drop items whose outlet domain is disabled |
| 1 | Normalize | `news-scrape` | free | Canonical publisher URL, `outlet_domain`, `text_availability`, `content_hash`, boilerplate strip, trust tier |
| 2 | Full text | `news-fetch` | free (HTTP) | `fetchFullText(url)` for new articles with no body (§6.4) |
| 3 | Rules | `news-ai` | free | Sponsored, paid obituaries, community Q&A/classifieds, service boilerplate |
| 4 | Wire / mirror collapse | `news-ai` | free | Same URL, same `content_hash`, or identical normalized title within 48h → `duplicate_of_id`; **copy enrichment from the canonical instead of calling the LLM** |
| 5 | Enrich | `news-ai` | ~$0.0019 | One LLM call (three prompt modes: newsroom/primary, community, agenda; §12.1) |
| 6 | Relevance gate | `news-ai` | free | Buncombe `local_relevance` from four signals (below) |
| 7 | Embed | `news-ai` | ~0 | `gemini-embedding-001`, 1536-d, `RETRIEVAL_DOCUMENT`, over `what_happened` + entity names |
| 8 | Cluster | `news-ai` | $0.0003/confirm | Candidates → corroborated auto-attach → LLM confirmation → new story (§2). Community posts attach as discussion (§4) |
| 9 | Summarize | `news-ai` | $0–0.002 | Single-article story: the validated enrichment headline, dek and summary (free). Multi-article: incremental synthesis (§2.6). Stories with 2+ community posts get a `community_summary` (§4) |
| 10 | Rank, index, link | `news-ai` | ~0 | Stored `news_score` and Top set (§8.3–8.4), FTS vector, story embedding, links to events (§8) |

### Notes on stages 1–4

**Normalize.**
- Store the **publisher** URL and domain for aggregator items. Google News redirects are decoded; Reddit link posts carry the outbound URL.
- `outlet_domain` is what takedown keys on.
- Strip per-source boilerplate before hashing and embedding. City press releases share an "Asheville Parks & Recreation…" intro and footer, which pushed two unrelated City items to 0.959 similarity in the prototype.

**Rules first** (01: a free path before any LLM). Rules decide only the certain cases:
- **Sponsored:** paths like `/sponsored/` or `/brand-studio/`, or categories like "Sponsored" or "Paid Post".
- **Paid obituaries:** Legacy.com or an "Obituaries" category.
- **Community skips:**
  - flair/category or title patterns for questions, recommendations, classifieds, and lost & found;
  - `[removed]` or `[deleted]` bodies.
- **Service boilerplate:** "FIRST ALERT" forecasts, "How to watch", lottery, "property transfers". These are flagged `is_brief` and still enriched.

**Wire and mirror collapse.**
- The prototype held one Gray TV wire story on 10 out-of-market stations, and the Citizen Times story mirrored on AOL. Identical normalized titles within 48h are one origin.
- Enrich the canonical once (in-market outlet first, then the earliest) and copy the result to the copies.
- Count the group as **one** outlet for coverage.
- **Merge before remove** (the event-pipeline lesson):
  - the canonical gap-fills image, dek, author and full text from its copies;
  - it keeps the earliest `published_at`;
  - copies stay live as sources with `story_role='duplicate'`, and the UI says "also carried by 9 stations".

### The Buncombe relevance gate

`local_relevance` is a number from 0 to 1 (the field 03 asked for). A story is visible when it is at least **0.6**. It implements S1 literally: regional or statewide items appear **only when Buncombe itself is the subject**. The four signals:

1. **LLM category** (enrichment `buncombe`):

   | Category | Score | Meaning |
   |---|---|---|
   | `core` | 1.0 | About a place, institution or person in Asheville/Buncombe |
   | `affects` | 0.5 (below the gate) | A regional or state item that names Buncombe among others, or plainly covers it (a WNC-wide flood warning). Per S1 it shows only if signal 2 or 4 lifts it |
   | `mentions` | 0.2 | Asheville in passing ("…like Asheville") |
   | `none` | 0 | |

   Categories, not floats, because LLMs are poorly calibrated on floats.
2. **Gazetteer: Buncombe is prominent.** An unambiguous Buncombe term in the **headline, dek or `what_happened`** lifts the score to 0.8: Buncombe is the subject. A match only in body `places`/`entities` lifts `none`/`mentions` to 0.5 and flags the item for the relevance eval. Terms:
   - towns and neighborhoods (§5.2);
   - landmarks and institutions (North Fork reservoir, Bee Tree, UNCA, A-B Tech, Mission Hospital, named high schools, major roads).

   Example: "Thunderstorms with marble-sized hail in Buncombe and Henderson counties" passes; "Two years after Helene, recovery remains unfinished across WNC" doesn't, unless its `what_happened` centers on Asheville.

   Prototype evidence:
   - The LLM's old geo field and the gazetteer each caught about 148 of 226; the union was **163**.
   - The gazetteer rescued about 11 items the LLM had filed as "WNC": the Arden plane crash, the BCS superintendent, the Swannanoa sidewalk money, North Fork water, the Buncombe hail.
   - The one false hit was "Oakley" matching a Guilford County **surname**. So ambiguous terms (Oakley, Alexander, Emma, Shiloh) match only through LLM-extracted places.
   - These counts come from a looser WNC-scoped prompt. The new Buncombe-specific prompt should itself catch most of what the gazetteer rescued, leaving the gazetteer as a backstop.
3. **Outlet prior** (`news_sources.geo_prior`):
   - `buncombe` (City, County, MX, Watchdog, the Citizen Times, 828newsnow, r/asheville): headline-only items default to 0.7 unless the LLM says `none`.
   - `regional` (WLOS, BPR, SMN, CPP): no default.
   - `mixed` (FOX Carolina, WYFF, WSPA, where "Upstate" means SC): an explicit Buncombe signal is required.
4. **Story propagation.** A story's relevance is the **max over its members**. "Two injured after plane crashes in field" (WYFF, headline only) inherits Buncombe from WLOS's "…plane crash in Arden field".

Per outlet in the prototype: FOX Carolina 1 of 20 survives (the Buncombe County Schools superintendent); BPR 3 of 15 (its statewide trout, drought and I-77 stories and the WNC-wide FEMA-funding story drop out); Carolina Public Press 0 of 5.

### What happens to each kind of item

Everything is stored; this table only decides what the feed shows.

| Kind | Enriched | Shown | Notes |
|---|---|---|---|
| Local news, analysis | yes | yes | |
| Government press release | yes | yes, primary source (⌂) | Promotional adjectives stripped from facts |
| Agenda / action agenda | yes (agenda mode) | as a meeting story, plus item links (§7) | Also becomes a civic-meeting **event** row |
| Opinion, letter, column | yes | yes, labeled | Never a fact source for summaries |
| Sponsored | no (rule) | never | |
| Paid obituary | no (rule) | never | Deaths of public figures reported as news are shown |
| Crime / incident (`is_incident`) | yes | collapsed daily "Public safety" row (03) | AI text never names a private person accused of a crime |
| Service (`is_brief`) | yes | collapsed "Briefs" row (03) | Severe weather is not a brief |
| Not Buncombe (`local_relevance < 0.6`) | yes | no | Still stored and searchable by admins |
| Community: question, classified, personal | no (rule) or yes (fallback) | never | `exclude_reason` recorded |
| Community: link post | yes | "Community discussion" on the linked story | §4 |
| Community: local report or discussion | yes | Discussion on a matching story; otherwise a community-only story if it clears the bar, else not shown | §4. Never when `exclude_reason` is set |
| Roundups ("things to do this weekend") | yes | no, as a story | `scope='multi'`; event discovery later |

---

## 2. Story clustering in depth

### 2.1 What a story is

- **Article:** one URL.
- **Duplicate group:** wire copies and mirrors, collapsed without an LLM.
- **Story:** one specific real-world matter **plus its later developments**. Examples:
  - an incident (the Arden plane crash);
  - a decision process ("$4.7M homelessness program amendments": hearing → comment period → vote);
  - an appointment (Jackie Stepp named police chief);
  - a bounded event (the Biltmore Championship).

  **This is the feed unit.**
- **Storyline** (phase 3, 03's "Storylines"): a named saga made of stories, e.g. I-40 through the Gorge, Mission/HCA, Helene recovery money.
- **Topic:** Helene Recovery, Housing & Growth. **Never a story.**

The test: a reader following one article would call the other **an update to the same thing**, not "another thing about the same subject".

### 2.2 What the prototype showed

The corpus was 226 items, with 24 hand-labeled multi-article stories plus traps:
- Dolly the bear vs. the council's bear-conflict hearing;
- "Dolly Parton Day";
- about 8 separate "Two years after Helene" pieces;
- 25 Biltmore Championship pieces;
- two unrelated HCA/Mission stories.

| Approach | Best B-cubed F1 | Notes |
|---|---|---|
| Headline embedding, one threshold | 0.914 @ 0.90 | At 0.85: 119 false-positive pairs; pairwise recall 0.39 |
| Title + lead embedding | 0.899 | The body adds boilerplate noise |
| Title + lead, `CLUSTERING` task type | 0.888 | **Worse.** It pulls thematic neighbours together (bear hearing ↔ Dolly: 0.887 → 0.946) |
| **AI `what_happened` + entities** | 0.913 @ 0.88 | Better separation. At 0.82 it keeps more same-story pairs than headlines do at 0.85 (recall 0.42 vs 0.39) with **2.4x fewer false pairs** (49 vs 119) |
| + auto-attach only with rare person/matter corroboration | 0.878 | Precision 0.994, **0 real false merges**, but only 5/24 recovered |
| **+ LLM confirmation, `minimal` effort** | **0.942–0.967** | 19/24 recovered, 1 real false merge, $0.045 per 157 calls |
| + LLM confirmation, `low` effort | 0.962–0.966 | 21–22/24 recovered, 2 real false merges, $0.055 |

Takeaways:
1. **Retrieve with embeddings, never decide with them alone.**
2. **Embed the AI's neutral statement, not the headline.** It removes outlet voice and keeps the specifics.
3. **Use `RETRIEVAL_DOCUMENT` everywhere.** One vector serves clustering, search and the event links.
4. **Only rare person/matter entities are safe corroboration.** Templated series titles ("BCSO request for information: …") fool title overlap, and org/place entities recur across unrelated stories.
5. **The failures that repeated across runs were overviews** (anniversary packages, meeting recaps) absorbing specific stories. That calls for a structural rule (§2.5), not a threshold.

### 2.3 The algorithm

It runs online, in `published_at` order, over live, enriched, embedded articles with `story_id IS NULL`. **Every query here is bounded by `published_at`** (01: news rows never expire).

**Candidates:**
- **(a) Semantic.** The top 20 articles by cosine among live articles from the last **10 days**, grouped by story, scored by best member. This is an exact scan over the `published_at` btree, about 1–3k rows. No ANN index is needed on articles.
- **(b) Entity.** Stories with `last_article_at` in the last **90 days** that share a rare person/matter `entity_key` (document frequency ≤ 4 over the last 30 days; GIN index).
- **(c) Storyline.** In phase 3, the latest stories of any storyline whose aliases match.

Keep the top 4 by score, with (b) and (c) candidates always included.

**Decision ladder:**
1. `sim ≥ 0.88`, **and** a shared rare person/matter entity (or title Jaccard ≥ 0.75, which catches wire rewrites), **and** both are `scope='single'` → **auto-attach**. This covered about 11% of articles in the prototype, with no false merges.
2. Any candidate with `sim ≥ 0.72`, or any (b)/(c) candidate → **LLM confirmation** (§12.2). A multiple-choice question over at most 4 candidates.
3. Otherwise → **new story**.

Each decision writes `cluster_method`, `cluster_score` and `cluster_reason` on the article, plus a row in `news_cluster_log`. The thresholds are the prototype's calibration; the eval harness (§9) recalibrates them on 2 weeks of real data.

### 2.4 Long-running stories

- **A council vote.**
  - Enrichment records a **matter** entity ("$4.7M homelessness prevention program") and `next_milestone` ("public comment through Oct. 2").
  - Source (b) keeps the story reachable for 90 days.
  - The prompt defines later developments as the same story.
  - Agenda items attach to it and set its `whats_next` (§7).
- **I-40 Gorge (a saga).** Each development is its own story, and the stories are grouped by a **storyline**. Source (c) offers the storyline's latest story, and the LLM decides "same development" or "new".
- **Helene recovery.** A topic and the flagship storyline, never a story.
- **Dormancy.**
  - A story with no development for 30 days leaves source (a) but stays reachable through (b) and (c).
  - The prompt sees the time gap, and prefers `new` + `related` beyond 90 days unless it's clearly the same process (a verdict in the same trial).

### 2.5 Guards against over-merging

A wrong merge corrupts a cited summary. A miss is cheap: two rows, a `related` link, and a merge later.

1. **The scope rule.** Enrichment returns `scope: single | multi`. `multi` covers meeting recaps, anniversary "state of" pieces, roundups, and Q&A columns such as the Watchdog's Answer Man.
   - `multi` never auto-attaches.
   - `single` never joins a story whose lead is `multi`; it gets `related` instead.
   - `multi` + `multi` merge only for the same occasion (the same meeting date).

   This targets both recurring false merges. **Not yet verified.** It's the first test for the eval harness.
2. **Corroboration uses only rare person/matter entities.**
3. **No chaining.** Similarity is measured to members from the last 10 days only.
4. **The prompt says "when unsure, choose new"** and names the traps.
5. **Size alarm.** A story gaining more than 15 articles in 7 days, or with more than 4 distinct matter entities, goes to `cron_job_runs` and Slack for review.
6. **Manual decisions stick.** `cluster_locked` is the news `dedup_skip`.

### 2.6 Summaries and incremental updates

**Every displayed headline, dek and summary is ours** (S2; decisions D13; 03 v2 §9). The outlet's own headline appears only as the text of the link to that outlet. Wire copies and mirrors count as one article.

| | Single-article story | Multi-article story |
|---|---|---|
| Headline | The enrichment `headline`: neutral, ≤ 12 words and ≤ 90 characters, no clickbait, questions or quotes. **No extra LLM call** | Synthesized headline, same rules. Changes only on `material_change && headline_stale` |
| Dek | The enrichment `dek`: ≤ 30 words, the core development | `whats_new`: ≤ 30 words, the latest development |
| Summary | The enrichment `summary`: ≤ 2 sentences, ≤ 45 words, each sentence cited to that article's facts | Synthesis: 2–4 sentences, ≤ 80 words, sentence-level cites across articles |
| Key facts | none | ≤ 5 as label/value (Where, When, Cost, Vote, Deadline…) |
| Developments | the article itself | a dated one-line timeline |
| "Read at X" | `lead_article_id` (below) | `lead_article_id` |
| Per article | `full_story_has` | `full_story_has` for each article in the reporting list |

**`lead_article_id`** is the most complete **original** reporting. It drives the "Read at X" pill on every row. The ranking:
1. newsroom original reporting (not a wire copy, mirror or aggregator rewrite);
2. then a primary source (a city release that nobody has reported on yet);
3. within a tier, the most complete: `full` text beats `excerpt` beats `headline`, then more extracted facts;
4. ties go to the **free** outlet over a paywalled one, then the earliest.

Recompute it when a member attaches.

**`full_story_has`** is ≤ 25 words, written during enrichment from the full text. It names what the article contains **beyond** its own summary **without stating those facts**, e.g. "What each resident proposed, the state's count of homes Dolly entered, and the wildlife agency's reasoning". It is **null** when the article is paywalled or headline-only.
- The validator rejects digits (years excepted), quotation marks, and any 5+ word overlap with the article's facts. That keeps it a pointer, not a spoiler.

**Informing without substituting.** These are design rules, and the validators enforce most of them.

1. **The "what" layer only:** who, what, where, when, status, what's next. Never:
   - the why/how in the reporter's depth;
   - background paragraphs;
   - anecdotes or quotes (03: no quotes);
   - investigative evidence detail;
   - lists. "Where to celebrate Dolly Parton Day" is summarized as "The Citizen Times lists N places…", never the list.
2. **Budget:**
   - 45 words for a single article, which is about 5% of an average 850-word story, and 80 for a multi-article story;
   - at most 3 facts drawn from any one source article per summary;
   - at most 5 key facts.
3. **Copy guard:** no run of 9+ words shared with any source text.
4. **Attribution everywhere:** every sentence shows outlet chips. On the story page, "Read the reporting" sits directly under the summary: one full-width link-out per outlet, each with its `full_story_has` line.
5. **Paywalled outlets:** only publicly served text exists to use (S5: no circumventing paywalls). A paywalled article's facts can't exceed its public dek or lede, and its `full_story_has` is null.
6. **Measure it.** Record outbound clicks per story view from day one. If readers stop clicking out, the summaries are too complete: tighten the word budget first.

**Trigger.**
- Only **reporting** (`newsroom`) and **official** (`primary`) articles create developments (03 v2).
- Attaching such a `member` sets `synth_needed_at` on the story.
- These never set it and never re-file the story:
  - duplicates;
  - opinion;
  - community posts;
  - extra coverage of an already-known development (`material_change=false`).
- One call per dirty story batches all of its new articles.

**Input.** The current story state, plus the new articles' **facts** (not their text), each labeled with outlet, date, type and availability.

**Output** (§12.3):
- `headline`, `summary[]` with cites;
- `key_facts[]`, `new_developments[]`, `whats_new` (the dek);
- `material_change`, `headline_stale`;
- `discrepancies[]`, `phase`, `next_milestone`, `importance`, `concepts[]`.

**"What's new since you last looked," with no per-user LLM:**
- `material_change=false` (another outlet confirming, a rewrite): the summary stays, the outlet count goes up, and `last_development_at` **does not move**, so repeats never re-float a story.
- `material_change=true`: developments are appended, `summary_version` bumps, `last_development_at` is set, and a revision row with a change note is written.
- The client compares `newsSeen{storyId: summaryVersion}` (03).

**Headline stability.** The headline changes only when `material_change && headline_stale`; the prototype's naive loop churned it on every update. When a single-article story gains its second article, the synthesized headline replaces the enrichment one: that counts as a material change. Slugs are permanent even when the headline changes (§8.5).

**Compaction.** Summary-of-summary drifts. Do a full re-synthesis from facts (at most 8 articles: primary sources first, then the most recent, then the most independent outlets) when any of these happen:
- 5 incremental updates since the last full one;
- the article count doubles;
- a cited source dies or is purged;
- an admin asks.

### 2.7 Splits, merges, phase

- **Merge.**
  - Proposed by the nightly audit (a shared rare matter entity and sim ≥ 0.85) and confirmed by the same LLM prompt.
  - Merge before remove: move the articles, union links, keep the earliest `first_published_at` and the max importance.
  - **The keeper is the older story**, so the id people shared first survives.
  - The loser keeps its row, id and slug with `state='merged'` and `merged_into_id` (a permanent redirect, §8.5). The keeper gets a full re-synthesis.
- **Split.**
  - The nightly cohesion audit covers stories with 5+ articles: it flags members whose max-sim to every other member is below 0.70, or asks the LLM whether this is one matter.
  - v1 **reports only**; an admin or script runs the split: move, lock, set `split_from_id`, mark both stories dirty.
  - **The original id and slug stay with the part that keeps `lead_article_id`**, so shared links still land on the main thread. The parent's page links to the split-off stories ("Part of this story continues here").
- **`phase`** (renamed from status, so it isn't confused with `state`):
  - `developing`: a development in the last 72h, or an open `next_milestone` within 14 days;
  - `settled`: otherwise.

  An internal `dormant` value (30 days quiet) removes the story from candidate source (a).

  `phase` is internal only: the UI shows no "Developing" tag (S15).

### 2.8 Ordering and determinism

- Clustering is sequential in `published_at ASC`: about 65 confirmations a day at 2–3s each.
- Enrichment runs newest-first, 8 in parallel.
- gpt-5-mini accepts no `temperature`, and repeated runs varied (F1 0.942 vs 0.967). So the eval harness caches answers by prompt hash and judges prompt changes on 2+ runs.

---

## 3. Grounding and trust

**1. Facts carry evidence, and the server checks it.**
- Enrichment returns up to 6 facts, each `{text, evidence, attribution, kind}`. `evidence` is a quote of at most 20 words, copied character-for-character.
- Normalize quotes and whitespace, then require a substring match against the stored title, dek or body. Failures are dropped and counted.
- Prototype: 21 of 582 facts (3.6%) failed, and **none was fabricated**. All were formatting:
  - the model copied the input's "Headline:" or "Dek:" labels;
  - it joined two spans with "…";
  - it wrote "NCWRC" for the full name.

  Production fixes: strip labels, split on ellipses, and tell the prompt. The prompt also forbids **meta-facts** ("The item is titled X"), which headline-only items produced.

**2. Every summary sentence cites fact ids** (`"a25.1"`), which map to article ids for 03's `{text, articleIds[]}`.

**3. Validators run on every summary. A failing sentence is dropped, never rewritten.**
- At least one valid cite per sentence.
- **Numbers and dates must appear in a cited fact.**
  - Normalize "thirteen" = 13 and "$4.7M" = "$4.7 million".
  - **Ignore digits inside outlet names.** The prototype's naive version dropped good sentences over "828" (from 828newsnow) and "Thirteen", and caught nothing real.
- **Names** (v2): must appear in the cited facts or entities.
- **Copy guard:** 9+ words shared with source text.
- **Caps:** 45 or 80 words, at most 3 facts per source, no quotation marks.

If nothing survives, keep the previous version and back off (the events `ai_attempts` pattern). Each revision stores its `validation_report`.

**4. Conflicts.**
- Disagreeing sources are stated with attribution in `discrepancies[]`, never resolved by the model.
- An official figure that replaces an earlier one reads "up from X".
- `kind='official'` facts from a primary source outrank reporting on official matters (vote counts, budgets). They don't outrank reporting on the government's own performance.

**5. Tone and attribution.**
- Neutral, no speculation, and allegations stay allegations.
- **Attribute** single-outlet claims, allegations, estimates and disputes.
- **State plainly** facts that 2+ independent outlets confirm or that come from the official source of that fact. "Attribute everything" read badly in the prototype, with every sentence starting "X reported that".

**6. Trust tiers** (on `news_sources`):
- **`primary`**: government or institutions about themselves. The ⌂ chip, "the city said", self-praise stripped.
- **`newsroom`**: outlets.
- **`community`**: Reddit and future groups. Never a fact source for a newsroom story (§4).

**7. Prompt injection.** Articles and posts are untrusted input.
- Output is schema JSON; there are no tools.
- Facts must quote the input.
- Community text is fenced in its own prompt mode.

At worst, an injected instruction produces facts that fail the evidence check.

**8. Safety filters.** Azure's content filter hard-blocked 2 of 228 enrichment calls, both legitimate crime headlines (sexual offences against minors). Fall back to Gemini 2.5 Flash with safety set to block only high-severity content, and count `content_filtered` and `fallback_used`.

---

## 4. The community tier (Reddit and later others)

A distinct trust tier (`news_sources.trust_tier='community'`). Its purpose: show what locals are discussing, catch things newsrooms haven't covered, and point readers to the conversation. **It is never a factual source in synthesized text.**

**The source.**
- Reddit covers r/asheville, r/BlackMountain and the Buncombe slice of r/wnc (`lib/news/sources/reddit.ts`, decisions D8).
- Today it arrives as one `localOnly` Atom feed with **no score or comment counts**. An agent is evaluating **Scry** as a replacement that would supply `engagement {score, comments}`.
- **The article shape is the same either way.** Everything below works with or without engagement.
- Link posts currently put the outbound URL in `contentText` ("Link: …"). **Add `linkedUrl?: string` to `ScrapedArticle`.**
- Engagement changes over a post's first day or two. The upsert refreshes the `engagement` jsonb without re-enriching, because `content_hash` covers only the title and body.

**Per-post fields** (community-mode enrichment, §12.1; 03 v2 §9):

| Field | Rule |
|---|---|
| `community_type` | `local_report \| discussion \| link_to_news \| event_promo \| question \| classified \| personal \| other` |
| `paraphrase` | ≤ 20 words, neutral, attributive ("A poster reports smoke near…"). **No private names, no unverified figures, no claims about named people.** The validator rejects digits (dates and times excepted) and any `person` entity not marked `public` |
| `is_hazard_report` | A fire, flood, road closure, outage, gas leak or downed tree: time-sensitive |
| `exclude_reason` | `private_individual \| accusation \| stigmatizing \| classified \| out_of_area \| low_signal \| removed`. **Any value means the post is never shown or linked anywhere.** It is still stored and still counts toward buzz only if the reason is `low_signal` |
| `important_reason` | `civic \| public_safety \| public_health \| major_local_change \| null`. The AI half of the bar (S14): set only when the post matters to Buncombe residents beyond the thread. Complaints, asks and chatter get `null` however popular they are |
| `attached_story_id` | The API field: the **newsroom** story it's attached to, or null (it's in a community-only story if it cleared the bar, otherwise not shown). Internally this is `story_id` plus the story's `tier` |
| `bridge_event_id` | Set when the post's `event` mention matches an upcoming event (§8.1, method 2). It seeds the community-only story's related events ("Go in person") |
| `author_key` | Salted hash of the username, used for distinct-author counts. **Raw usernames are not stored** |

**Flow:**

1. **Rules first.** Questions, recommendations, classifieds, lost pets, photo-only posts, one-liners and removed posts get an `exclude_reason` with no LLM call. That was about 16 of 25 posts in the prototype week.
2. **Link posts are deterministic, with no LLM.**
   - If `linkedUrl` is an article we have, attach to its story with `story_role='community'`.
   - If it's a news domain we don't have, insert a **discovered article** (`source='DISCOVERED'`, outlet taken from `news_sources` by domain). It goes through `news-fetch` and the whole pipeline.

   This is how the community fills scraper gaps. In the prototype, "Interim no more: Jackie Stepp named Asheville's chief of police" attached straight to the police-chief story.
3. **Local reports and discussion** are enriched in community mode, then go through normal candidate retrieval and LLM confirmation.
   - **If they match a newsroom story:** attach with `story_role='community'`. They never count toward `article_count`/`outlet_count`, never trigger synthesis, and **never re-file the story**: `last_development_at` doesn't move.
   - **If they don't match:** they join or start a `tier='community'` story (grouping several posts about the same fire), with `state='pending'` and reason `below_bar`.
4. **The bar (S14).** This is how a locally-discussed topic newsrooms haven't covered gets into the feed. A community-tier story goes `live` when:
   - it contains no post with an `exclude_reason`, and its type is `local_report` or `discussion`;
   - **and** it clears the bar:
     - **engagement:** a post with score ≥ 25 or comments ≥ 15 (D25b, a starting point to retune once real scores come in), or
     - **the AI rates it important:** a post has `important_reason` set. `is_hazard_report` plus a matching official alert also counts.
   - **At most 3 go live per filing day**, highest buzz first. The rest stay `pending` and are never shown.

   Without engagement (today's RSS, D8), only the AI half of the bar works.

   On display (03 §5):
   - It is an **ordinary story row**, in the same design as every other story. Its headline and summary are **attributive**: "r/asheville posters report a fire at Smokey Mountain Supper Club". They are built from the posts' paraphrases, nothing is stated as fact, and the summary label says "not verified". The row's button reads "Read on r/asheville ↗".
   - Its `news_score` is capped at 14 (D25c), so it never enters Top, the short version or the digest.
   - It stays live like any story and ages out of the feed with its filing day. There is no expiry.
   - When a newsroom or primary article **does** join, it **promotes** to a normal newsroom story. The summary is re-synthesized from newsroom facts only, and the posts become its Community discussion.
5. **`community_summary`** is written for stories with 2 or more attached community posts.
   - It is ≤ 30 words of "what locals are saying", in one small gpt-5-mini `minimal` call (~$0.0003) that reads **only the posts' paraphrases**.
   - It is attributive, with no names and no figures.
   - It is regenerated at most once per run, when a new post attaches.
6. **Buzz** (0–10, recomputed each run over a 72h window; older posts count at 0.5):

   ```
   w(post) = 1 + log2(1 + score)/3 + log2(1 + comments)/2   # engagement present
   w(post) = 1 + 0.5 · (post is from a new distinct author)  # engagement absent
   buzz    = min(10, Σ w(post))
   ```

   Examples: one thread with 200 upvotes and 150 comments is about 7; a small thread (5 upvotes, 3 comments) is about 3.
   - It orders the day's community-only stories for the cap of 3.
   - It adds at most +2 to `news_score` (§8.3; Decision 6).

**Never a fact.** Synthesis prompts for newsroom stories never receive community text. Community content appears only as:
- paraphrases;
- `community_summary`;
- buzz;
- attributive, labeled community-only stories above the bar.

---

## 5. Taxonomy

### 5.1 Topics

These are single-sourced like `TAG_CATEGORIES`/`TAG_GUIDANCE` in `lib/config/newsTopics.ts`, which feeds both the prompt and the UI. The list is 03's 12, with **"Only in AVL" made a score-driven flag and Sports taking its slot.** The prototype week had about 50 sports items (22 UNCA athletics releases and 27 Biltmore Championship pieces).

| Topic | Kicker | Guidance |
|---|---|---|
| Government & Politics | Civic | Council, commission, town boards, elections, budgets, ordinances, utilities and public services |
| Housing & Growth | Growth | Housing, homelessness, zoning, development, real estate |
| Helene Recovery | Helene | Anything materially about Helene recovery. Co-occurs with other topics |
| Environment & Outdoors | Outdoors | Rivers, parks, trails, the Parkway, wildlife and bears, drought |
| Schools & Kids | Schools | BCS and ACS, charters, childcare, UNCA, A-B Tech, youth |
| Business & Food | Business | Openings and closings, restaurants, breweries, jobs, tourism |
| Arts & Culture | Culture | Music, arts, festivals, history, media |
| Public Safety | Safety | Crime, courts, police, fire, EMS, emergency management |
| Health | Health | Mission/HCA, Novant, AdventHealth, public health |
| Getting Around | Roads | Roads, I-40/I-26, transit, the airport, greenways, parking |
| Weather | Weather | Severe weather, floods, alerts. Routine forecasts are `is_brief` |
| Sports | Sports | UNCA, high school, minor league, tournaments |

**Flags:**
- `is_incident` (the Public safety row);
- `is_brief` (the Briefs row);
- `is_opinion`;
- `only_in_avl` (1–10, the news twin of `scoreAshevilleWeird`), with the daily slot at ≥ 8.

### 5.2 Places (Buncombe only)

The canonical areas extend `lib/config/zipNames.ts` to Buncombe. The Henderson County towns (Fletcher, Hendersonville, Flat Rock, Mills River) are out of scope for news. A gazetteer maps fine-grained names to areas:

| Area (filter value) | Neighborhoods and aliases |
|---|---|
| Downtown | South Slope, Lexington Ave, Pack Square, Southside, East End/Valley Street |
| West Asheville | Haywood Road, River Arts District, Burton Street, Emma, Deaverview, Pisgah View, Malvern Hills |
| North Asheville | Montford, Five Points, Grove Park, Norwood Park, Beaver Lake, Kimberly, UNCA |
| East Asheville | Kenilworth, Haw Creek, Oakley, Beverly Hills, Tunnel Road, Chunns Cove, Riceville |
| South Asheville | Biltmore Village, Shiloh, Biltmore Park, Royal Pines, Gerber Village, Long Shoals, Skyland |
| Black Mountain | incl. Montreat Road, Ridgecrest |
| Montreat, Biltmore Forest, Weaverville, Woodfin | |
| Swannanoa | incl. Bee Tree, North Fork |
| Fairview · Candler · Leicester · Arden · Enka · Barnardsville · Alexander | |
| Buncombe-wide | County-level items with no single place |

- The model emits places "as commonly written"; the server normalizes them through the alias table to `{neighborhood?, area}`.
- **Ambiguous names** (Oakley, Alexander, Emma, Shiloh) are accepted only when the LLM extracted them as places, never from raw text.
- `buncombe` (§1) replaces the old WNC-wide `geo_scope`.

### 5.3 Entities

**Types:** `person | org | place | animal | event | matter`.
- `animal` and `event` exist for search disambiguation (03 v2). This week's data has "Dolly" the bear (`animal`) and Dolly Parton Day (`event`) on different stories, and Flock (`org`, the camera company) and Flocktoberfest (`event`).
- **Matter** (a project, program, ordinance, lawsuit or incident) is what makes clustering and storylines work.
- For clustering corroboration, rare `person`, `animal`, `event` and `matter` keys all count. `org` and `place` never do.

**Detail per entity type:**
- `person` entities carry `public: boolean`: true for an official, public figure or named spokesperson. The privacy validators use it: paraphrases and AI text may name only `public` people, and never a private person accused of anything.
- The key is `type:slug`, e.g. `matter:i-40-pigeon-river-gorge-repair`, `animal:dolly-bear`.
- Store `entities jsonb` and `entity_keys text[]` (GIN) on articles and stories. No entity table until entity pages ship.
- Keep a small alias map for local abbreviations: APD, BCSO, BCS/ACS, MAHEC, NCDOT, NCWRC, MSD.

### 5.4 Concept labels (for search explanations)

Enrichment returns `concepts[]`: 3–6 short, lowercase, reusable concept phrases per article, e.g. "black bears", "wildlife conflict", "euthanasia policy" for Dolly. A story's concepts are the 6 most frequent across its members, refined by synthesis.

The concepts power 03's "≈ related: x, y" line:
- `news_concepts` holds `label` (pk), an `embedding`, and `story_count`. Each new label is embedded once, which costs almost nothing.
- When semantic search returns a story that didn't match on keywords, show the 2 story concepts whose embeddings are closest to the query embedding. "bears" → "≈ related: wildlife conflict, black bears".
- The labels double as facets for follow-up search.

---

## 6. Data model

Follows the repo conventions: Drizzle, uuid primary keys, timestamptz, and the events backoff columns. **No articles in `events`** (01). Table names use the `news_` prefix; the `newsletter_` prefix is taken.

### 6.1 One state column (01's lesson)

`deduped_at`/`dead_at` is already missed in 4 places on the events side. So each news table has **one** `state` column with a CHECK constraint, plus `state_reason` and `state_changed_at`. Restore is `UPDATE … SET state='live'`. Every feed, search and candidate query filters `state = 'live'`; `lib/news/db.ts` exports it as a helper, and there is also a `live_news_stories` view for ad-hoc SQL.

| Table | `state` values | Notes |
|---|---|---|
| `news_articles` | `pending` (awaiting enrichment) · `live` · `skipped` (rule verdict) · `dead` (404/410, re-probed) · `hidden` (admin, retracted, privacy) · `purged` (takedown) | Duplicates stay `live` with `story_role='duplicate'`. Not-Buncombe articles stay `live`, because relevance is a **story** property |
| `news_stories` | `pending` (not yet visible: below the relevance gate, or community below the bar) · `live` · `merged` · `hidden` | **The pipeline recomputes story `state` whenever inputs change**, so the gate, corroboration, takedown and merge all collapse into the one `state='live'` filter |

### 6.2 `news_sources` (runtime switches and takedown, no deploy)

The code registry (`NewsSourceModule[]`) says **how** to fetch. This table says **whether**, and how to trust. It is keyed by **outlet domain**, so a takedown also covers that outlet's items arriving through Google News or Reddit links.

| Column | Notes |
|---|---|
| domain (pk) | e.g. `citizen-times.com`, `ashevillenc.gov`, `reddit.com`, `news.google.com` |
| name | Display name |
| module_key | null for outlets that only arrive through aggregators |
| trust_tier | `primary \| newsroom \| community` |
| geo_prior | `buncombe \| regional \| mixed` (§1) |
| enabled | false = don't run the module, and drop incoming items for this domain from any module |
| purged_at, purge_reason, purge_requested_by | Set by the purge action |
| fetch_full_text | Per-outlet switch for the `news-fetch` pass |
| paywalled | Default for the outlet |
| contact, notes, updated_at | |

- `news-scrape` reads the table at the start of each run.
- Upsert drops items whose `outlet_domain` is disabled.
- `/news/sources` (03) renders from this table.

### 6.3 `news_articles`

| Column | Notes |
|---|---|
| id; short_id (unique, never reused); source, source_id (unique pair); url (unique); outlet_domain (fk → news_sources) | |
| trust_tier, is_primary_source | Copied from the source at ingest |
| title, dek, content_text, content_hash, text_availability (`full \| excerpt \| headline`), paywalled, author (for community sources: the `author_key` hash), image_url, source_categories[] | `title` and `dek` are the outlet's own, shown only as link text. **Full text is kept forever** (S2); only a takedown purge removes it |
| published_at, source_updated_at, revised_at, first_seen_at, last_seen_at, created_at, updated_at | `revised_at` is set when `content_hash` changes after first ingest, which re-queues enrichment |
| linked_url | Community link posts |
| meeting jsonb | `{body, date, phase: 'draft'\|'agenda'\|'actions'}` for agenda sources (§7) |
| engagement jsonb | From `ScrapedArticle.engagement`, when a source has it |
| **fetch:** fulltext_status (`pending \| fetched \| partial \| unavailable \| failed`), fulltext_attempts, fulltext_next_attempt_at, fulltext_fetched_at | Backoff like `ai_*` |
| **enrichment:** article_type, scope, buncombe, local_relevance real, topics[], places[], entities jsonb (typed, `public` on persons), entity_keys[], concepts[], what_happened, ai_headline, ai_dek, summary jsonb `[{text, factIds[]}]`, full_story_has, facts jsonb, importance, only_in_avl, is_incident, is_brief, private_person_accused, minor_involved, developing, next_milestone jsonb, event_mention jsonb, agenda_items jsonb | `ai_headline`, `ai_dek` and `summary` are what a single-article story shows |
| **community:** community_type, paraphrase, is_hazard_report, exclude_reason, bridge_event_id, author_key | §4 |
| ai_model, ai_prompt_version, ai_raw jsonb (only on failure), ai_attempts, ai_last_attempt_at, ai_next_attempt_at, enriched_at | |
| embedding vector(1536), embedded_at | Same space as `events.embedding`. **No HNSW index**: clustering scans a `published_at` window exactly |
| story_id, story_role (`lead \| member \| duplicate \| opinion \| primary_source \| community`), duplicate_of_id, cluster_method, cluster_score, cluster_reason, cluster_locked, clustered_at | Edge metadata lives on the article (one story per article). History is in `news_cluster_log` |
| state, state_reason, state_changed_at | §6.1 |

### 6.4 `ScrapedArticle` / `NewsSourceModule` contract changes

1. **Widen `fetchFullText`.** A page fetch reveals more than the body, and scout-civic has already hit this limit. Keep it backward compatible:

   ```ts
   export interface FullTextResult {
     text: string;
     canonicalUrl?: string;   // resolves aggregator redirects
     publishedAt?: Date;      // the page's own dates beat the feed's
     updatedAt?: Date;        // corrections and updates for the timeline (03)
     author?: string;
     categories?: string[];
     imageUrl?: string;
     paywalled?: boolean;     // text is only the public lede
   }
   fetchFullText?(url: string): Promise<string | FullTextResult | undefined>;
   ```

   How results are handled:
   - `undefined` = unavailable (terminal);
   - a throw = transient (backoff);
   - fields merge with the upsert policy: non-empty fills gaps, and a newer `updatedAt` sets `revised_at`.
2. **Add `linkedUrl?: string`** for community link posts.
   - Also **`publisher?: string`** (requested by the scouts) for aggregator items, so the pipeline gets the real outlet name without parsing it out of the title.
   - All four contract changes are accepted in principle and land in the source-cleanup pass.
3. **Add `meeting?: {body: string; date: Date; phase: 'draft' | 'agenda' | 'actions'}`** for agenda sources. Today the meeting date lives only in `sourceId` and the title (`council-2026-10-13-agenda`), and `publishedAt` is the posting time.

### 6.5 `news_stories`

| Column | Notes |
|---|---|
| id (uuid), short_id (8-char base32, unique, never reused), slug | Never change (§8.5). `slug` = `<words from the first headline>-<short_id>` |
| headline, dek | Always ours (§2.6) |
| summary jsonb | `[{text, factIds[], articleIds[]}]` |
| key_facts jsonb `[{label, value, articleIds[]}]`, developments jsonb `[{at, text, articleIds[]}]`, whats_next jsonb `[{date, label, sourceArticleId, eventId?}]`, discrepancies jsonb | 03's fields |
| tier | `newsroom \| community` (community-only until promoted) |
| phase (`developing \| settled`), scope | |
| topics[], places[], entity_keys[], local_relevance | Story-level: union, and max over members |
| is_incident, is_brief, only_in_avl, importance, importance_override jsonb, buzz, concepts[], community_summary | |
| **news_score** int, **top_day** date, **top_rank** int, **top_since** timestamptz, top_reason (`score \| floor \| forced`) | Stored and recomputed by `news-ai` (§8.3–8.4) |
| article_count, outlet_count (duplicate groups count once), community_count, has_primary_source, lead_paywalled, lead_article_id | `lead_article_id` rules in §2.6 |
| first_published_at, last_article_at, **last_development_at**, **filing_day** date | `filing_day` = the ET date of `last_development_at`. The feed files the story under it |
| embedding vector(1536) (HNSW), search_tsv (generated: headline + dek + summary + entity names + member headlines) | |
| summary_version, summary_changed_at, change_note | 03's "Summary updated 4:10 PM" |
| synth_needed_at, synth_updates_since_full, synth_attempts, synth_next_attempt_at, synth_model, synth_prompt_version | |
| related_story_ids[], storyline_id (phase 3), merged_into_id, split_from_id | |
| state, state_reason, state_changed_at, created_at, updated_at | §6.1 |

### 6.6 Supporting tables

- **`news_story_revisions`** (append-only):
  - `story_id`, `version`, `headline`, `summary`, `key_facts`, `change_note`;
  - `triggered_by_article_ids`, `validation_report`, `judge jsonb`;
  - `model`, `prompt_version`, `tokens_in`, `tokens_out`, `created_at`.
- **`news_story_events`:** `story_id`, `event_id`, `relation` (`milestone | subject | related`), `score`, `method` (`agenda | mention | semantic | llm | manual`), `created_at`, `removed_at`; unique pair. 03's `relatedEventIds` + similarity score.
- **`news_cluster_log`** (append-only): `article_id`, `from_story_id`, `to_story_id`, `method`, `score`, `reason`, `at`.
- **`news_concepts`:** `label` (pk), `embedding`, `story_count` (§5.4).
- **`news_story_redirects`:** `old_id` (pk), `old_short_id` (unique), `new_id`, `reason`, `created_at`. One row per merge, path-compressed (§8.5).
- **Later:** `news_storylines` (phase 3), and `news_meetings` / `news_agenda_items` (phase 2, §7).

### 6.7 Stored vs recomputed

| Stored | Recomputed |
|---|---|
| All AI output, embeddings, cluster decisions with reasons, revisions, validation and judge reports, event links, `last_development_at`, `news_score` and Top membership (for stability, §8.4) | `news_score` and Top (each `news-ai` run, and on purge or merge); `phase` (daily); story `state` (on every input change); story topics/places/relevance/concepts (on attach); buzz (each run); counts (verified nightly) |

**Storage (full text is kept forever):**
- full text is about 220 MB/year raw, **about 90 MB after TOAST compression**;
- article embeddings are about 210 MB/year (6 KB each, no index);
- story embeddings are about 65 MB/year, plus HNSW.

That is well within the Supabase plan. If size ever matters, the lever is `halfvec` for article embeddings (it halves them), not dropping text.

### 6.8 RLS

- **All news tables are deny-all for `anon`/`authenticated`**: RLS on with no policies, like `poster_uploads`. The auto-enable trigger enables RLS; revoke grants by hand.
- This is ordinary least privilege. No client needs direct table access: the app reads through Drizzle on the server, and raw text, AI debug output, cluster logs and community `author_key`s have no business on a public API.
- Open data goes through a curated export (03's `/api/export/news.json`) of story-level fields.

---

## 7. Agendas and meetings: v1 shape

**Position: v1 keeps agendas as `news_articles`, with a structured `agenda_items` jsonb. Promote to `news_meetings` + `news_agenda_items` tables in phase 2, when meeting pages or vote history ship.** The jsonb is designed to migrate 1:1.

How v1 works:
- **Article shape.** One article per meeting and phase, per the modules: `council-<date>-agenda` rewritten in place from draft to formal, and `council-<date>-actions` after the meeting. Commission agendas follow the same shape.
- **`meeting` metadata** comes from the new contract field (`{body, date, phase}`), not from `publishedAt`.
- **Re-enrich on change (required).**
  - A changed `content_hash` on an existing `source_id` sets `revised_at` and resets `enriched_at`, so the item goes back through the pipeline.
  - Each draft → formal → actions transition is a development.
- **Agenda mode enrichment** (§12.1) reads the whole document (up to 30k characters, about $0.005 per version). It returns:

  ```
  agenda_items[] = {n, title, section: 'consent'|'public_hearing'|'new_business'|…,
                    matter, action, outcome?, vote?}
  ```

  `outcome` and `vote` are filled from the action agenda.
- **The meeting story.** The agenda article is `scope='multi'` and leads a meeting story ("Asheville City Council · Oct 13"). Its summary lists the notable items.
- **Item linking** attaches the meeting to the stories it touches without absorbing them. For each item, generate candidates by matter entity and by embedding of the item title. Items with any candidate go into **one** batched LLM call per agenda version ("for each item, which story, if any?"). A matched item then writes to that story:
  - agenda phase → `whats_next {date: meeting date, label: "Council votes on amendments", sourceArticleId, eventId}`;
  - actions phase → a development ("Council approved the amendments 6-1, per the city's action agenda", cited to the actions article as `kind='official'`).

  Most consent-agenda items match nothing and cost nothing.
- **Meeting events come from the agenda sources, never third-party calendars.**
  - The agenda source creates or updates an events row (`source='CIVIC_MEETING'`, `sourceId='AVL_COUNCIL:2026-10-13'`).
  - `whats_next.eventId` points only at those rows.
  - 03 caught the events DB listing council meetings on Thu Sep 24 / Thu Oct 22 from the MX calendar, when the real meetings are Tue Sep 22 / Tue Oct 13. The rule-based event dedup (same start time or date) won't merge rows on different days, so those MX rows need a separate fix on the events side.

---

## 8. Cross-linking with what AVL GO uniquely has

### 8.1 News ↔ events

Both tables share one embedding space. Four link sources, strongest first:

1. **Agenda → meeting event** (§7, deterministic): `relation='milestone'`.
2. **Event mention.**
   - Enrichment's `event_mention {name, date, venue}` is matched against upcoming live events within ±1 day, on title tokens or the same canonical venue (`getVenueForEvent`), giving `relation='subject'`.
   - Prototype hits: Festival of Frights, the Oct 3 candidates forum, Houndmouth at Hellbender.
   - An unmatched Buncombe `event_announcement` goes to `submitted_events` (`source='news'`) for review (Decision 10).
3. **Semantic + LLM.**
   - Compare the story embedding with upcoming live events (`deduped_at IS NULL AND dead_at IS NULL AND hidden IS NOT TRUE`; note that `lib/db/similaritySearch.ts` lacks the first two filters today) from `first_published_at` to +60 days.
   - Take the top 5 above a threshold, then **one** LLM check per story.
   - Keyword matching is out: "bear" pulls in Bear's Smokehouse BBQ (03).
   - Event embeddings embed "title - summary - tags - organizer", a different text shape. **Calibrate the threshold on ~50 labeled pairs**, which wasn't possible offline.
4. **Manual**, by admins and curators.

The reverse direction, "In the news" on event pages, reads `news_story_events`.

### 8.2 Curators

A curator's 280-character note (03) is human text shown separately and **never fed to synthesis**. A verified curator's note adds +1 to `news_score`, capped at +2.

### 8.3 Ranking: `news_score` (0–30, the same scale as event scores)

`news_score` is an integer from 0 to 30. It is **stored** on the story and recomputed by every `news-ai` run and by purge/merge actions, so "All" and "Top" always agree.

```
news_score = round( 2 × importance                            (0–20, AI rubric, story level)
                  + 2 if any newsroom ORIGINAL reporting        (a newsroom chose to cover it;
                                                                 press-release-only stories don't get it)
                  + min(4, 2 × log2(outlet_count))              (independent coverage; wire copies count once)
                  + 1 if has_primary_source
                  + 1 if any place is a named Asheville area or Buncombe town
                  + min(2, buzz / 5)                            (community, §4)
                  + overrides / curator boosts )
then: is_incident → at most 10;  is_brief → at most 8;  clamp to 0–30
```

- **Incidents and briefs sink** (design-ux asked for this). They sort behind "+N more" in All, and they are never Top-eligible anyway.
- **Importance rubric** (story level): 9–10 = safety or daily life for most residents; 7–8 = a major decision or leadership change; 5–6 = notable local; 3–4 = minor; 0–2 = trivia.
- **Importance moves at most ±1 per synthesis update.** The exceptions are the first synthesis and an admin override. That caps how far a re-judged story can swing between runs (§8.4).
- **Across days** (the digest, "5 stories that mattered"): multiply by a 36h half-life decay on `last_development_at`.
- **Around town** community-tier stories are not ranked here. That strand orders by buzz, then recency.

**Calibration on the prototype's real stories.** These are the stories clustered in §2.2 (the Sep 18–24 corpus), after the Buncombe gate, scored with this formula (script: `ai-proto/score-calibration.js`, no AI calls). "Eligible" excludes incidents, briefs and opinion-only stories.

| Day (filing) | Visible stories | Eligible | ≥ 15 | Top (cap 5, floor 2) | Top share of eligible |
|---|---|---|---|---|---|
| Thu Sep 18 | 8 | 4 | 1 | 2 | 50% |
| Fri Sep 19 | 5 | 2 | 0 | 2 | 100% |
| Sat Sep 20 | 6 | 3 | 2 | 2 | 67% |
| Sun Sep 21 | 14 | 8 | 4 | 4 | 50% |
| Mon Sep 22 | 8 | 8 | 4 | 4 | 50% |
| Tue Sep 23 | 11 | 8 | 3 | 3 | 38% |
| Wed Sep 24 | 21 | 15 | 8 | 5 | 33% |

- **Typical days land at 3–4 stories ≥ 15 and 38–50% of eligible stories in Top**, which is design-ux's target.
- **The busiest day** (the police chief, Buncombe's last-place Helene funding, the unspent $4.7M, the Novant park, the superintendent, the bear hearing…) has 8 at ≥ 15 and is cut to 5 by the cap.
- **Without the "+2 newsroom original" term,** the model's habit of scoring notable local items as importance 6 left most single-outlet stories on exactly 13. Top had 0–1 stories on 3 of 7 days, and a quiet Sunday fell back to the floor.
- **Caveat:** this corpus under-samples outlets (no direct WLOS or 828newsnow feeds), and importance came from the earlier WNC-scoped prompt. Real days will have more multi-outlet stories. **Recalibrate after 2 weeks** by adjusting the importance rubric's anchors in the prompt, not the threshold, so 15 keeps meaning the same thing as on events.

### 8.4 Top vs All (S9)

**"All news"** for day D is every live newsroom story with `filing_day = D`, sorted by `news_score` (or by Latest; 03).

**"Top stories"** is a **stored, stable** subset per filing day: `top_day`, `top_rank`, `top_since`. It uses design-ux's parameters (03 §2):

| Parameter | Value |
|---|---|
| Eligible | `state='live'`, `tier='newsroom'`, `filing_day = D`, `local_relevance ≥ 0.6`, not `is_brief`, not `is_incident`, not opinion-only |
| Enter | `news_score ≥ 15` |
| Exit (hysteresis, data side) | Leaves only when `news_score < 13`. Scores of 13–14 keep an incumbent |
| Cap | 5 per day |
| Floor | 2 per day: if fewer than 2 qualify, top up from eligible stories scoring ≥ 8 (`top_reason='floor'`) |
| Replacement margin | When the cap is full, a challenger displaces the weakest incumbent only if it scores at least **2 points** more. Floor members are weakest by definition |
| Past days | Frozen at midnight ET. They change only when a member leaves (re-filed to a newer day by a new development, or merged, hidden or purged); the slot is back-filled from that day's next-best story at ≥ 15 |

**Not stored; the UI adds them per viewer** (03):
- followed stories, which always show;
- the daily "Only in AVL" slot (top `only_in_avl ≥ 8`), which sits on top of the 5.

**Update rule** (end of each `news-ai` run, and after any purge, merge or override, for today's filing day):
1. Keep eligible incumbents with score ≥ 13.
2. Add challengers scoring ≥ 15, best first, into open slots.
3. When full, swap only on a margin of 2 or more.
4. Top up to the floor.
5. Rank by `news_score` desc, then `top_since` asc, then id.

**Is the score stable enough across the day?** On its own, no: about 1 in 5 eligible stories sits exactly on 15. So a threshold applied at render time **would** flicker. With stored membership, it can't flip between runs:

| What can move a score | Direction | Why it can't eject a Top story in one run |
|---|---|---|
| Outlet count, primary source | Only rises | – |
| Buzz | ±2 as threads age | A story at 15 decays to at most 13, which is inside the band, so it stays |
| Importance re-judged at synthesis | ±1 per update, i.e. ±2 points | 15 → 13, inside the band |
| Being displaced | – | Needs a challenger 2+ points stronger |

A story leaves Top only when:
- it re-files to a newer day (it then competes there);
- it changes state;
- it drifts below 13 over several runs;
- or a clearly stronger story arrives.

**Why stored and not computed in the UI:**
- Incumbency needs memory.
- There is one recompute point, which purge and merge also call.
- The query is `WHERE top_day = D ORDER BY top_rank`.
- The UI can still re-apply its rule to `news_score` for the per-viewer additions.

**Admin control:** `importance_override` can carry `forceTop` or `neverTop`.

### 8.5 Sharing: stable ids, redirects, removed stories, OG cards (S10)

**Identifiers are stable and never reused.**
- Every story has an internal `id` (uuid) and a public **`short_id`**: 8-character base32, random, `UNIQUE` over every row ever created. Rows are never deleted, so a short id can never be reissued.
- `slug` is `<up to 8 kebab words from the first headline>-<short_id>`. It is written once and never regenerated.
- The routes, all resolved by `short_id` (a full uuid is also accepted), with the words ignored:

  | Route | What it does |
  |---|---|
  | `/news/<slug>` | Permalink. Sets `<link rel="canonical">` to the current slug |
  | `/news?s=<short_id>` | Opens the feed scrolled to the story, highlighted |
  | `/news?c=<post short_id>` | A community post (below) |
- **Community posts and articles** get their own permanent `short_id` on `news_articles`.
  - `/news?c=<short_id>` opens the post's current story, or the Around town strand, scrolled to the post.
  - It keeps working when that story later merges.
  - An excluded or hidden post resolves to "no longer available".

**Merges write a redirect row.**
- `news_story_redirects` holds `old_id` (pk), `old_short_id` (unique), `new_id`, `reason ('merge')`, `created_at`. It is written in the same transaction as the merge.
- The absorbed story keeps its row with `state='merged'` and `merged_into_id` for audit.
- **Path compression:** when the survivor later merges again, every redirect row pointing at it is repointed to the new survivor, so it's always one hop.
- `/news?s=<old>` and `/news/<old-slug>` **308** to the survivor (for `?s=`, the survivor is highlighted).

**Splits don't break links.** The original id and slug stay with the part that keeps `lead_article_id` (§2.7). Its page links to the split-off stories ("Part of this story continues here").

**Removed and unavailable stories.**

| State | What a link shows |
|---|---|
| `hidden` (takedown, privacy, admin) | A "no longer available" page (HTTP 410), with the reason category only. The OG card is generic |
| `hidden` with reason `community_expired` | "This community report expired without confirmation" |
| `pending` (dropped below the gate after being shared) | Still renders by direct link, `noindex`, but isn't in the feed |

**OG card.** Both `/news/<slug>` and `/news?s=` emit it. For `?s=`, the feed page's `generateMetadata` reads the parameter, so a feed deep link unfurls as the story.

| Field | Source |
|---|---|
| `og:title` | `headline` (≤ 12 words) |
| `og:description` | `dek` (≤ 30 words) |
| Outlets | Lead outlet first: "WLOS · BPR · Mountain Xpress +2" |
| First published | `first_published_at` (ET) |
| Last development | `last_development_at` (ET): "Updated Tue 4:10 PM" when later than first published |
| Kicker | Short topic label · place, plus "DEVELOPING" (`phase`) or "COMMUNITY REPORTS" (tier) |
| Version | `summary_version`, used as `?v=` on the `og:image` URL so previews refresh after an update |
| `og:url` / `twitter:card` | Canonical slug URL / `summary_large_image` |

**OG image.**
- Rendered per request with Next's `ImageResponse` (`app/news/[slug]/opengraph-image.tsx`): text only, with no outlet photos (03: text-first).
- The CDN caches each `?v=` as immutable.
- **Nothing is stored.**

### 8.6 Digest and Ask AI

- The digest uses stored story fields only:
  - the "short version" (one grounded call per `news-ai` run, each bullet citing a story);
  - the top stories since the last send;
  - updates to followed stories.
- **Ask AI:**
  1. Hybrid search: FTS on `search_tsv` plus the embedding (`RETRIEVAL_QUERY`), merged with reciprocal-rank fusion. FTS catches the rare proper nouns ("Stepp", "Silver-Line") that embeddings miss.
  2. Answer only from story summaries and key facts, citing story ids. Community-tier stories are excluded from answers unless the user asks about them.

---

## 9. Evaluation

**1. The golden set** is seeded from the prototype (§11): 226 articles, 25 multi-article stories, ambiguous pairs and traps.
- Commit it to `data/news/golden/`.
- Add 2 weeks of real ingest labeled with a helper script (the pipeline proposes, a person accepts, splits or merges; about 30 minutes a week) until there are **≥ 600 articles and ≥ 80 multi-article stories**.
- Include deliberately:
  - anniversary packages;
  - same meeting, different items;
  - same street, different crimes;
  - name collisions (Dolly the bear vs Dolly Parton Day);
  - wire copies;
  - paywalled-only stories;
  - community-only reports.

**2. `scripts/news/eval-clustering.ts`.**
- It replays through **production functions**, with embeddings and LLM answers cached by prompt hash.
- It reports B-cubed P/R/F1, stories recovered whole, non-ambiguous false merges by title, and $.
- **Ship gate:** F1 ≥ 0.94 and ≤ 1 false merge per 100 stories, on 2 runs.

**3. Relevance-gate eval.** Hand-label 300 items as Buncombe or not, and report precision and recall of `local_relevance ≥ 0.6`. Track separately: the gazetteer rescue rate, and false hits from ambiguous place names.

**4. Summary quality.**
- **Validators on every revision.**
  - **KPI:** under 5% of sentences dropped, and under 2% of revisions falling back to the previous version.
- **A nightly judge on 20 random revisions,** using Gemini 2.5 Flash (a different family). Each sentence is scored `supported | unsupported | misattributed | overstated` against the evidence of its cited facts.
  - **Alert** when unsupported + misattributed exceeds 2% on a 7-day rolling basis.
- **Substitution check (new):** the judge also flags any sentence that carries "why/how" depth, a list, or analysis. Track the word budget, and the outbound click rate per story view.
- **Human spot-check:** `scripts/news/spot-check.ts`, 10 stories a week, about 10 minutes.

**5. `cron_job_runs.result`**, with new `CronJobName` values `'news-scrape' | 'news-fetch' | 'news-ai' | 'news-maintenance'`:

```
news-scrape: {inserted, updated, revised, droppedDisabledDomain, sources[{name, ok, items, ms, error}], skippedSources}
news-fetch:  {attempted, fetched, partial, unavailable, failed, byDomain{}, ms}
news-ai:     {rules{...}, wire{collapsed}, enrich{ok, transient, permanent, contentFiltered, fallbackUsed},
              facts{extracted, droppedUngrounded}, relevance{live, belowGate, gazetteerRescued},
              cluster{auto, llmSame, llmNew, new, llmCalls, sizeAlarms},
              community{skipped, linkAttached, discovered, attached, aroundTownShown, expired, excludedByReason{}},
              synth{incremental, full, materialChanges, sentencesDropped, keptPrevious, failed},
              agenda{itemsLinked}, links{agenda, mention, semantic},
              tokens{byStage}, estCostUsd,
              backlog{pendingFetch, pendingEnrich, pendingCluster, pendingSynth, oldestPendingMinutes}, msByStage}
```

`npm run cron:health` should alarm on:
- a growing backlog, or `oldestPendingMinutes > 360`;
- a stage doing 0 work while its backlog is non-empty (01 lesson 6);
- silent sources (per-source expected cadence);
- a local-only source (Reddit, MX) not seen in 24h, meaning **someone isn't running the local runner**;
- content-filter rate above 3%;
- evidence-drop rate above 8%;
- more than 90% singleton stories;
- size alarms.

---

## 10. Operations, takedown and guardrails

### 10.1 Takedown in minutes, with no deploy

| Step | How | Effect | Time |
|---|---|---|---|
| **Disable** | `/admin/news/sources` toggle (super-admin guard as in poster moderation: `getUser` → 401, `isSuperAdmin` → 403), or `npx tsx scripts/news/takedown.ts <domain> --disable` | `enabled=false`: no module run, incoming items for the domain dropped from every module (Google News, Reddit links), `news-fetch` skips it | Next run; nothing new appears |
| **Purge** | `POST /api/admin/news/sources/[domain]/purge`, or the script with `--purge` | (1) Its articles get `state='purged'`, and `content_text`, `dek`, `facts`, `summary`, `ai_headline`, `ai_dek`, `full_story_has`, `paraphrase`, `embedding` and `image_url` are set to NULL. The id, url, title and outlet stay as an audit stub. (2) Every affected live story immediately loses the summary sentences, key facts, developments and `whats_next` entries whose cites are **only** that outlet's articles (deterministic, no LLM), and gets its counts and `lead_article_id` recomputed. (3) A story left with no live newsroom/primary article gets `state='hidden'`, reason `source_purged`; its links show the tombstone (§8.5). (4) The rest are marked `synth_needed_at`, and up to 20 are re-synthesized inline within a 60s deadline. (5) Recompute `news_score` and Top for the affected days, then `revalidateTag('news')`. (6) `purged_at`, `purge_reason` and the requester are recorded | **Seconds** for (1)–(3) and (5); full re-synthesis at most one `news-ai` run later |
| Undo | Clear `purged_at` and set `enabled=true` | The next scrape re-sees items; purged rows go back to `pending` and are re-fetched and re-enriched | 1–2 runs |

- A **single story or article** takedown (a correction request, privacy) uses the same machinery at row level: `state='hidden'`, reason `takedown`/`privacy`, plus steps (2)–(5).
- Commit publicly to "any outlet that asks is removed within a day". Mechanically it takes minutes.

### 10.2 Guardrails that stay (quality and respect)

1. **Inform, don't substitute** (§2.6): the what-layer only, the word budgets, no quotes, no lists, the copy guard, and outbound-click monitoring.
2. **Attribution and link-out come first.** Every sentence carries outlet chips; "Read the reporting" sits directly under the summary; bylines appear where we have them; `/news/sources` lists every outlet with what we take.
3. **Paywalls, logins and hard bot walls are never circumvented** (S5). Only publicly served text is used.
4. **Private individuals:**
   - AI text and paraphrases name only `public` people;
   - AI text never names a private person accused of a crime, and never names a minor;
   - `is_incident` stories are `noindex`, collapse into the Public safety row, and leave the feed after 12 months (Decision 7);
   - community usernames are stored only as `author_key` hashes;
   - posts with an `exclude_reason` are never shown.
5. **Obituaries:** paid obituaries are skipped.
6. **Corrections:**
   - an outlet's correction (`revised_at` with "Correction:" text, or the page's `updatedAt`) becomes a timeline node and triggers re-synthesis;
   - "Flag an error" feeds the event-report flow;
   - every summary change is versioned.

### 10.3 Cost, latency, crons (Vercel 800s)

**Volume.** The scout catalogs estimate about 64 items/day raw from the build sources, plus about 10 from independent outlets, plus the "later" sources. **Plan for 120/day, with 250 on storm or election days.** About 65–72% pass the Buncombe gate (prototype: 149–163 of 226).

List prices: gpt-5-mini $0.25/M in and $2/M out; gemini-embedding-001 $0.15/M; Gemini 2.5 Flash $0.30/$2.50. Check the Azure contract, since credits may make this $0.

| Stage | Model | Per day | Measured per call | $/day |
|---|---|---|---|---|
| Enrichment, newsroom/primary | gpt-5-mini `minimal` | ~95 | headline $0.0010; full text (6k-char cap) ~$0.0024; mix ≈ $0.0019, plus ~$0.0002 for the added headline, dek, `full_story_has` and concepts | 0.20 |
| Enrichment, community (after rules) + `community_summary` | gpt-5-mini `minimal` | ~8 + ~3 | ~$0.0008 / ~$0.0003 | 0.01 |
| Enrichment, agenda versions | gpt-5-mini `minimal` | ~1 | ~$0.005 | 0.01 |
| Embeddings | gemini-embedding-001 | ~130 | | <0.01 |
| Cluster confirmation + agenda item linking | gpt-5-mini `minimal` | ~70 | $0.0003 | 0.02 |
| Multi-article synthesis | gpt-5-mini `low` | ~25 + ~3 full | $0.0016 | 0.05 |
| Event link check, short version | gpt-5-mini | ~20 | ~$0.001 | 0.02 |
| Judge sample, content-filter fallback | Gemini 2.5 Flash | ~21 | ~$0.0012 | 0.03 |
| **Total** | | | | **~$0.35/day, ~$11/month** |

- **Budget:** $15–25/month, plus about $20 for a 90-day backfill.
- **Effort:** `minimal` matched `low` on enrichment and cost 10% less; `low` is kept for synthesis. `azureChatCompletion` needs an optional `reasoningEffort` option, a one-line change.
- **Storage:**
  - full text (kept forever) about 120 × 5 KB/day ≈ 220 MB/year raw, **about 90 MB after TOAST compression**;
  - article embeddings (6 KB each) about 210 MB/year, **with no index**;
  - story embeddings about 65 MB/year, plus HNSW.

  Revisit `halfvec` past about 100k articles.

**Crons:**

| Route | Schedule | Work | Budget |
|---|---|---|---|
| `/api/cron/news-scrape` | every 3h at :40 | Enabled modules in parallel with a **per-source timeout** (20s); upsert (a longer body wins, non-empty fills empty, AI columns untouched, a hash change sets `revised_at` and re-queues); drop disabled domains | ~60s |
| `/api/cron/news-fetch` | every 3h at :45 | The full-text pass (below) | deadline 240s, `maxDuration` 300 |
| `/api/cron/news-ai` | every 3h at :00, i.e. 20 minutes after the scrape | Stages 3→10 with a **wall-clock deadline** (no new work after 600s). Queues filter before the LIMIT, order `ai_attempts, published_at DESC`, and back off failures | typical 2.5–6 min |
| `/api/cron/news-maintenance` | daily 4:30 AM ET | Dead-URL checks for articles cited by stories active in the last 30 days, retraction detection, phase recompute, merge and cohesion audit (report only), buzz decay, community expiry, judge sample | <300s |

`localOnly` sources (Reddit, anything behind Cloudflare) run through the `scripts/run-full-cron-local.ts` pattern, which calls the same route handlers. The health check alarms when they go stale.

**Where the full-text pass lives, and its budget.** It gets its own route, like the verify cron, for three reasons:
- the scrape stays fast and predictable;
- fetch failures and backoffs are isolated and show up in their own `cron_job_runs` stats;
- Cloudflare-blocked outlets can fetch locally.

How it works:
- **Selection.**
  - `state IN ('pending','live') AND content_text IS NULL AND fulltext_status='pending' AND published_at > now() - interval '3 days' AND (fulltext_next_attempt_at IS NULL OR fulltext_next_attempt_at <= now())`;
  - the outlet is enabled with `fetch_full_text` on;
  - **the item is plausibly Buncombe**: `geo_prior='buncombe'`, or a gazetteer hit in the title or dek, or it came from a Buncombe Google News query. This skips fetching 19 of 20 FOX Carolina bodies.
  - Order by `fulltext_attempts, published_at DESC`, `LIMIT 120`, with the filter applied before the limit (01 lesson 6).
- **Resolution order:**
  1. the source module's `fetchFullText`;
  2. otherwise, for aggregator and discovered items, the module registered for that outlet domain;
  3. otherwise a generic extractor: JSON-LD `articleBody`, then `<article>`, then the main-text heuristic, then `og:description` as `partial`.
- **Concurrency:** 6 global and 1 per domain, 15s timeout per request, `fetchAsChrome` for outlets flagged that way.
- **Backoff:** 30 minutes, 3h, then 12h, then `unavailable`. A paywalled page gives `partial`: its public lede only.
- **Enrichment waits briefly for text.** `news-ai` enriches an article once `fulltext_status != 'pending'`, **or** once it has waited 45 minutes. So it enriches once, with the best text available, and never stalls.
- **Throughput:** today about 40–60 fetches a day, about 10 per run, about 20–30s. Capacity is about 400 per run, so backfills drain quickly.

---

## 11. Prototype: what was run and what it showed

**Scripts and data** are in `C:\Users\matth\AppData\Local\Temp\claude\C--Users-matth-projects-asheville-event-feed\e0e1ced1-37b9-4754-b6a9-03cfa7564984\scratchpad\ai-proto\`:

| File | What it is |
|---|---|
| `build-corpus.ts` | 250 items: City, Watchdog, MX, BPR, FOX Carolina, CPP, r/asheville, and two Google News queries |
| `golden.json` | Hand labels |
| `enrich.ts` | The enrichment prompt with the evidence checker |
| `embed-eval.ts` | Threshold and task-type sweeps |
| `cluster-sim.ts` | The §2.3 algorithm with the §12.2 prompt |
| `synth.ts` | The §12.3 prompt with validators |
| `gazetteer.js` | The Buncombe gazetteer test |
| `enriched.json` | All enrichments |
| `run-*.txt` | Outputs |

No DB access; about $0.65 total.

**Findings.** The numbers are in §1, §2.2, §3 and §10.3.

1. **Enrichment at `minimal` effort is good.** It correctly:
   - dropped non-local FOX Carolina items;
   - classified Reddit;
   - split MX letters and humor from news;
   - extracted the "public comment through Oct. 2" milestone and the candidates-forum event.

   Its WNC-level geo field was too coarse for Buncombe-only; hence the categorical `buncombe` field plus the gazetteer.
2. **Clustering:** §2.2. The Biltmore Championship splits into 3–8 stories depending on the run, because the model treats rounds as separate developments. Put "a bounded event is one story" in the prompt.
3. **Synthesis on the $4.7M story**, mostly headline-only or paywalled coverage:
   - correct and fully cited;
   - stayed within the headlines;
   - extracted the Oct. 2 deadline;
   - wrote a good `whats_new`.

   It exposed four fixes that are now in the design:
   1. collapse mirrors before synthesis (it wrote a sentence about AOL carrying the same story);
   2. number normalization in the validator;
   3. over-attribution;
   4. headline churn.

   The Helene-funds update (excerpt, then a Watchdog full-text article) correctly marked `material_change`, listed 4 dated developments, and kept MX's earlier claims attributed.
4. **Community:** of 25 r/asheville posts, rules and enrichment would surface or attach about 4:
   - the police-chief link post, which attaches deterministically;
   - the Supper Club fire, unverified until a second author or a newsroom;
   - the candidates-forum post (event plus discussion);
   - a homelessness essay (discussion).

   One post named a private person in a complaint and must never surface.

---

## 12. Prompt sketches (with JSON schemas)

All calls use `response_format: json_object`, `parseJsonFromModel`, clamping, validation, and a stored `*_prompt_version`. The prototype versions ran successfully; these fold in its lessons.

### 12.1 Article enrichment (gpt-5-mini `minimal`; ~1.1–2.2k in / 0.35–0.9k out)

**System (newsroom/primary mode):**
```
You are the intake editor for AVL GO's local news feed, which covers ONLY Asheville and
Buncombe County, NC. You read ONE item and return JSON describing it. Use ONLY the text
provided. Never add facts, names, numbers or dates that are not in the input.

Buncombe County includes Asheville and its neighborhoods, Black Mountain, Weaverville,
Woodfin, Montreat, Biltmore Forest, Swannanoa, Fairview, Candler, Leicester, Arden, Enka and
Barnardsville. Hendersonville, Fletcher and Mills River are Henderson County, NOT Buncombe.
FOX Carolina, WYFF and WSPA are Greenville SC stations: their "Upstate" means South Carolina.

Fields:
- buncombe: "core" (about a place, institution or person in Asheville/Buncombe) |
  "affects" (a regional or state item that names Buncombe/Asheville or plainly covers it) |
  "mentions" (Asheville in passing) | "none"
- articleType: news|analysis|opinion|letter|press_release|event_announcement|roundup|
  obituary|sponsored|service|sports_result|other
- scope: "single" (mainly ONE matter) | "multi" (meeting recap, anniversary overview,
  roundup, Q&A column)
- topics: 1-3 of {{NEWS_TOPICS with guidance}}, most relevant first
- places: specific Buncombe places named, as commonly written
- entities: up to 8 {name, type: person|org|place|animal|event|matter, role, public};
  full canonical names. event = a named, attendable event (festival, forum, tournament).
  matter = a specific project, program, ordinance, lawsuit or incident. public (persons
  only) = true for officials, public figures and named spokespeople.
- concepts: 3-6 short lowercase reusable concept phrases ("black bears", "wildlife
  conflict", "affordable housing funds").
- whatHappened: ONE neutral sentence, max 30 words, "[who] [did what] [about what]
  [where]". Leave out what is not stated; a date only if the date is the news. No outlet
  names, adjectives or quotes.
- facts: up to 6 {text, evidence, attribution, kind}. evidence = exact quote, max 20 words,
  copied from the item text (no "Headline:"/"Dek:" labels, no ellipses). attribution = who
  asserts it, or null. kind = official|reported|allegation|claim|opinion. No facts about
  the item itself (its title, author, poster). Headline-only input: facts from the
  headline only. Drop promotional adjectives from press releases.
- headline: your own neutral headline, max 12 words and 90 characters. Plain statement
  of what happened: no clickbait, no questions, no quotes or quotation marks, no
  "BREAKING"/"FIRST ALERT", never the outlet's wording.
- dek: max 30 words, the core development.
- summary: 1-2 sentences, max 45 words, each {text, cites: [fact indexes]}. Only who,
  what, where, when, and what's next - never the why/how, background, quotes or lists.
  Attribute single-source claims and allegations. Never name a private person accused of
  a crime, or any minor.
- fullStoryHas: max 25 words naming what else the full article contains beyond your
  summary ("interviews with three neighbors" is wrong - no numbers; write "interviews with
  neighbors, the county's funding timeline, the agency's reasoning") WITHOUT stating those
  facts. null if you only have a headline, dek or paywalled excerpt.
- importance: 0-10 for a Buncombe resident. {{rubric §8.3}}
- onlyInAvl: 1-10 (delightfully or strangely "Asheville"); crime and tragedy max 3.
- isIncident, isBrief, privatePersonAccused, minorInvolved, developing: booleans
- nextMilestone: {date: "YYYY-MM-DD"|null, what} | null
- event: {name, date: "YYYY-MM-DD"|null, venue} | null
JSON only.
```

**Community mode** swaps the header ("You read ONE community post from Reddit. It is not journalism. Report what the post SAYS, attributed to 'a poster', never as fact"). It returns:
- `communityType`: `question|recommendation|classified|personal|local_report|discussion|link_to_news|event_promo|other`;
- `paraphrase`: ≤ 20 words, neutral, attributive. No private names, no figures, no claims about named people;
- `isHazardReport`;
- `excludeReason`: `private_individual|accusation|stigmatizing|classified|out_of_area|low_signal|null`;
- plus `buncombe`, `whatHappened`, typed `entities`, `places`, `concepts`, `event`.

It returns no `facts`, `summary`, `headline` or `importance`.

The **`community_summary`** call (§4) is a separate ~0.3k-token prompt over the attached posts' paraphrases only. It returns `{text}`, ≤ 30 words, attributive, with no names or figures.

**Agenda mode** returns:
- `meetingSummary` (≤ 2 sentences);
- `agendaItems[] {n, title, section, matter, action, outcome|null, vote|null}`, where `outcome` and `vote` come only from an action agenda;
- `whatHappened` ("Asheville City Council meets Oct. 13 to consider …").

**Server-side:**
- normalize topics and places against the config lists;
- run the gazetteer and the evidence check;
- clamp importance and `onlyInAvl`;
- build `entity_keys` and `local_relevance`;
- on Azure `content_filter`, retry on Gemini 2.5 Flash.

### 12.2 Cluster confirmation (gpt-5-mini `minimal`; ~0.7k in / 0.06k out)

**System:**
```
You maintain the story list for AVL GO, a local news feed for Asheville and Buncombe County.
Decide whether a NEW ITEM reports on the same story as one of the CANDIDATE STORIES.

SAME STORY = the same specific real-world matter: one incident, decision, project, program,
lawsuit, appointment or bounded event - including later developments of it (the vote after
the hearing, the arrest after the shooting, the sentencing after the trial, later rounds and
results of the same tournament).

NOT the same story:
- Only the same broad theme (two different Helene-recovery stories, two bear stories, two
  crimes, two items from the same council meeting).
- The same organization doing different things.
- An overview (anniversary piece, meeting recap, roundup) and a specific story it mentions.
- A candidate last updated more than 90 days ago, unless this is clearly the same process
  continuing (a verdict in the same trial, the vote on the same ordinance).

When unsure, choose "new": a missed merge is cheap to fix, a wrong merge corrupts a summary.

Return JSON: {"decision": "same"|"new", "storyId": "<S1..S4>"|null,
 "related": ["<candidate ids clearly connected but separate>"],
 "confidence": 0-1, "reason": "<max 20 words>"}
```

**User:**
```
NEW ITEM
Published 2026-09-24 by 828newsnow.com (newsroom, scope: single)
Headline: Asheville weighs changes to $4.7M housing aid program
What happened: Asheville is weighing changes to its $4.7M housing aid program.
Entities: City of Asheville; $4.7M housing aid program

CANDIDATE STORIES
S1 (3 articles, latest 2026-09-23, scope: single)
  - 2026-09-23 The Asheville Citizen Times: "Asheville got $4.7M to prevent homelessness. None has been spent" -> ...
  - 2026-09-23 Mountain Xpress: "Council holds public hearing on amendments to its $4.7M ..." -> ...
  Key entities: Asheville City Council; $4.7M homelessness assistance program
```

- Community items use the same prompt, and a `same` answer attaches them as `community`.
- The agenda-item linker batches all items with candidates into one call per agenda version: `{items: [{n, storyId|null}]}`.

### 12.3 Story synthesis and incremental update (gpt-5-mini `low`; ~0.8–1.2k in / 0.35–0.8k out)

**System:**
```
You write and maintain the story card for AVL GO, a local news feed for Asheville and
Buncombe County. A story combines reporting from several articles about ONE matter. Readers
get a short, neutral, sourced account of WHAT happened and click through to the outlets for
the full reporting - so tell what happened, never the why/how in the reporter's depth.

RULES
1. Use ONLY the numbered facts given. Every sentence cites the fact ids it rests on.
   Uncited sentences are deleted automatically, and so is any sentence with a number, date
   or name that is not in a cited fact.
2. Attribute single-outlet claims, allegations, estimates and anything disputed. Facts
   confirmed by two or more independent outlets, or stated by the official source of that
   fact, may be stated plainly.
3. If sources disagree, do not choose: state both with attribution and add a discrepancy.
   If a later official figure replaces an earlier one, say "up from X".
4. Neutral and plain. No quotes, no lists, no background or analysis, no speculation. Never
   name a private person accused of a crime, or any minor.
5. Facts from opinion pieces are never evidence. Community posts are not provided.
6. HEADLINE ONLY / excerpt sources: infer nothing beyond their facts.
7. Use at most 3 facts from any one article. Never copy more than 8 consecutive words.
8. Length: headline max 12 words / 90 characters in your own neutral words (no clickbait,
   questions or quotes); whatsNew (the dek) max
   30 words; summary 2-4 sentences, max 80 words; keyFacts max 5 as label/value (Where,
   When, Cost, Vote, Deadline...); developments one line each; concepts 3-6 short phrases.

UPDATE MODE (when CURRENT STORY is given): rewrite the summary to reflect everything now
known; keep still-valid keyFacts; put only genuinely new information in newDevelopments.
materialChange = false when the new articles only repeat what the story already says.
headlineStale = true only if the current headline is now wrong or misses the main
development.

Return JSON:
{"headline": str, "headlineStale": bool,
 "summary": [{"text": str, "cites": [factId]}],
 "keyFacts": [{"label": str, "value": str, "cites": [factId]}],
 "newDevelopments": [{"date": "YYYY-MM-DD", "text": str, "cites": [factId]}],
 "whatsNew": {"text": str, "cites": [factId]} | null,
 "materialChange": bool,
 "discrepancies": [{"about": str, "claims": [{"text": str, "cites": [factId]}]}],
 "phase": "developing"|"settled",
 "nextMilestone": {"date": "YYYY-MM-DD"|null, "what": str, "cites": [factId]} | null,
 "importance": 0-10,
 "concepts": [str]}
```

**User:** the current story (omitted on first synthesis), then the new articles' facts, labeled by outlet, date, type and availability. Example:

```
[a157] 828newsnow.com, 2026-09-24, news, HEADLINE ONLY: "…"
  a157.1 (reported): …
```

**Server-side:**
- run the §3 validators;
- keep the previous version if nothing survives;
- write the revision row;
- set `last_development_at` only on `materialChange`;
- change the headline only when `headlineStale`.

**The Around town variant** (community-tier stories) uses the same schema, with rule 1 changed to "every sentence is framed as what posters report, built only from the posts' paraphrases", and no `keyFacts`.

---


## Settled (Matt's calls; not revisited here)

| # | Decision | How this design implements it |
|---|---|---|
| S1 | Asheville + Buncombe County only; regional or statewide stories only when Buncombe itself is the subject | The `local_relevance` gate (§1): `affects` alone scores 0.5, below the gate; the gazetteer on the headline, dek or what-happened; outlet priors; story propagation. Places are Buncombe-only (§5.2) |
| S2 | Store full text internally; the UI shows only our summaries and links out | `news-fetch` pass (§10.3). **Full text is kept forever**; storage is about 90 MB/year compressed (§6.7), so **no retention option is proposed**. Every headline, dek and summary is ours (§2.6), with `full_story_has` and "Read at X" |
| S3 | Reddit and community posts are in | The community trust tier (§4): discussion, buzz, Around town, never a fact |
| S4 | `/news` is its own section | Separate `news_*` tables, crons and `'news'` cache tag |
| S5 | robots/ToS are not blockers; take down on request; never circumvent paywalls, logins or hard bot walls | `news_sources` enable/purge in minutes with no deploy (§10.1). Paywalled articles contribute only public text |
| S6 | `news_*` tables may be created in the production DB | RLS deny-all, least privilege (§6.8) |
| S9 | Top stories by default, All news one tap away | Stored `news_score` plus the per-day Top set with hysteresis (§8.4) |
| S10 | Sharing is first-class | Permanent `short_id` and slugs, merge redirects, tombstones, OG cards (§8.5) |

## Decisions for Matt

Several of these are already logged as builder defaults in `docs/news/decisions.md` (D9–D18); they are listed here with the evidence behind them.

**1. How big is a "story"?** (D10)
- Options:
  - (a) Strict: one matter and its developments, with sagas as storylines.
  - (b) Google News style: anything covered together that week, e.g. a "Two years after Helene" package.
- **Recommend (a).**
- Why:
  - Package summaries go vague, and "what's new" stops meaning anything.
  - A miss is two rows with a "related" link; a wrong merge corrupts a cited summary.

**2. Models.** (D11)
- Options:
  - (a) Azure gpt-5-mini throughout, with Gemini 2.5 Flash as the content-filter fallback and as the judge.
  - (b) Gemini as primary.
  - (c) A stronger model for synthesis only.
- **Recommend (a),** A/B-testing (c) in the eval harness later.
- Why:
  - It's already wired up and paid for, and measured well (about $11/month in total).
  - Azure blocked 2 of 228 legitimate crime headlines, so the fallback is needed regardless.

**3. How eager is merging?** (D12)
- Options:
  - (a) `minimal` effort: 19/24 stories recovered, 1 false merge.
  - (b) `low`: 21–22/24 recovered, 2 false merges.
- **Recommend (a) plus the scope rule,** re-measured on the real golden set.
- Why: false merges are the costly error.

**4. Cadence.** (D9)
- Options:
  - (a) Every 6h.
  - (b) Every 3h.
- **Recommend (b).**
- Why: cost scales with articles, not runs, so it costs the same and halves the lag.

**5. Around town (community-only reports).**
- Options:
  - (a) Show them, gated: 2+ distinct authors, a high-engagement post, or a hazard plus an official alert; no `exclude_reason`; attributive; labeled; expiring after 48h.
  - (b) Never show them; community posts only attach to newsroom stories.
- **Recommend (a).**
- Why:
  - It's the one thing only a community signal can do: catch the fire, closure or local controversy before a newsroom writes it up.
  - The gates, the label and the expiry keep rumors from standing as news.

**6. Buzz in ranking.**
- Options:
  - (a) A chip and module only.
  - (b) Also a capped +2 in `news_score`.
  - (c) Uncapped.
- **Recommend (b).**
- Why: locals' attention breaks ties and can nudge a story into Top, but Reddit can't set the agenda. With engagement from Scry, a very hot thread reaches the +2 cap.

**7. Crime and privacy.** (D15)
- Options:
  - (a) AI text and paraphrases never name private accused people or minors; incident stories are `noindex`, collapsed, and leave the feed after 12 months.
  - (b) Treat crime like other news.
- **Recommend (a).**
- Why: republishing arrests under AI headlines, search-indexed, does lasting harm to people who may never be convicted.

**8. Agendas.**
- Options:
  - (a) v1 as articles plus `agenda_items` jsonb, with meeting tables in phase 2.
  - (b) Build the tables now.
- **Recommend (a).**
- Why: it ships "Next: Council vote Oct 13 [+Cal]" and meeting events with no new tables, and the jsonb migrates 1:1.

**9. Storylines.**
- Options:
  - (a) Admin-created: about 5–10, with AI tagging.
  - (b) AI-generated.
  - (c) None.
- **Recommend (a)** in phase 3.
- Why: deciding what counts as a saga is editorial; the tagging is cheap.

**10. News → events.**
- Options:
  - (a) Link only.
  - (b) Also route unmatched Buncombe event announcements into the `submitted_events` review queue.
- **Recommend (b)** in phase 2.
- Why: news is a free source of events the scrapers miss.

**11. Top parameters** (S9).
- Options:
  - (a) design-ux's rule: ≥ 15, cap 5, floor 2 from ≥ 8, plus followed stories and the Only in AVL slot. Add data-side hysteresis (exit below 13, a +2 displacement margin, importance moves ±1 per update, past days frozen), and the "+2 newsroom original" score term.
  - (b) A fixed "top N per day".
  - (c) Threshold only.
- **Recommend (a),** recalibrating the importance rubric after 2 weeks of real scores.
- Why:
  - On the prototype it gives 3–4 Top stories on typical days (38–50% of eligible) and caps the busiest day at 5.
  - The hysteresis rules stop the ~1 in 5 stories sitting exactly on 15 from flickering between runs.
