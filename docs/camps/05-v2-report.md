# Summer camps v2: build report (Oct 28-29, 2026)

The v2 build from `04-v2-plan.md`, done in one night with parallel agents. Numbers and open items
are filled in as each stage lands.

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
