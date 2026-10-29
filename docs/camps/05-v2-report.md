# Summer camps v2: build report (Oct 28-29, 2026)

The v2 build from `04-v2-plan.md`, done in one night with parallel agents.

## Where it stands

- **Data (live camps tables, not yet on the site):** 742 providers discovered (580 verified, 162
  flagged for review), all extracted twice (prompt v1, then v2 after the UX review), 0 failures.
  913 camps listed from 428 providers inside the D3 radius: 689 with an exact drive time, 218
  estimated from their town, 6 with none. 137 cards retired by the v2 run, mostly as non-camps
  (lessons, childcare, mission trips, single events) or out of area.
- **Matt's review queue:** 675 camps, in order: 60 with a registration date short of high
  confidence, 59 low confidence, 182 medium with 2027 facts, 374 medium with 2026 facts only
  (shown labelled 2026). 69 sites need a pin.
- **Cost:** discovery 17.0M input / 0.49M output tokens and 1,922 searches; each full extraction
  ~18M / 1.2M and ~1,775 searches (two runs). At GPT-5-class list prices ($1.25/M in, $10/M out,
  $10 per 1,000 searches) that is about $45 for discovery and $50 per extraction run, ~$150 in
  all; check the Batch-AI resource for Sol's real price. The daily refresh only re-extracts
  providers whose pages changed.
- **Pages:** /camps (30 cards at a time, 2.0MB HTML for 913 camps), /camps/[slug], /admin/camps,
  reminders, saved-camps calendar, More menu, camps season banner from Nov 5.
- **Not done / follow-ups:** mapping scraped camp listings (AVL Today etc.) to their camp
  (§4.8, deferred); a stable reminder identity across date corrections; source time zones beyond
  the prompt's conversion; drive times from ORS run ~15% long at highway distances (Johnson City
  71 min, Morganton 67), so about 116 day camps near the 55-minute limit are out: Matt's call;
  /camps still ships the full compact list to the client (1.8MB RSC), fine at 913 camps.
- **Deploy order:** merge → deploy → `npx tsx scripts/camps/sync-feed-events.ts --apply` (238 camp
  events). Never sync before the deploy: older code doesn't hide camp events.

## Review gates

### Gate 1: Codex review of waves 1-2 (Oct 29)

Codex (`gpt-6.1-sol`, xhigh, read-only) reviewed `de20113..5580492`: the contract, extraction,
discovery, geocoding, schema/import, pages, admin page and header. Verdict: don't pass yet,
with 10 must-fix and 10 should-fix findings and 3 nits. Triage:

| #   | Finding                                                                                  | Call                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Invalid dates/times in an override (or extraction) can throw and take the directory down | Fixed: admin validation rejects them; display treats bad values as unknown                                                                                            |
| 2   | Month-only / "expected" dates became calendar reminders on the 1st                       | Fixed: reminders only for announced dates with a day                                                                                                                  |
| 3   | Confirm approved whatever the server had, not the revision Matt saw                      | Fixed: Confirm sends the shown hash; 409 if it changed                                                                                                                |
| 4   | An older extraction file could overwrite newer facts                                     | Fixed in the import: skip when older than the stored extraction                                                                                                       |
| 5   | Registration status mixed history, deadlines, lottery results and member-only dates      | Fixed: status from public openings + availability; others as secondary lines                                                                                          |
| 6   | Secondary registration dates lost their "unconfirmed" label                              | Fixed: every date carries its own label                                                                                                                               |
| 7   | Drive time matched against any site, not the row's own site                              | Fixed: rows keep their site; unknown stays unknown                                                                                                                    |
| 8   | The card dropped price labels and hours exceptions ($175 was a half day)                 | Fixed: labels and hours text kept on the card                                                                                                                         |
| 9   | Age↔grade conversion contradicts N11; unknown eligibility counted as "fits"              | Partly: conversion kept (the pilot UX review found the age filter useless without it, Matt's direction since); unknown or converted matches no longer count as "fits" |
| 10  | Sites with no street address still went to ORS by venue name                             | Fixed: no address, no automatic point; hand pin                                                                                                                       |
| 11  | Import could attach an old drive time to a new hand pin                                  | Fixed in the import                                                                                                                                                   |
| 12  | Reminder UIDs used a chronological ordinal                                               | Fixed: UID uses the milestone date                                                                                                                                    |
| 13  | No source time zone ("11:59pm CST" became "time not stated")                             | Deferred: needs a prompt change, which would force re-extracting everything mid-run; one camp affected                                                                |
| 14  | WebTrac roll-up availability scoped "9 weekly sessions" hid fully booked programs        | Fixed: scope null for a whole-card roll-up                                                                                                                            |
| 15  | WebTrac rebuilds advanced "last checked"; UTC date slicing                               | Fixed: catalog read time kept; Eastern formatting                                                                                                                     |
| 16  | Saved-camps calendar sync failed silently                                                | Fixed: retry + visible state                                                                                                                                          |
| 17  | Admin could only edit camps in the review queue                                          | Fixed: searchable all-camps section                                                                                                                                   |
| 18  | A `sites` override didn't create site rows to pin                                        | Fixed                                                                                                                                                                 |
| 19  | Calendar feed GET had no rate limit and wrote on every hit                               | Fixed                                                                                                                                                                 |
| 20  | Discovery could hand one church's key to another of the same name                        | Fixed: reuse needs a matching domain or town                                                                                                                          |
| 21  | Header menu ARIA state vs CSS hover                                                      | Fixed                                                                                                                                                                 |
| 22  | Zero views hidden                                                                        | Rejected: "0 views" on every new camp is noise                                                                                                                        |
| 23  | "Show unknown drive times" not in the URL                                                | Fixed                                                                                                                                                                 |

Plan gaps it listed: wave 3 (feed events, refresh cron) was still being built; town and hours
filters and "fits all my kids" added with the fixes; related camps kept (harmless).

### Gate 2: Codex review of wave 3 + the gate-1 fixes (Oct 29)

Reviewed `5580492..bf25fa9`. Verdict: doesn't pass, with 8 must-fix and 14 should-fix findings
and 1 nit. Gate-1 fixes confirmed: 2, 3, 4, 6, 8, 10, 11, 14, 17-20, 22, 23; the rest are carried
into this round (1, 5, 7, 9, 12, 15, 16, 21). Codex found no leak of camp events into Top 30 or
the default feed for events identified as camps, and no change to dedup/cleanup for other
sources.

| #   | Finding                                                                     | Call                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Scraped camp listings aren't mapped to their camp (§4.8)                    | Deferred: status-quo behavior for scraped listings; the tagger hides newly tagged ones from the default feed; mapping is a follow-up                                                                         |
| 2   | A failed read of a linked page changed the hash and re-extracted without it | Fix: any non-404 read failure fails the check                                                                                                                                                                |
| 3   | The boilerplate-stripping hash also hid facts repeated on several pages     | Fix: reverted to hashing full page text (lead's call: extra re-extractions are cheap; the confirmation hash ignores confidence, so Matt's queue only churns on fact changes)                                 |
| 4   | Adopting the first new-style hash accepted unseen changes                   | Moot after 3                                                                                                                                                                                                 |
| 5   | Import geocoding could overrun the cron's 800s                              | Fix: deadline passed into the import                                                                                                                                                                         |
| 6   | Timed-out extractions kept running and retrying                             | Fix: one abort signal through reads, model calls, retries                                                                                                                                                    |
| 7   | Registration status still mishandled reopenings and history                 | Fix: status from the ordered public milestones + availability                                                                                                                                                |
| 8   | The feed sync unhid moderation-hidden events                                | Fix: the sync uses `deadAt`, never `hidden`                                                                                                                                                                  |
| 9   | Public exports included camp events by default                              | Fix: shared camp opt-in predicate                                                                                                                                                                            |
| 10  | All events briefly rendered camp rows during the filter debounce            | Fix                                                                                                                                                                                                          |
| 11  | Refresh re-read only the first provider pages, not registration-date pages  | Fix: registration-date URLs seed the refresh bundle. Not card `sources`: 492 of 741 providers cite pages outside their bundle, and adding them would re-extract two thirds of providers once for little gain |
| 12  | No local refresh for browser-only sites and WebTrac                         | Fix: nightly local camps step                                                                                                                                                                                |
| 13  | Feed event location not tied to the dated session                           | Fix                                                                                                                                                                                                          |
| 14  | Feed descriptions dropped price/hours qualifiers                            | Fix                                                                                                                                                                                                          |
| 15  | Reminder UIDs change when a date is corrected                               | Rejected: no stable phase identity without a contract change; date-based UIDs behave in subscribed feeds                                                                                                     |
| 16  | First calendar creation could drop concurrent saves                         | Fix                                                                                                                                                                                                          |
| 17  | "Last checked" ignored successful refresh checks                            | Fix                                                                                                                                                                                                          |
| 18  | An unmatched session site inherited every site                              | Fix: unknown                                                                                                                                                                                                 |
| 19  | Unknown grade basis still said "fits"                                       | Fix: "may fit"                                                                                                                                                                                               |
| 20  | Concurrent feed syncs could collide                                         | Fix: advisory lock                                                                                                                                                                                           |
| 21  | Invalid extracted season dates could abort the import                       | Fix: semantic date check in the derived columns                                                                                                                                                              |
| 22  | Reminders bundled every audience                                            | Fix: public by default, others as separate links                                                                                                                                                             |
| 23  | Header menu keyboard reopen on desktop                                      | Fix                                                                                                                                                                                                          |

### Gate 3: confirmation of the gate-2 fixes (Oct 29)

Reviewed `242e438..582eef5`. Confirmed: 3, 4, 6, 8, 9, 10, 12, 14, 16, 18, 19, 21, 22, 23 (1 and 15
are the accepted deferral/rejection). Still open, and fixed in the next round:

- Must: a failed read in the post-extraction bundle still let the import through (#2); routing
  batches could overrun the cron deadline (#5); a passed close was ignored when a later
  deadline existed (#7: fixed so a passed close always closes, while an early-bird deadline
  before a final one still doesn't); NEW1 a connection-pool deadlock between concurrent feed
  syncs (fixed: try-lock and skip instead of waiting); NEW2 a partial WebTrac catalog read
  could replace complete cards.
- Should: all milestone URLs read in bounded batches (#11); an unmatched feed-event site now
  has no location (#13); "last checked" revalidated after unchanged checks (#17); WebTrac on
  the daily January/opening cadence (NEW3) and under a deadline (NEW4).

### UX review (Oct 29)

An Opus agent reviewed /camps and camp pages at 1280 and 375, light and dark. It used the
app's built-in browser: Claude in Chrome reported "not connected" (no browser listed). Its
P1s: the week filter dropped every 2026-dated camp; /camps shipped all ~1,070 cards (7.3MB
HTML, ~99k DOM nodes); out-of-radius camps with unplaced sites were listed. P2s: 406 camps
vanished under any drive filter; AI review notes leaked into season text and price labels;
contradictory registration copy; a grey "not announced" banner on 77% of cards; group-by-
provider hid matches; the phone layout showed no camp on the first screen; the sessions table
overflowed on phones; unclear audience labels; "may fit" for camps with no stated ages. It also
listed ~25 non-camps or out-of-area entries (swim/tennis lessons, mission trips, childcare,
Reidsville 4-H, a Charlotte camp) and one duplicate. Fixes: page items by a pages agent;
drive-time estimates from the camp's town, a prompt revision with a full re-extraction (notes
out of parent-facing text, non-camps excluded), and retiring cards a newer extraction drops
(migration 0027, approved by Matt) by a data agent.

### Gate 4: UX fixes, data v2 and the gate-3 fixes (Oct 29)

Reviewed `582eef5..802370e`. Gate-3 items confirmed except two carried over. New must-fix:
valid early-morning times (a CST 11:59 p.m. deadline converted to 00:59) were dropped by the
"before 5 a.m." display rule; a later deadline could reopen a closed registration; a strict
WebTrac read still accepted an HTTP 200 maintenance page as zero rows. Should-fix: unknown-
filter toggles could hide each other; availability scopes like "New campers" were suppressed;
retired program names weren't offered for name reuse; grade 13 was shown as 12th. All fixed in
the next round; the "before 5 a.m." rule moved to an extraction-time review flag only.

### Gate 5: confirmation (Oct 29) — passes

Reviewed `802370e..94925f2`: every gate-4 item confirmed, no must-fix. One nonblocking label bug
(a closed registration named the first passed deadline instead of the last) fixed afterwards.

### Gate 6: Matt's UI changes, exports and dedupe (Oct 29)

Reviewed `09046ce..c529e8b`. Codex confirmed the exports' live/radius/duplicate filtering, CORS,
caching and proxy exclusion, the feedback dialog's accessibility, and the 24 duplicate mappings
(no chains, permanent redirects). Must-fix, all fixed in the next round: JSON session prices lost
their 2026 label; Markdown dropped hours exceptions (LEAF's Friday noon pickup); JSON wasn't
full detail (registration wording such as "returning campers and their siblings", full
description); Google Calendar links could pick the wrong milestone; the card's match note and
footer could change height; the earliest-opening headline skipped the 'other' audience. Should:
cache version bump. Rejected: "remove the Hours row from cards" (Matt asked to drop the hours
detail text, not the row).
