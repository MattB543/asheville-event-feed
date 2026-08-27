# Plan: Unified `rhp-events` Venue Scraper

**Date:** 2026-08-26
**Status:** Revision 2 — incorporates Codex (GPT-5.6-Sol) review + verification
**Runs:** nightly local job (not Vercel)

> **Revision 2 changelog.** A Codex review found three material errors in
> Revision 1, all since verified against the live DB and live HTML:
>
> 1. The "+272 events" headline was **wrong** — Orange Peel's low count is
>    soft-deduplication, not under-collection. Honest delta is **~+108**.
> 2. The "URL-stable rewrite" claim was **wrong for Orange Peel** — 68 of 92
>    rows use Etix/Ticketmaster URLs. A naive switch inserts ~55 duplicates.
> 3. Year inference by weekday-guessing was **unnecessary** — 4 of 5 sites
>    print explicit `Month YYYY` headers, which Revision 1 missed.

---

## 1. Background

### Why not etix.com directly

Every `/ticket/*` path on `www.etix.com` returns `HTTP 202` with
`x-amzn-waf-action: challenge` — an AWS WAF JavaScript bot-detection challenge.
Verified blocked from a local residential IP, so this is not a Vercel-egress
issue. The official API (`https://api.etix.com/v1/openapi.json`, base `/v3`)
has the ideal endpoint — `GET /v3/public/activities?zipCode=28801&radius=30` —
but all `/public/*` and `/affiliates/*` routes return `401` without OAuth2
partner credentials.

**We do not attempt to defeat the WAF challenge.** No token harvesting from a
browser session, no fingerprint-spoofing a scripted client. That is
bot-detection circumvention regardless of how public the data is. Nothing in
this plan requires it.

### The opening

Every Etix-ticketed venue in the region runs the **`rhp-events` WordPress
plugin** (Rock House Partners, Etix-affiliated) on its own domain. Those pages
render the complete upcoming list server-side, in one request, with no bot
protection, in identical markup across all five venues.

### Honest opportunity assessment

Revision 1 compared listing-card counts against _live_ rows carrying that exact
source label. That is not a coverage analysis — it counts soft-deduplicated
rows as "missing". Corrected figures, measured 2026-08-26:

**Existing scrapers are not broken:**

| Source        | Future rows | Live | Soft-deduped |
| ------------- | ----------: | ---: | -----------: |
| `ORANGE_PEEL` |          92 |   14 |       **78** |
| `GREY_EAGLE`  |          92 |   72 |           20 |

Orange Peel's scraper returns 79/79 website events and merges to ~90. It is
collecting fine; dedup then removes 78 as duplicates of AVL Today, Mountain
Xpress, Explore Asheville, Facebook, etc. **There is no one-line bug and no
+65 to recover.**

**The three new venues are the real prize** (title-normalized cross-source
match against all live future events):

| Venue                           | Unique titles | Already live elsewhere | **Genuinely new** |
| ------------------------------- | ------------: | ---------------------: | ----------------: |
| Asheville Music Hall / One Stop |            57 |                     18 |            **39** |
| Pisgah Brewing                  |            25 |                     11 |            **14** |
| 185 King Street (Brevard)       |            59 |                      4 |            **55** |
| **Total**                       |               |                        |          **~108** |

Existing coverage comes largely from `MOUNTAIN_X` and `LIVE_MUSIC_AVL` — and
MountainX only refreshes during local scrape runs, which is exactly this job's
context.

Secondary benefits beyond raw count: canonical venue attribution (correct
sub-venue instead of a generic aggregator string), venue-supplied images,
real prices on Grey Eagle, and a request-cost drop from ~170 to ~10.

_Caveat: title-substring matching is fuzzy and recurring events (trivia,
karaoke) collapse to one title, so ~108 is approximate — directionally right,
not exact._

---

## 2. Verified Markup Contract

Two layouts, `--grid` (AMH) and `--list` (others). Field extraction is
layout-independent.

### Card delimiter and de-duplication

Split on **`rhpSingleEvent`** — not `rhp-event-series`, which also appears ~63×
in the plugin's inlined CSS.

**Grey Eagle and Orange Peel render every event twice** (desktop + mobile
blocks): 178 and 158 raw nodes for 89 and 79 real events.

**De-duplicate by normalized event-page URL, NOT by Etix performance ID.**
Pisgah has 40 unique cards but only 38 Etix IDs — keying on the ID silently
drops two events. Retain the Etix ID as debug/migration metadata only.

### Fields (all verified against live HTML)

