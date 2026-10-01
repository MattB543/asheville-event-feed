# Group Directory: implementation plan

Status: implemented 2026-10-01 (this is the plan as approved; later changes from the Codex code review and the Chrome UX review are summarised in CLAUDE.md "Group Directory": per-request rendering, URL filter state, compact All view, 10 upcoming / 50 past caps, links pass, remote-only + networking rules). Builds on the
2026-09-18 discovery pass (`data/groups/README.md`) and the 2026-09-30 research pass
(`data/groups/research/`).

## Goal

1. Store the final list of recurring community groups in the DB.
2. `/groups`: a simple, clean **Group Directory**.
3. `/groups/[slug]`: one page per group listing its **upcoming** events, with **past** events
   collapsed (hidden by default).
4. Nav: **Groups** replaces **Your List** in the header tab bar. **Your List** moves into the account
   dropdown (UserMenu) and gets a card on `/profile`.

## What a "group" is (Matt's definition)

A specific set of people with a shared identity who return repeatedly. Trivia, open mics, karaoke and
anything where only the host recurs are not groups. Businesses selling their own classes/tickets and
business-development networking are not groups. Western NC only. Grey cases lean "keep", except the
nine grey entries from the 2026-09-18 review, where Matt greenlit only Oklawaha. Dormant groups are
kept. Jams count (Matt greenlit the Oklawaha bluegrass jam).

## Data (gathered)

- `data/groups/research/input/batch-NN.json`: 454 records = 238 candidates (229 approved + 8 grey + 1
  recheck) + 216 Meetup groups (11 more Meetup groups are absorbed by candidates that name them).
  Built by `scripts/groups/build-research-batches.ts`.
- `data/groups/research/results/batch-NN.json`: one result per record (`verdict`, `reject_reason`,
  `duplicate_of`, `name`, `description` ≤240, `category`, `website`, `schedule`, `home_base`,
  `activity`, `confidence`, `notes`). 405 keep / 49 reject.
- `data/groups/directory-overrides.json`: final calls on top of research: `reject` (9), `keep`,
  `merge` (source → main, 3), `not_duplicates` (research `duplicate_of` edges to ignore), `edits`
  (per-key field overrides).
- Expected final directory: ~393 groups.

Categories: `lib/groups/categories.ts` (`GROUP_CATEGORIES`, value + label, display order).

## DONE in Phase 0 (main agent)

- `lib/groups/matchKeys.ts`: `normalizeTitle` (identical to `scripts/groups/build-buckets.ts`),
  `normalizeOrganizer`, `seriesKey`, `meetupUrlname`, `meetupKey`, `eventMatchKey`, `prefilterValues`.
- `lib/groups/categories.ts`.
- `lib/db/schema.ts`: `groups` table. `drizzle/0018_groups.sql`: **already applied to the DB**
  (RLS on, anon/authenticated revoked).

```
groups: id uuid pk, directory_key text unique (stable identity = surviving research key),
        slug text unique, name, description, category, website, meetup_url, schedule, home_base,
        match_keys text[] not null default '{}', hidden bool default false (seed never touches it),
        created_at, updated_at
```

## How events match groups (read time, no link table)

An event's key (`eventMatchKey`): MEETUP rows → `meetup:<urlname>` (URL path segment as written,
never decoded); every other source → `series:<normalizeTitle(title)>|<lower(trim(organizer))>`. An
event belongs to the group whose `match_keys` contains its key. The builder guarantees every key
belongs to exactly one group, so an event matches at most one group (no double counting).

Read path (server only, `lib/db/queries/groups.ts`):

1. Load the groups needed (all non-hidden for the directory; one by slug for a detail page).
2. `prefilterValues(keys)` → `{ urlnames, organizers }`. One SQL query fetches candidate **live**
   events with explicit columns:
   `hidden IS NOT TRUE AND deduped_at IS NULL AND dead_at IS NULL AND (
     (source = 'MEETUP' AND split_part(url, '/', 4) = ANY($urlnames)) OR
     (source <> 'MEETUP' AND lower(btrim(coalesce(organizer, ''), E' \t\r\n')) = ANY($organizers)))`
   Never `select().from(events)`.
3. Confirm each row in JS with `eventMatchKey` → group (venue organizers host many non-group events).

The SQL organizer normalization must agree with JS `normalizeOrganizer` for real data; the seed
script's parity check (below) proves it.

