# Summer camps v2: build plan (2026-10-28, evening)

Matt's decisions after the pilot (`03-pilot-report.md`). This supersedes the parts of
`01-context-and-plan.md` it contradicts (N15 hand checks, the quote verifier, the §5 table
design, the Nov 5 - Dec 1 schedule). Everything else in 01 still stands (camp rule, D3 radius,
filters, .ics rules, popularity, feed rules, banner window).

## 1. Decisions

1. **No code verifier.** Sol extracts; nothing re-checks its quotes. `lib/camps/verify.ts` and
   its tests are deleted. Sol rates its own **confidence** (`high | medium | low`) per card and per
   registration date, with `review_notes` saying what to check.
2. **Matt reviews by hand** only what isn't high confidence, in a simple `/admin/camps` page:
   Confirm, Hide, or fix a field. Everything is shown to parents either way; a registration date
   that is neither high confidence nor confirmed reads "unconfirmed".
3. **AI banner** near the top of `/camps` and each camp page: "This info was pulled from each
   camp's website by AI. Double-check with the camp before booking anything."
4. **One card per program.** Sites, weeks/themes, age bands and price tiers are rows inside it.
   A new card only for a different program or camp type. Filters match on rows, and the card
   says what matched ("2 of 9 weeks fit age 7").
5. **Location:** Sol gives each site's street address (looking it up when the camp page doesn't
   print it); the free US Census geocoder places it; ORS (api.heigit.org) gives drive minutes from
   Pack Square. Sites the geocoder misses get a pin Matt pastes from Google Maps in the admin page.
   The D3 radius stays drive time (55 min day / 75 overnight).
6. **Tables now.** One migration, created on the live DB tonight once reviewed.
7. **Schedule:** build the rest tonight with parallel agents; launch is Matt's call (merging to
   main deploys).
8. Thin December data is fine (2026 facts shown labelled). No login-only catalogs.

## 2. Contract

`lib/camps/contract.ts` is the shared interface: `Provider` (discovery output), `CampCard` /
`ProviderExtraction` (Sol's output), `campKeyFor`, `needsReview`. `lib/camps/types.ts` is the
old pilot contract and goes away with the pilot code.

**Identity:** `camp_key = <provider key>:<slug of program name>`. On re-extraction Sol is given the
provider's existing program names and told to reuse them for the same program, so keys don't drift
(the pilot saw 5 of 16 YMCA names change between runs).

## 3. Data flow

```
discovery  -> data/camps/providers.json            (scripts/camps/discover.ts)
extraction -> data/camps/extractions/<key>.json    (scripts/camps/extract.ts; WebTrac via catalog)
import     -> camp_providers, camps, camp_sites    (scripts/camps/import.ts, dry run unless --apply)
               geocodes new sites (Census, cached in data/camps/geocode-cache.json),
               drive minutes (ORS), never overwrites a hand pin, never deletes a camp
pages      <- lib/db/queries/camps.ts (unstable_cache, tag 'camps')
admin      -> confirm / hide / override / pin      (POST /api/admin/camps)
refresh    -> weekly cron: re-fetch sources, re-extract changed providers, re-import
```

## 4. Tables (`drizzle/0025_camps.sql`, rewritten; RLS deny-all, no anon/authenticated grants)

- `camp_providers`: `key` (pk), `name`, `website_url`, `urls text[]`, `area`, `discovered_by
text[]`, `hidden`, `notes`, `extracted_at`, `source_hash` (hash of fetched source text, for
  refresh), timestamps.
- `camps`: `id uuid`, `camp_key` unique, `slug` unique, `provider_key` → providers, `name`,
  `type`, `categories text[]`, `card jsonb` (the `CampCard` as extracted), `override jsonb`
  (Matt's fixes: top-level `CampCard` keys that replace the extracted ones; effective card =
  `{...card, ...override}`), `confidence`, `review_notes`, `reviewed_at`, `reviewed_hash` (hash of
  the effective card when Matt confirmed; a re-extraction that changes it puts it back in the
  queue), `hidden`, filter columns derived from the effective card (`age_min/max`,
  `grade_min/max`, `season_year`, `season_start/end`), `first_seen_at`, timestamps.
- `camp_sites`: `id`, `provider_key`, `name`, `address`, `town`, `state`, `lat`, `lng`,
  `geocode_source` (`census | ors | hand`), `geocode_label`, `drive_minutes`; unique
  `(provider_key, name)`. Cards point at sites by name.
- `camp_views (camp_id, day, count)`: popularity, "views in the last 14 days".
- `camp_calendars (token, camp_ids uuid[], created_at, updated_at, last_fetched_at)`: the
  subscribable feed of saved camps.

Review queue = not hidden, `needsReview(effective card)`, and `reviewed_hash` ≠ hash(effective card).

## 5. Pages

`/camps` and `/camps/[slug]` keep the pilot's layout, URL-state filters and kid memory, rebuilt on
program cards from the DB: rows table on the detail page (week, theme, site, ages, hours, price,
status), "what matched" on the card, AI banner, registration line first. Plus per-camp
registration reminder (.ics, 01 §4.4), "Camp website" + view beacon (01 §4.5), feedback box
(01 §4.6), sitemap, header "More" menu + camps season banner (01 §4.7, window Nov 5 - Mar 31
with year wrap), camps in the event feed (01 §4.8), weekly refresh cron (01 §6.5).

## 6. Workstreams

Agents share one worktree, so each owns its files and **none commits, stashes or switches
branches** (the lead commits between waves). Each runs `npx tsc --noEmit` and `npx eslint` on its
own files; errors in files another agent owns are ignored.

| Wave | Stream          | Owns                                                                                                                                                        |
| ---- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Extraction v2   | `lib/camps/extract.ts`, `lib/camps/webtrac.ts`, `scripts/camps/extract.ts`, `data/camps/extractions/`, deletes the old pilot pipeline scripts + `verify.ts` |
| 1    | Discovery       | `lib/camps/discovery.ts`, `scripts/camps/discover.ts`, `data/camps/providers.json`, `data/camps/discovery/`                                                 |
| 1    | Geocoding       | `lib/camps/geo.ts`, `scripts/camps/test-geo.ts`                                                                                                             |
| 1    | Schema + import | `lib/db/schema.ts` (camps tables), `drizzle/0025_camps.sql`, `lib/db/queries/camps.ts`, `scripts/camps/import.ts`                                           |
| 1    | Header + banner | `components/EventTabSwitcher.tsx`, `lib/seasons.ts`, `components/seasonal/`, a shared dropdown component                                                    |
| 2    | Pages           | `app/camps/`, `components/camps/`, `lib/camps/display.ts`, `app/api/camps/`, sitemap                                                                        |
| 2    | Admin           | `app/admin/camps/`, `app/api/admin/camps/`, `components/camps/admin/`                                                                                       |
| 3    | Feed + refresh  | feed integration per 01 §4.8, `app/api/cron/camps-refresh/`                                                                                                 |

Each wave ends with a Codex review gate (plan conformance, correctness, simplicity) logged in
`05-v2-report.md`, and the finished site gets an Opus UX review in a real browser.