| Field            | Selector                              | Notes                                                        |
| ---------------- | ------------------------------------- | ------------------------------------------------------------ |
| Event page URL   | `a.url[href]` / `a#eventTitle`        | dedup key + `ScrapedEvent.url`                               |
| Title            | `h2.rhp-event__title--{grid\|list}`   |                                                              |
| Date (day/month) | `#eventDate`                          | e.g. `Wed, Aug 26` — **no year**                             |
| **Month + year** | `Month YYYY` separator headings       | **present on GE/OP/Pisgah/185King; absent on AMH**           |
| Time             | `.eventDoorStartDate span`            | `Show: 10 pm`, `Doors: 4 pm // Show: 7 pm`                   |
| **Price**        | `.rhp-event__cost-text--{grid\|list}` | GE 164 nodes (~82 events), Pisgah 8, **OP/AMH/185King none** |
| Free flag        | CTA class `rhp-event-cta free`        |                                                              |
| Sub-venue        | `a.venueLink`                         | absent on 185 King (single venue)                            |
| Image            | `.rhp-events-event-image img[src]`    |                                                              |
| Age restriction  | `.eventAgeRestriction`                |                                                              |
| Support acts     | `#evSubHead`                          | often empty                                                  |

### Sub-venues

| Site        | Sub-venues (real event counts)                                     |
| ----------- | ------------------------------------------------------------------ |
| Grey Eagle  | Music Hall (55), Patio Stage (20), Music Hall – Special Event (14) |
| Orange Peel | The Orange Peel (70), Hellbender (9) — plus Pulp historically      |
| AMH         | Asheville Music Hall (30), The One Stop (29)                       |
| Pisgah      | Taproom Stage (33), Outdoor Stage (7)                              |
| 185 King    | none emitted — use site default                                    |

### Ruled out

- **Detail-page JSON-LD:** AMH emits none. Not a universal enrichment path.
- **RSS `pubDate` is the post date, not the event date** (verified: descends
  Aug 26, 25, 25, 24… while events are upcoming). Descriptions only.
- **WP REST:** no `tribe/events`; `wp/v2/types` exposes only `rhp_venue`.
- **Pagination is a trap:** `/all-shows/page/2/` is 51/52 duplicates of page 1
  and its one unique item is a _past_ event. Page 1 already spans Aug 26 →
  Dec 11. **Fetch page 1 only; never follow `rel="next"`.**

---

## 3. Design

### 3.1 Use Cheerio, not regex

`package.json` has **no** HTML parser. Add **`cheerio`** as a direct dependency.

Regex is fine for one small scraper. Here it would have to handle two layout
variants, nested optional elements, duplicate desktop/mobile trees, month
headers that live _outside_ card nodes, and pages over 1 MB. Cheerio makes
"the nearest preceding month header" and "pick one view tree" expressible;
regex does not. No browser required.

### 3.2 Shared module `lib/scrapers/rhp.ts`

```ts
export interface RhpVenueConfig {
  source: EventSource;
  sourceIdPrefix: string;
  listingUrl: string; // page 1 only
  feedUrl?: string; // omit to disable RSS enrichment
  defaultVenueName: string;
  defaultAddress: string; // "Venue, Street, City, State"
  /** partial override, only where the building differs */
  subVenueAddresses?: Record<string, string>;
  zip: string;
  excludeTitlePatterns?: RegExp[];
}

export async function scrapeRhpVenue(cfg: RhpVenueConfig): Promise<ScrapedEvent[]>;
```

Flow: fetch listing → parse cards → dedupe by URL → resolve date → build
`startDate` → optional RSS join → filter → return.

### 3.3 Date resolution (corrected)

**Primary — explicit year headers.** GE, OP, Pisgah and 185 King all print
`August 2026`, `September 2026`, … separators. Take each card's year from its
nearest preceding header. This is exact and needs no inference.

**Fallback — AMH only** (no headers):

1. Dedupe cards by URL _first_ (otherwise the mobile block looks like a rollover).
2. Walk cards in document order (chronological).
3. Assign each `month/day` the earliest valid date **on or after** the previous
   card, seeded at today Eastern.
4. Cap horizon at ~18 months.
5. Use the weekday as a **checksum only**.

Failure behaviour:

- Invalid month/day, non-monotonic, or beyond horizon → **skip + warn**.
- Weekday mismatch → **log and keep** the header/monotonic date. Do _not_ skip.
  A typo like `Thu` for `Wed` would otherwise push the event a full year out —
  worse than trusting the explicit year.
- Many mismatches in one venue → fail that venue as structurally suspect.

Details:

- Use `Date.UTC(y, m, d).getUTCDay()` for weekday checks — DST has no role in
  calendar-day validation.
- Round-trip the constructed components so Feb 29 in a non-leap year doesn't
  silently normalize to Mar 1.
- Compare `YYYY-MM-DD` against `getTodayStringEastern()` so today is included.
  Do **not** subtract a day.

> **Known limitation to test, not fix here:** `parseAsEastern()` picks the
> date's _noon_ offset while `getStartOfTodayEastern()` uses the offset at the
> current instant. On DST-transition days a midnight/1 a.m. event can be an
> hour off. Evening shows are unaffected. Add transition-day round-trip tests.