Known limits (document, don't build for v1): a group that renames its series or changes its
organizer string won't match until a key is added; when dedup keeps a different-source copy of a
group's event whose title/organizer has no key, that event drops off the group page (measured: ~40
of ~9k matched events on 2026-09-18).

## Scripts (Agent A)

- `scripts/groups/build-directory.ts` (pure, no DB) → `data/groups/directory.json` (committed).
  - Inputs: research inputs + results, `directory-overrides.json`, `candidates.json`, `units.json`.
  - Verdicts: research `verdict`, then overrides `reject` / `keep` win.
  - Merges: union of override `merge` edges and research `duplicate_of` edges, **except** research
    edges touching any key mentioned in override `merge` (either side) or listed in
    `not_duplicates`. Resolve each edge to its root; fail on cycles, missing targets, or a rejected
    root with kept members. Merged sources contribute match keys only.
  - Keys: candidate → `seriesKey(units[i].title, units[i].organizer)` for each `unit_indices` entry
    (look the unit up by its `index` field) + `meetupKey(meetup_urlname)` if set; Meetup record →
    `meetupKey(urlname)`.
  - Slug: candidate slug for `c:` keys; `cleanTitle(name)` (`lib/utils/slugify.ts`) for `m:` keys;
    `edits[key].slug` wins; de-duplicate with `-2`, `-3`.
  - `directory_key` = the surviving root's research key. `meetup_url` = the root's Meetup URL, else
    the first merged member's. Apply `edits[key]` field overrides last.
  - Validate: unique slugs, unique directory keys, every key owned by exactly one group, category in
    `GROUP_CATEGORIES`, description ≤240, non-empty name. Exit non-zero on any failure.
  - Output `{ generated_at, count, groups: [{ directory_key, slug, name, description, category,
    website, meetup_url, schedule, home_base, match_keys, merged_from }] }`, sorted by slug. Print
    counts (by category, merges, rejects).