### 3.4 Time — reuse the existing utility

**Do not hand-roll a `Show:` parser.** `extractTimeFromText()` in
`lib/utils/parsers.ts` already handles `Show: 10 pm`, `Show: 7:30 pm`, and
`Doors: 4 pm // Show: 7 pm`. Use it; add a `Doors:`-only fallback to that
shared helper if needed. Then `parseAsEastern(dateStr, timeStr)` — local
Eastern, no offset, per the skill's Timezone Decision Tree.

No time parsed → `timeUnknown: true`, default 19:00 ET.

### 3.5 Price — parse it, don't binarize it

Revision 1's "binary Free/Unknown" would have been a **regression for Grey
Eagle**, which publishes real prices on nearly every event.

- Read `.rhp-event__cost-text--{grid|list}` first. Preserve the displayed
  string; normalize `"$14.05 to $16.11"` → `"$14.05 - $16.11"`.
- Else CTA class `rhp-event-cta free` → `'Free'`.
- Else `'Unknown'`.

**Do not pass `"$19.95"` to `formatPrice()`** — it calls `parseFloat` on the
raw value and returns `Unknown` for a `$`-prefixed string.

OP / AMH / 185 King publish no cost text, so they legitimately land on
`Free`/`Unknown`.

### 3.6 Descriptions via RSS — enable for four, skip Orange Peel

All five feeds exist at `{listingUrl}feed/`, and **item counts exactly match
deduped card counts** (89 / 79 / 59 / 40 / 93) — a free structural validation.

Verified join quality:

| Site            | Join rate | Non-empty descriptions  |
| --------------- | --------- | ----------------------- |
| Grey Eagle      | 89/89     | 89                      |
| AMH             | 59/59     | 55                      |
| Pisgah          | 40/40     | 40                      |
| 185 King        | 93/93     | 93                      |
| **Orange Peel** | 79/79     | **10** ← omit `feedUrl` |

One extra request for near-complete descriptions is worth it. Best-effort: a
feed failure must never fail the scrape.

`stripHtml()` already calls `decodeHtmlEntities()` internally — don't call both.

### 3.7 Location

One `defaultAddress` per site plus a **partial** `subVenueAddresses` override
only where the building genuinely differs. A full address map per stage label
is over-engineered — Pisgah's two stages and Grey Eagle's three share a
building.

Real overrides needed (verify addresses during implementation):

- The One Stop — 55 College St (vs AMH's 31 Patton Ave)
- Hellbender — 155 Thompson St (vs Orange Peel's 101 Biltmore Ave)
- Retain Pulp support for Orange Peel even though no current card uses it.

Brevard and Black Mountain are already in `geo.ts` (`KNOWN_CITIES`, zips 28712
/ 28711), so `isNonNCEvent` will **not** drop them — provided we build `", NC"`
into the location string. They will correctly not match an explicit
"Asheville" location filter.

### 3.8 Parking-pass filtering

Etix lists 16 `Hellbender - Parking` items (`Swannanoa Lot ($15)`, etc.). They
appear absent from the Orange Peel _site_ listing, but add a defensive filter:

```ts
excludeTitlePatterns: [/\bparking\b/i, /\bLot\s*\(\$/i];
```

### 3.9 Error handling

The shared parser must **throw** — not return `[]` — on listing-fetch failure,
zero cards parsed, or structural parse failure. Returning `[]` makes the cron
record a broken scraper as "fulfilled". Tolerate RSS failure; skip an isolated
malformed card with a warning; fail the venue if a large fraction are malformed.

### 3.10 New sources

```ts
| 'ASHEVILLE_MUSIC_HALL'
| 'PISGAH_BREWING'
| 'KING_STREET'        // Brevard — separate so it's trivially droppable
```

Three values, not one — matches house convention and keeps per-venue stats and
filtering. **Also add display labels in `components/EventContent.tsx`** (~line 184) or the UI shows a generic "Source".

---

## 4. Phasing

### Phase A — Ship the three new venues (low risk, all the upside)

1. Add `cheerio`; create `lib/scrapers/rhp.ts`.
2. `ashevillemusichall.ts`, `pisgahbrewing.ts`, `kingstreet.ts` — thin configs.
3. Add the three sources to `types.ts` + `EventContent.tsx`.
4. **One generic `test:rhp` script** looping the configs, plus saved grid/list
   HTML fixtures for deterministic date/selector tests. Five near-identical
   test scripts add nothing.
5. Validate per skill Phase 4: timezone spot-checks, no past events, DB
   insertion test, cleanup.
6. Wire into `app/api/cron/scrape/route.ts`. Note: the route maps a `SCRAPERS`
   array with per-scraper catch and `Promise.all` — **not** a literal
   `Promise.allSettled`. Adding three entries is enough; failures stay isolated.
7. `npx tsc --noEmit`.

### Phase B — Grey Eagle migration (moderate risk)

Grey Eagle is close to URL-stable: 87 of its current live future URLs already
match the 89 listing URLs exactly. It currently stores `jsonLd.url || url`,
so it is _mostly_ but not _unconditionally_ the listing URL.

Run a **read-only dry-run diff** first (see Phase D). Preserve `ge-{slug}`
`sourceId` derivation exactly. Gains: correct Patio Stage / Special Event
location labelling (currently collapsed onto the main address) and real prices.

### Phase C — Orange Peel migration (**high risk — do not bundle**)

Orange Peel is **not** URL-stable. Measured distribution of its 92 future rows:

| URL host               | rows | live |
| ---------------------- | ---: | ---: |
| `www.etix.com`         |   58 |    7 |
| `theorangepeel.net`    |   24 |    6 |
| `www.ticketmaster.com` |   10 |    1 |

Two legacy identity schemes — `tm-op-{ticketmasterId}` (68 rows) and
`op-web-{slug}` (24 rows). Revision 1's claim of `op-{slug}` was simply wrong.

`events.url` is the unique conflict target and the cron upserts on it. Emitting
venue-page URLs for all 79 events would create **~55 new rows**, orphaning the
old ones along with their favourites, AI tags, scores, embeddings and
moderation state.

Compounding it: the upsert does **not** clear `dedupedAt`, so re-scraping a
URL that belongs to a soft-deduped row updates it but leaves it invisible. Do
**not** blanket-clear `dedupedAt` — that would resurrect genuine duplicates.

**Orange Peel therefore needs an explicit row-preserving identity migration, or
must keep its current canonical URLs.** Decide after Phase D.

### Phase D — Cross-source coverage audit (do before B and C)

Read-only, all sources, matching logical events by date/title and Etix ID:

- exact URL conflict
- same event, different URL
- genuinely new
- previously listed, now gone
- multiple DB rows matching one card

Plus: old vs new title/date/time, price and description completeness, and each
matched row's id / source / url / `dedupedAt`.

This also answers the real open question the Orange Peel numbers exposed:
**is the dedup layer over-aggressively collapsing venue-canonical rows into
aggregator rows?** 78 of 92 OP rows soft-deduped is worth understanding on its
own merits, independent of this scraper work.

---

## 5. Risks

| Risk                                                     | Severity     | Mitigation                                                               |
| -------------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| OP URL switch creates ~55 duplicate rows                 | **Critical** | Phase C gated behind Phase D audit + identity migration                  |
| Re-scraped URL stays invisible (`dedupedAt` not cleared) | **High**     | Identify keepers individually; never blanket-clear                       |
| AMH year inference (no headers)                          | Medium       | Monotonic + horizon cap + weekday checksum; skip only on hard violations |
| Dedupe by Etix ID drops cards                            | Medium       | Dedupe by URL (Pisgah: 40 cards / 38 IDs)                                |
| Dropping GE detail fetch loses real prices               | Medium       | Parse `.rhp-event__cost-text`                                            |
| Plugin markup changes                                    | Medium       | Single shared parser; throw on zero cards                                |
| DST-transition midnight events off by 1h                 | Low          | Pre-existing; add round-trip tests                                       |

---

## 6. Resolved Open Questions

1. **Orange Peel + Ticketmaster:** eventually replace TM (it supplied no prices
   or descriptions in a live run; the listing supplies all 79 + images), but
   **not now** — only after a row-preserving migration. Leave the hybrid alone
   in Phase A.
2. **Year window:** drop the 3-year weekday search. Use explicit headers;
   AMH uses monotonic ordering with an 18-month cap.
3. **One source or three:** three, with five thin entry points over one parser.
4. **Regex or parser:** Cheerio.
5. **Sub-venue addresses:** one default + partial overrides only.
6. **Source IDs:** preserve `ge-{slug}`; Orange Peel's real legacy schemes are
   `op-web-{slug}` and `tm-op-{id}`.

---

## 7. Decision Required

Codex recommends removing Grey Eagle and Orange Peel from the initial change
entirely. This plan keeps them as **sequenced later phases** rather than
dropping them, because the user explicitly asked for the rewrite.

**Orange Peel is the one that genuinely should not proceed as originally
scoped** — not because the rewrite is a bad idea, but because it needs an
identity migration that was invisible in Revision 1. Options:

- **(a)** Phase A only for now; revisit B/C after the Phase D audit. _Safest._
- **(b)** Phase A + B (Grey Eagle), defer Orange Peel. _Middle ground —
  captures GE's price/location fixes at low risk._
- **(c)** All three, with a written Orange Peel URL-migration step first.