- `scripts/groups/seed-groups.ts` (dry run by default, `--apply`):
  - Sync `directory.json` → `groups` in one transaction: upsert on `directory_key` (update every
    field except `hidden`, set `updated_at`), delete rows whose `directory_key` is not in the file.
    Dry run prints inserts / updates / deletes.
  - Coverage + parity report: full scan of live events (explicit columns) matched with
    `eventMatchKey` in JS, vs the same counts via the SQL prefilter above. Print per-group live
    counts, groups with zero live events, and any group where the two counts differ (must be none).
  - Remind that `/groups` pages refresh within an hour (scripts can't call `revalidateTag`).
- Point `scripts/groups/build-buckets.ts` and `build-research-batches.ts` at `normalizeTitle` from
  `lib/groups/matchKeys.ts` (delete their copies; behaviour identical; don't run build-buckets).

## Pages (Agent B)

### Queries: `lib/db/queries/groups.ts`

- `unstable_cache` with tags `['events', 'groups']`, `revalidate: 3600`. The scrape job already
  invalidates `events`, so group pages refresh after every scrape.
- Cache key parts include `getTodayStringEastern()` (and the slug for details), so yesterday's
  events never read as upcoming after midnight. Build the cached function per call to get dynamic key
  parts.
- **JSON-safe results only**: cached values contain ISO strings and preformatted labels, never
  `Date` objects (unstable_cache round-trips through JSON).
- "Upcoming" = `start_date >= getStartOfTodayEastern()` (one cutoff per call, used for everything).
- `getGroupDirectory()` → every non-hidden group (including ones with zero live events):
  `{ slug, name, description, category, homeBase, upcomingCount, nextEventLabel | null,
  lastEventLabel | null }`. Labels formatted on the server in America/New_York:
  next = "Thu, Oct 2"; last = "Aug 2026".
- `getGroupPage(slug)` → group fields + `upcoming[]` (ascending) and `past[]` (descending, capped at
  100, plus `pastTotal`). Rows: `{ id, href, title, monthLabel, dayLabel, whenLabel, venue }`, built
  with `generateEventSlug` and Eastern formatting; `whenLabel` = "Thu · 7:00 PM" or "Thu · Time TBD"
  when `timeUnknown`; past rows include the year ("Thu, Aug 14, 2025"). Ties sorted by id.
  Returns null for a missing or hidden group.

### `/groups` (Group Directory)

- `app/groups/page.tsx`, `export const revalidate = 3600`, no auth/cookie reads. `Header
  activeTab="groups"`. Metadata: bare title `Groups` (layout appends `| AVL GO`), description,
  `alternates.canonical`, openGraph/twitter title + description + url.
- `max-w-7xl` column like `/posters`: h1 "Groups", subtitle "Clubs, circles, jams and crews around
  Asheville that meet again and again." with the count.
- `components/groups/GroupDirectory.tsx` (client): labelled search input (name / description / home
  base), wrapping category chips with counts ("All 393", "Outdoors & Fitness 50", ...; counts reflect
  the search), visible keyboard focus. Results grouped into category sections (h2 + count) in
  `GROUP_CATEGORIES` order; within a section, groups with upcoming events first, then the rest, each
  alphabetical. 1/2/3-column grid of compact cards linking to `/groups/[slug]`: name, 2-line
  description, meta line "Next: Thu, Oct 2 · 3 upcoming" (brand colour) or "Last event Aug 2026"
  (muted) or "No events listed", and home base. Empty-search state with a clear button.
- A DB failure renders an error message distinct from "no groups". Standard footer (copy from
  `/posters`). Dark mode on everything.

### `/groups/[slug]`

- `app/groups/[slug]/page.tsx`, `revalidate = 3600`, `generateMetadata` (bare title = group name,
  description, canonical, openGraph/twitter), `notFound()` for null, plus `not-found.tsx`.
- `Header activeTab="groups"`. `max-w-3xl` column: "← All groups", category label, h1, description,
  info lines (schedule with a calendar icon, home base with a pin icon), external links (Website;
  Meetup) when present.
- **Upcoming events (N)**: rows rendered by a server component `components/groups/GroupEventRow.tsx`
  (date badge with month + day, title, `whenLabel · venue`), linking to the event page. Empty state:
  "Nothing on the calendar right now." plus "Check their website" / "Check their Meetup page" when a
  link exists.
- **Past events (N)**: native `<details>` (collapsed by default), newest first, capped at 100 with
  "and N more" when `pastTotal` is larger.

### Sitemap

`app/sitemap.ts`: add `/groups` (daily, 0.7) and every non-hidden group page (weekly, 0.6,
`lastModified` = the group's `updated_at`). The file has unrelated uncommitted edits; keep them.

## Navigation (Agent C)

- `components/EventTabSwitcher.tsx` + `components/Header.tsx`: tabs become All Events · Top 30 ·
  **Groups** · Posters; union `'all' | 'top30' | 'groups' | 'posters'`. Groups links to plain
  `/groups`.
- `components/EventPageLayout.tsx`: keep `activeTab: 'all' | 'top30' | 'yourList'` for `EventFeed`,
  but pass `undefined` to `Header` for `yourList`.
- `components/UserMenu.tsx`: signed in: add "Your List" (above Profile) linking to
  `/events/your-list`. Signed out: today a single sign-in icon link; make it a small dropdown with
  "Sign in" and "Your List", because signed-out favorites render on Your List and the tab was their
  only way there.
- `app/profile/page.tsx`: a "Your List" link card ("Your favorites and recommended events") as the
  first card, same style as "My Taste Profile", different icon.

## Docs (main agent, after the build)

CLAUDE.md: `groups` table + RLS row, routes, scripts, matching design and limits.
`data/groups/README.md`: steps 8–10 (research, build-directory, seed). Project memory.

## Verification (main agent)

`npx tsc --noEmit`, lint on touched files, run build-directory + seed (dry run, then `--apply`),
parity check clean, `next build` (catches prerender problems like `useSearchParams` without
Suspense), dev server, Opus Chrome UX review, then a Codex review of plan + code.

## Codex plan review: triage

Adopted: read-time matching with `match_keys text[]` instead of a join table + linker + cron hook;
merge precedence + cycle validation; JSON-safe cache results with Eastern-date cache keys; list
zero-event groups ("Last event" / "No events listed", not "Last met"); signed-out access to Your
List; stable `directory_key`; Groups highlighted on detail pages; SeekHealing BLIPOC kept separate
(consistent with The Men's Nest); acceptance criteria for search, focus, mobile, dark mode, error
states, metadata, sitemap dates.

Not adopted: rejecting the King Street open jam (Matt's Oklawaha greenlight says jams count);
splitting the Toastmasters Meetup into clubs (one network listing is fine for v1); dedup-keeper
membership transfer (documented as a limit); rewriting `getStartOfTodayEastern` for its DST edge
(pre-existing, out of scope, reported to Matt); adding Suspense up front (`next build` decides).
