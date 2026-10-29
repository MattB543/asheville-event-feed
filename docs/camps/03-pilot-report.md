# Summer camps pilot: report (2026-10-28)

The pilot from plan §8 (`01-context-and-plan.md`): 20 deliberately varied providers taken end to
end (extract → verify → store → show) before scaling to several hundred camps. Built and run on
Oct 28, 2026, ahead of the Nov 4 due date. A whole-pilot Codex review (§11), four step-level
Codex review gates and three confirmation gates (§12, per Matt's rule in plan §8) ran the same
day; their verifier, fetcher, schema and display findings are fixed here (all four steps' gates
closed), and the data-contract changes are on the Nov 5 list (§8). A final whole-branch Codex
review (gate 8) and a hands-on UX review of the pages followed on Oct 28-29; their fixes are in
too (§12).

## 1. Summary

- **The extraction approach works, with one change: give Sol our own fetched page text ("bundle
  mode") as well as web search.** On the same 20 providers, bundle mode produced **649 facts, 512
  (79%) verified on the cited page, 137 sent to review, none dropped** (543 / 106 before gate 8
  tied each fact's year to the section it sits in: PACA's pages name no year but their © footer). Web search alone produced
  404 facts with **68 dropped**: the search index quotes pages as they used to be (Lutheridge moved
  to novusway.org; all 66 of its quotes were stale). Bundle mode also found 24 registration
  milestones against search-only's 4, at the same token cost.
- **"Verified" means the quote is on the page and its date, time, amount and year agree with the
  fact, not that the fact is right.** The Codex reviews showed the first verifiers passed a wrong
  calendar year, a time read from a day number or a price, a relabeled audience or action, a
  shuffled date, an invented fragment, a grade basis and another tenant's platform page; those
  checks are now in (§4), with 61 offline regressions in `scripts/camps/test-verify.ts`. What no mechanical check
  catches: a quote read slightly wrong (Evergreen's "case-by-case" accommodation became "special
  needs: yes"), and a provider-wide statement copied onto every card. Every registration date I
  checked by hand was right.
- **Publication now has one gate**: a fact drives a card, a filter or the registration line only
  when it is verified or hand-checked (`data/camps/pilot/hand-checks.json`), and a registration
  milestone only when hand-checked (N15), "expected" dates included. Of the 24 milestones, the 11
  at Camp Greenville pass.
- **The data model needs a second pass before bulk import** (§8): stable camp identity, milestones
  with scope, certainty and separate date and time evidence, a season-publication fact, evidenced
  sessions, and option-scoped hours and prices. Codex's verdict: start discovery Nov 5; hold bulk
  extraction and the DB import until those contracts are fixed.
- **Geocoding is the weak link.** HeiGIT/ORS (Pelias) placed 48 of 131 camps at an address or
  street, 68 only at the town centroid, and 15 have no publishable site. Town-level drive times are
  meaningless (the NC Arboretum came out 2 minutes from downtown) and are no longer shown or used
  for the radius. The cause is narrower than the count: the 131 cards sit at under 40 places.
  Pelias lacks house numbers for 6 real street addresses (Rockmont, the Arboretum, PACA and Hahn's
  alone account for 40 cards), 5 places came with a name and no address (Lutheridge, Kanuga, UNCA,
  two Hendersonville Ys), and 15 cards have no checked site (mostly YMCA's school sites). The free
  US Census geocoder placed 15 of the 17 street addresses Pelias missed or put mid-street (§8.16).
  ORS's drive times also look long (Greenville SC 90 min, Hendersonville 36). **Decision needed**
  (§9).
- **No site blocked us.** The fetch ladder read all 95 seed URLs (89 plain fetch, 1 Chrome TLS, 5
  headless browser) and every page cited during verification. WebTrac needs the browser (~4.5 min
  a run). A church's public Facebook event reads fine in a real browser, not by plain fetch.
- **Cost is small**: about 24k input / 5k output tokens and 2.4 web searches per provider, ~85 s
  of model time; roughly $0.10 per provider at GPT-5-class list prices (§6).
- The rough `/camps` and `/camps/[slug]` pages work on the pilot data (noindex, rendered per
  request). The migration is written but **not applied** (`DATABASE_URL` is production).

## 2. What was built

| Piece                                                                                                                                                                            | File                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Page reader: plain fetch → `fetchAsChrome` dispatcher → headless patchright; PDFs via `unpdf`, HTML via cheerio; soft-404 and challenge detection; 12 h disk cache               | `lib/camps/fetchPageText.ts`                                                            |
| Azure Responses API v1 helper (`gpt-6.1-sol`, `web_search`, `reasoning: {effort}`, strict JSON schema, retries)                                                                  | `lib/camps/responses.ts`                                                                |
| Extraction schema (every fact has `year`, `url`, verbatim `quote`, `source_kind`); `isPublishable`                                                                               | `lib/camps/types.ts`                                                                    |
| Prompt (camp rule N8, card rule D5/N4, year and evidence rules), bundle mode, output cleaning (citation markdown, `utm_source=openai`)                                           | `lib/camps/extract.ts`                                                                  |
| Verification (§4) and its offline regressions                                                                                                                                    | `lib/camps/verify.ts`, `scripts/camps/test-verify.ts`                                   |
| Registration platform hosts (never a merge key)                                                                                                                                  | `lib/camps/platforms.ts`                                                                |
| WebTrac catalog → cards, reusing the Parks & Rec parser (only exports added; the scraper is unchanged)                                                                           | `lib/camps/webtrac.ts`, `lib/scrapers/ashevilleparksrec.ts`                             |
| Geocode + drive minutes from Pack Square (`api.heigit.org`), plausibility check                                                                                                  | `lib/camps/geo.ts`                                                                      |
| Rows shaped like the tables; display (newest year per field, registration line, publication gate)                                                                                | `lib/camps/importRows.ts`, `lib/camps/display.ts`, `lib/camps/pilotData.ts`             |
| Schema + migration for the revised §5 model (RLS deny-all)                                                                                                                       | `lib/db/schema.ts`, `drizzle/0025_camps.sql`                                            |
| Scripts: `probe-sites`, `run-pilot [--mode bundle\|search] [--only] [--force] [--verify-only]`, `read-webtrac`, `build-pilot`, `summarize-pilot`, `show-provider`, `test-verify` | `scripts/camps/`                                                                        |
| Pages                                                                                                                                                                            | `app/camps/page.tsx`, `app/camps/[slug]/page.tsx`, `components/camps/CampDirectory.tsx` |
| Pilot data (committed, like `data/groups/`), including the hand-check record                                                                                                     | `data/camps/pilot/`                                                                     |

Run order: `probe-sites` (optional) → `run-pilot` → `read-webtrac` → `build-pilot` →
`summarize-pilot`. `build-pilot` applies `hand-checks.json` and writes
`data/camps/pilot/import.json`, which the pages read until the migration is applied.

## 3. The pilot set

| Provider                                                           | Tests                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Asheville Parks & Recreation                                       | WebTrac catalog (deterministic), municipal, multi-card, resident pricing |
| Asheville Museum of Science                                        | PDF-only details (the camp guide PDF), grade bands                       |
| Camp Rockmont                                                      | Overnight camp that already lists 2027                                   |
| Reynolds Baptist Church VBS                                        | VBS whose date is only on Facebook (found in our own events table)       |
| Asheville Art Museum                                               | Grade-only eligibility, timed registration opening last year             |
| Evergreen Summer Adventures                                        | $325 / $375 tiers + $40 family fee on one card                           |
| YMCA of WNC                                                        | Multi-card provider (4 programs × sites × age bands)                     |
| YMCA Camp Greenville (SC)                                          | Out of state, overnight, at the edge of the 75-minute radius             |
| Asheville School                                                   | Site that blocks plain fetch (403; Chrome TLS gets through)              |
| Performing Arts Company of Asheville (ex-Asheville Junior Theater) | Jackrabbit catalog, moved URL, browser-only page                         |
| Hahn's Gymnastics                                                  | iClassPro                                                                |
| Lutheridge                                                         | PDF brochure, day + overnight, many programs, site moved domains         |
| UNC Asheville Pre-College                                          | Pre-college, CampDoc                                                     |
| Mason Plumlee Basketball Camp                                      | Clinic, registration-platform-only (Ryzer), early-bird deadlines         |
| LEAF Global Arts                                                   | Rising grade plus a minimum age, Qgiv                                    |
| Kanuga Day Camp                                                    | Outside Buncombe (Hendersonville), no seed URL                           |
| NC Arboretum Discovery Camp                                        | Track-specific age cutoffs, "2027 dates coming soon"                     |
| Ninjaville                                                         | Leaks into the event feed as daily listings                              |
| Town of Black Mountain Summer Camp                                 | Municipal, RecDesk, rising grades, resident pricing                      |
| Trinity Episcopal VBS                                              | VBS with its own page                                                    |

All ten required kinds from the brief are covered.

## 4. How verification works, and what it misses

Every fact is re-checked against the page it cites, fetched by our own reader:

- **Quote match**: exact after normalizing whitespace, quotes and dashes; then the parts around an
  ellipsis, in order and close together; then an alphanumeric-only match (PDF text often loses
  spacing). No match → **dropped**.
- **Value in quote**: the date (month + day), price, fee or age must appear in the quote. Times are
  parsed as times ("6:00 PM", "9am", "8:30-4:30"); a bare number such as the 6 in "October 6" is
  never read as a time.
- **Year**: when the quote names a year, a date's own calendar year must be one of them ("October
  6, 2026" can't be 2027-10-06, even though a 2027 season allows dates in 2026). A fact about a
  specific summer from a page that never mentions that year goes to review (`year_not_on_page`),
  unless a weekday written next to the date fits it ("June 7–11 Mon – Fri" is Mon–Fri only in
  2027). A weekday that doesn't fit → review.
- **Authority**: the provider's own domains come from the seed pages (discovery), where they
  redirect and what they link to, never from the model's answer alone; listing-site seeds extend
  nothing, and site builders' shared domains (wixsite, squarespace) never establish ownership. A
  registration platform counts only for the account an own page links to (a Google Form id, a
  Ryzer event id, a Qgiv org), not the whole host. The page actually read is judged too: an own
  link that redirects to a listing site is a listing site. Registration dates must come from own
  pages or linked accounts (a church's own Facebook post only for VBS, N9). Anything else →
  dropped.
- **Dates as expressions**: month, day and the year written beside them are read together
  ("October 6, 2026"; "June 15-19"; "June 29 - July 3, 2026"), so a date can't be assembled from
  a month here and a day there. Times are parsed with am/pm, one am/pm covers a range ("9:00-11:00
  AM"), and amounts like "$7.00" are never times. Amounts must match whole ("$300" is not
  "$300.50"; loose matching keeps decimal points). Grades must name both bounds, and "rising" or
  "completed" must be in the quote when the fact claims it.
- **Registration context**: the sentence around a milestone's quote must support its audience (a
  "public" date whose sentence names only "returning families" → review) and its kind ("Register
  by" is not an opening); "expected / tentative / mid-" anywhere in that sentence → review. Every
  milestone also carries `needs_hand_check` and is shown only after a hand check (N15).
- A page that can't be fetched → review, never dropped (it may be a block).

Flag counts (bundle mode, final): `year_not_on_page` 31, `grade_basis_not_in_quote` 23
(Lutheridge's grade lines don't say "completed"; its page does, elsewhere), `value_not_in_quote`
13, `tentative_wording` 12 (UNCA), `platform_tenant_not_linked` 10 (Mason Plumlee's 2027 Ryzer
event isn't the 2026 one the seed links; LEAF's Qgiv form isn't linked from its pages),
`domain_not_reviewed` 8 (Mason Plumlee's own site, linked from its Ryzer page but not yet
reviewed), `unrecognized_domain` 7 (Kanuga, no seed URL), `third_party_source` 2 (Reynolds);
informational: `weekday_supports_year` 21, `needs_hand_check` 24.

What it **can't** catch (seen in the pilot):

- **Readings that are slightly off**: Evergreen's "we will work case-by-case to determine if we can
  provide a positive experience" became `special_needs: available = true`; Ninjaville's lunch is
  full-day only; LEAF's hours end at noon on Fridays; the Art Museum's $175 is per half-day
  session while its hours span the whole day.
- **Provider-wide facts copied to every card**: UNCA's "registration expected to open in
  mid-December 2026" is the same milestone on all 12 cards.
- **Dates and times in different places**: Camp Greenville's page has "PHASE 2 - October 13,
  2026" as a heading and "All others may register starting at 7:00 PM." below it. One quote can't
  hold both, so 10 of 11 Greenville milestones sit in review although all are right.

**Hand checks** (in a real browser, about 2 minutes each; recorded in `hand-checks.json`):

- Camp Greenville's 2027 registration: Phase 1 Oct 6, 2026 for returning families at 6 / 7 / 8 PM
  by division; Phase 2 Oct 13 at 6 PM (2026 waitlist families) and 7 PM (everyone else). All 11
  extracted milestones correct.
- Reynolds Baptist VBS: the church's public Facebook event says Jun 24–26 (2026), Wed–Fri
  5:30–7:30 PM, meal provided. That matches what was extracted from the allevents copy.

## 5. Results per camp (bundle mode)

"Reg. dates" are registration milestones kept after verification (any status but dropped); "2027
facts" are facts labeled summer 2027. Time and tokens are the single model call. The last column
is the search-only run.

| Provider                    |   Cards |   Facts | Verified |  Review | Dropped | Reg. dates | 2027 facts |       Time | Tokens in/out  | Search-only: facts / dropped |
| --------------------------- | ------: | ------: | -------: | ------: | ------: | ---------: | ---------: | ---------: | -------------- | ---------------------------- |
| asheville-art-museum        |       4 |      27 |       27 |       0 |       0 |          0 |          0 |        70s | 20.4k / 4.2k   | 22 / 0                       |
| asheville-museum-of-science |       3 |      27 |       15 |      12 |       0 |          0 |          0 |        80s | 24.6k / 4.4k   | 18 / 0                       |
| asheville-parks-rec (model) |      17 |     170 |      170 |       0 |       0 |          0 |          0 |       259s | 25.8k / 17.4k  | 18 / 0                       |
| asheville-school            |       0 |       0 |        0 |       0 |       0 |          0 |          0 |        21s | 30.4k / 0.5k   | 0 / 0                        |
| black-mountain-summer-camp  |       1 |       6 |        6 |       0 |       0 |          0 |          0 |        31s | 15.9k / 1.4k   | 6 / 0                        |
| camp-greenville             |       6 |      27 |       15 |      12 |       0 |         11 |         27 |        88s | 30.5k / 4.8k   | 35 / 0                       |
| camp-rockmont               |       6 |      33 |       32 |       1 |       0 |          0 |         33 |        85s | 19.5k / 4.9k   | 17 / 0                       |
| evergreen-summer-adventures |       1 |      12 |       12 |       0 |       0 |          0 |          0 |        34s | 15.7k / 1.8k   | 12 / 0                       |
| hahns-gymnastics            |       1 |       4 |        1 |       3 |       0 |          0 |          0 |        44s | 30.0k / 1.7k   | 4 / 0                        |
| kanuga-day-camp             |       1 |       7 |        0 |       7 |       0 |          0 |          0 |        43s | 22.1k / 1.7k   | 7 / 0                        |
| leaf-global-arts            |       1 |      11 |        7 |       4 |       0 |          0 |          3 |        38s | 18.0k / 1.8k   | 11 / 0                       |
| lutheridge                  |      23 |      49 |        8 |      41 |       0 |          0 |         49 |       142s | 33.4k / 8.9k   | 68 / 66                      |
| mason-plumlee-basketball    |       1 |      14 |        0 |      14 |       0 |          1 |         14 |        36s | 20.7k / 1.9k   | 14 / 0                       |
| nc-arboretum                |      22 |      23 |       23 |       0 |       0 |          0 |          0 |       151s | 34.2k / 8.9k   | 3 / 0                        |
| ninjaville                  |       1 |       7 |        7 |       0 |       0 |          0 |          0 |        30s | 13.9k / 1.3k   | 0 / 0                        |
| paca                        |      11 |      33 |        4 |      29 |       0 |          0 |          0 |       118s | 23.7k / 5.8k   | 11 / 0                       |
| reynolds-baptist-vbs        |       1 |       2 |        0 |       2 |       0 |          0 |          0 |        25s | 24.6k / 0.8k   | 3 / 2                        |
| trinity-episcopal-vbs       |       1 |       8 |        8 |       0 |       0 |          0 |          0 |        26s | 15.3k / 1.3k   | 8 / 0                        |
| unca-precollege             |      12 |      96 |       84 |      12 |       0 |         12 |         12 |       183s | 28.3k / 11.9k  | 74 / 0                       |
| ymca-wnc                    |      16 |      93 |       93 |       0 |       0 |          0 |          0 |       192s | 31.8k / 12.3k  | 73 / 0                       |
| **Total**                   | **129** | **649** |  **512** | **137** |   **0** |     **24** |    **138** | **1,696s** | **479k / 98k** | **404 / 68**                 |

The search-only totals: 404 facts, 296 verified, 40 review, 68 dropped, 4 milestones.

The import (`import.json`) has 131 camps: 112 model cards for 18 providers plus 19 WebTrac cards
for Parks & Rec (the model's 17 Parks & Rec cards are kept only for the cross-check in §7).

Per camp, what happened and why:

- **Asheville Art Museum**: 4 cards by rising grade band, $175 per session, hours, last year's
  opening (Feb 9, 2026), all verified. No 2027 yet. The first run came back empty because the
  prompt said "open each page to confirm" and Sol's page opener returns nothing for this site;
  fixed by telling it our crawler does the confirming.
- **Museum of Science**: details come from the 2026 camp-guide PDF, which search found and our
  reader parsed. 12 facts in review because the PDF never prints "2026" (only its file name does).
  Sol flagged a real source conflict: single-day registration opens Apr 13 on the event page, May
  18 in the PDF.
- **Parks & Rec**: see §7. The city page says 2027 schedules "will be published February 1, 2027",
  a publication date the schema has no place for yet.
- **Asheville School**: correctly **0 cards**. The seed row was a summer-reading page; the only
  camps found were 2019 news stories. The blocked-site path worked (403 → Chrome TLS on every page).
- **Black Mountain**: one card, rising 1st–6th, resident / non-resident prices. The summer camp
  brochure PDF couldn't be read; RecDesk's program list was empty.
- **Camp Greenville**: 2027 dates, rates ($1,525 Base Camp, $1,675 Adventure), the $200 deposit and
  the phased registration, all correct by hand check. Its availability chart is an image and wasn't
  read. Geocoded only from the venue name (no address on its pages): 73.9 min at street level,
  inside the 75-minute overnight radius and flagged near the cutoff.
- **Rockmont**: 2027 dates and rates, and "Registration is Open!" on the 2027 page. Sol saw "general
  registration opens August 27 at 11:00 am" in search-index text of the CIT page and **left it
  out** because the prompt forbids search snippets for registration dates. Since we verify against
  the page anyway, the prompt should let it cite official-page text from the index.
- **Reynolds VBS**: our fetcher can't read Facebook (login wall to a plain fetch), so the bundle
  had nothing; Sol fell back to the allevents copy (third party → review). Hand-checked against
  the church's public Facebook event: correct.
- **Evergreen**: all 12 facts verified; the tiers and the fee are on one card, as intended. One
  overclaim (special needs, §4). Sol flagged a real conflict on the site (rising K–8 vs K–9).
- **Hahn's (iClassPro)**: thin. The summer page has policies but no dates; the iClassPro catalog
  isn't public until registration opens.
- **Kanuga**: no seed URL. Search found the right pages and every quote is on them, but with no
  anchored domain they all sit in review. Discovery must always hand extraction a seed URL.
- **LEAF**: 2027 dates and starting tuition are posted ("more info coming soon"), mixed with 2026
  fallbacks, labeled per field. Four facts come from its Qgiv registration page, which its camp page
  doesn't link, so they're in review.
- **Lutheridge**: moved to novusway.org with renamed 2027 programs; 23 cards, one per program
  (separate programs with different grades). Its program pages print dates without a year; the
  weekday check confirmed 2027 where a weekday was printed next to the date. Its new domain is
  recorded as reviewed in `providers.json` (`domains`). Most of its facts are
  in review: the grade lines ("Climb High 4th–6th grade") don't say "completed", which the page
  says once, elsewhere; and its year sits outside most quotes.
- **Mason Plumlee (Ryzer)**: everything from the registration platform, including early-bird price
  deadlines, kept as price tiers. Correctly preferred the camp's own June 21–24, 2027 over a school
  news article's June 21–27. Its "Register By Jun 20, 2027 11:59pm CST" lost the CST (Codex B).
  Its 2027 facts sit on a new Ryzer event (id 338224) that its seed (the 2026 event, id 309477)
  doesn't link, and its own site (plumleebasketball.com) is linked from Ryzer but not yet
  reviewed, so all 14 facts are in review: Ryzer posts a new event every year.
- **NC Arboretum**: **over-split**, 22 cards (one per themed week). The page says "2027 dates
  coming soon" and eligibility wasn't in the fetched text. Should be one Discovery Camp card (or one
  per age track) with themes as sessions.
- **Ninjaville**: prices ($380 full / $280 half per week, day rates), hours and lunch, 2026
  fallback. Season dates left null because "the week of June 10th" has no year, which was right.
- **PACA**: Jackrabbit listing read; 11 cards by show and age band, mostly ages only, with prices
  where they could be tied to a camp.
- **Trinity Episcopal VBS**: dates (June 22–25, 2026), eligibility (age 3, potty trained, through
  completed 5th), $45 / $25 (volunteer) tiers. Verified.
- **UNCA Pre-College**: 12 programs with 2026 dates and prices, all verified; "tentative" 2027 weeks
  and "registration expected mid-December 2026", in review; the page says "Registration date
  found, not confirmed yet" until someone checks it.
- **YMCA of WNC**: 16 cards (Adventure × 3 sites × 2 age bands, Discovery × 7 school sites, CILT ×
  2, Explorer). Correct under D5, but its Daxko "Activity Finder" isn't readable, so **no prices or
  registration dates**.

## 6. Cost and time per card

Bundle mode, 20 providers, one model call each:

|               |   Total | Per provider | Per model card (129) |
| ------------- | ------: | -----------: | -------------------: |
| Input tokens  | 478,741 |        23.9k |                 3.7k |
| Output tokens |  97,742 |         4.9k |                0.76k |
| Web searches  |      47 |          2.4 |                 0.36 |
| Model time    | 1,696 s |         85 s |                 13 s |

With 4 calls in parallel the 20 providers took about 8 minutes of wall time. Building the bundle
(our own fetches) adds 5–20 s per provider; verification is 1–2 s per provider from the page
cache. WebTrac takes ~4.5 min because Cloudflare forces the browser.

**Money:** I don't have Azure's price for `gpt-6.1-sol`. At GPT-5-class list prices ($1.25 / M
input, $10 / M output, $10 per 1,000 web searches) the pilot cost about **$2**: $0.10 per
provider, $0.016 per card. Several hundred providers, with a re-run, is on the order of $50–100
even at a few times those prices. Check the Batch-AI resource's cost view for the real number.

## 7. WebTrac (Asheville Parks & Rec)

`read-webtrac` reads the full catalog (1,186 activities; 30 searches + detail pages) and keeps every
summer row whatever its status (the scraper drops full / closed rows and looks only 120 days
ahead). 331 summer rows → **19 cards**, one per program × site × age band × summer, with the weekly
sessions and each week's status.

- **A title filter isn't enough.** "camp" in the title missed the Grant and Montford youth camps
  ("Grant Summer Week 1"), Venture Bound, Nature Nuts and Future Innovators. The rule now also takes
  camp-shaped youth programs (summer, youth / teen / therapeutic category, a 3–7 day run of 3+ hour
  days), minus afterschool.
- **Cross-check against Sol's reading of the city page: 88 of 100 comparable facts agree.** Real
  differences: Tabletop Gaming ages 10–13 on the city page vs 10–14.99 in the catalog; Sol merged
  the two Therapeutic camps (6–12 and 13–21) into one 6–18 card. The rest came from my matching
  heuristic. The catalog should win for its own rows.
- 2026 availability (Full / Unavailable) is stored as 2026 and never shown as 2027 status. Rows are
  grouped per summer, so a 2027 week can never join a 2026 card (a Codex catch).

## 8. Changes needed before scale-up (Nov 5)

Combining the pilot's findings and the Codex review. Codex: start discovery Nov 5; hold bulk
extraction and the DB import until 1–6 are done.

Data contract (schema + extraction):

1. **Camp identity**: `camp_key` is built from the model's name and variant today, which changed
   between runs for 5 of 16 YMCA cards. Enumerate each provider's offerings first, persist
   program / site / eligibility identities with reviewed aliases and platform IDs, and match new
   extractions to them before any row is written.
2. **Registration milestones**: a stable milestone key with phase and scope ("D3 campers",
   "returning families"); `certainty: announced | expected` with the approximate text ("mid-December
   2026"); `applies_to: provider | card` so a provider-wide date is one row, not 12; separate date
   and time evidence spans; the source timezone kept ("11:59pm CST"); approval bound to the
   reviewed revision. The `(camp, season, audience, kind)` unique index in `0025_camps.sql` can't
   hold division-specific phases and must change.
3. **Season publication**: an evidenced `{year, status: posted | coming_soon | not_posted,
publish_date?, quote}` per provider or card ("2027 dates coming soon", "published February 1,
   2027"), instead of inferring it from whether any 2027 fact exists.
4. **Sessions with evidence**: sessions get a URL and quote and are verified; the season envelope
   is derived from accepted sessions (most `value_not_in_quote` flags were season spans quoted from
   one week).
5. **Options and exceptions**: hours and prices scoped to an option and weekday (half-day vs full
   day, Friday noon end, care add-ons); tuition, add-ons, required fees and credited deposits kept
   apart; conditions on tiers kept on the card (Trinity's volunteer rate).
6. **Support facts** (`financial_aid`, `special_needs`, `lunch`, `transportation`):
   `yes | case_by_case | no | unknown` with the official wording and scope; show the wording, not
   a badge.
7. **Availability** with session scope, verification and observation history (the pages now refuse
   to headline unverified or session-scoped readings, but the rows still lose that detail).

Prompt and pipeline:

8. Themed weeks of one program with the same eligibility stay on **one** card with themes as
   sessions (NC Arboretum: 22 → 1–4).
9. Allow registration dates from official pages seen only through the search index; verification
   decides (Rockmont's Aug 27, 11 a.m.).
10. Keep bundle mode. Pick links better: skip login, cart, privacy, terms, alert, contact and
    generic university pages; prefer PDFs and pages with dates, rates or registration in the URL or
    anchor text; follow one more hop to PDFs.
11. Version extraction runs (prompt + schema fingerprint, run manifest) so a resume never reuses an
    old extraction silently, and validate formats and cross-field consistency after parsing.
12. **Geocoding**: a better address geocoder for sites (Google, or hand pins for the rest), ORS for
    the drive-time matrix. Keep coordinates and geocode quality with each site.
13. **Facebook (VBS)**: try the headless rung on public `facebook.com/events/*` pages before a hand
    check.
14. Store `text_hash` and the successful fetch time per page in `camp_observations`, separate from
    verification time, so "last checked" can't advance on a failed or cached read.
15. Verifier follow-ups left open by the last review gate (none occurs in the pilot data): Sawyer
    `/v2/checkout/` URLs need a real account id; a quote holding a whole sentence with both an
    opening and a deadline still lets the deadline date pass as an opening; a seed that redirects
    to another platform account regains authority if that page links to itself.
16. **Location**: geocode street addresses with the US Census geocoder (free, no key, public
    domain, so the points can be stored, unlike Google's), ask the extraction for the street
    address (most camps print it), and hand-pin the rest (the Arboretum, YMCA's school sites).
    Straight-line miles from the camp's town could decide the radius instead of drive time (60 mi
    overnight / 40 mi day is close to D3), so the geocoder never decides who's in; ORS drive times
    run long here and need checking against a known route before they're shown. Matt to decide.
17. **Card granularity** (UX review and §9.3): one card per program, with sites, weeks/themes, age
    bands and price tiers as rows inside; a new card only for a different program or camp type.
    Pilot: 131 cards to about 45-50. Filters match on the rows and the card says what matched.
18. **Week-level truth on cards** (UX review): show session weeks, not a season span ("Jun 29 - Jul
    24" hid that the Art Museum has no week of Jul 13), add a "Week of" filter, keep half-day and
    per-day qualifiers on the card price and normalize the price sort to a week. Builds on §8.4-5.
19. **Variants are parent-facing text**: the prompt must not put reviewer notes in `variant`
    ("individual trips require further review", "attendance site unconfirmed").
20. **Last year's opening needs a hand check** (gate 8). The Art Museum's, AMOS's and Parks & Rec's
    no longer show until checked; worth doing for every provider, since it is the best hint a
    parent gets before 2027 dates are out.

## 9. Decisions for Matt

1. **Apply `drizzle/0025_camps.sql` to the live database?** Not done. Recommendation: not yet. Codex
   and the pilot both say the milestone and identity tables change (§8, 1–3), so apply once after
   those changes. (The gate fixes already added verification columns to milestones and
   availability, and named every constraint the way Drizzle does.)
2. **Location** (§8.16): Census geocoder plus hand pins (recommended; Google's terms don't allow
   storing its geocodes), and the radius by straight-line miles from the town (60 / 40) or by drive
   time (D3)?
3. **Card granularity** (§8.17): one card per program with sites, weeks and age bands inside
   (recommended, and the UX review's pick), one per provider, one per week, or today's split?

## 10. Blocked sites

None blocked outright. From the 95-URL probe and the pilot's own fetches:

- **Asheville School**: 403 to plain fetch; Chrome TLS fingerprint gets through.
- **WebTrac (Parks & Rec)**: Cloudflare challenges the HTTP path; the headless browser works.
- **PACA (ex-Asheville Junior Theater)**, **Ruby Ranch**, **The Asheville Kitchen**: 404 to plain
  fetch, real pages in the browser.
- **WNC Dance Academy**: broken TLS certificate chain for Node; only the browser reads it.
- **Buncombe County Schools ag camp**: JavaScript-rendered (thin to plain fetch); browser.
- **Facebook**: login wall to plain fetch; public events readable in a real browser (N9 hand check).
- **Account-only catalogs** (not blocks, but no data): YMCA's Daxko Activity Finder, iClassPro
  before registration, CampMinder/CampInTouch and CampDoc logins.

## 11. Codex review (2026-10-28)

`gpt-6.1-sol` at xhigh, read-only, over the pilot code and data (no Azure, ORS or DB calls). Its
verdict: **"Start Nov 5 discovery. Hold bulk extraction and DB import until the verification,
scope, identity, and publication contracts are corrected. Use bundle-first extraction and replace
the primary geocoder."** Its reproductions were run against saved pages, and the ones on the
verifier are now regression tests.

**Must-fix findings, triaged:**

| Codex finding                                                                             | Status                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong calendar year verifies (Greenville at 2027-10-06 with an "October 6, 2026" quote)   | **Fixed**: the date's own year must be in the quote when the quote names years (`date_year_not_in_quote`)                                                          |
| Time matching accepts unrelated numbers, ignores am/pm (06:00 from "October 6")           | **Fixed**: meridiem-aware time parsing (`timesInQuote`)                                                                                                            |
| No check of audience, kind or applicability (returning → public, opens → deadline verify) | **Partly fixed**: context checks flag both for review; real applicability needs the §8.2 milestone model and hand checks                                           |
| Source ownership comes from the model being verified; any platform tenant counts          | **Fixed**: authority anchored in seed pages and their links; platform hosts must be linked from an own page; social sources always need a hand check               |
| Review and hand checks don't gate publication                                             | **Fixed**: one `isPublishable` rule for cards, filters and the registration line; hand checks recorded in `hand-checks.json`                                       |
| UNCA "expected mid-December" becomes 12 verified milestones                               | **Partly fixed**: `tentative_wording` → review, shown as "expected, not confirmed"; certainty / approximate text / provider scope are §8.2                         |
| Registration state ignores time, deadlines and precision                                  | **Fixed**: opening instants in Eastern time, month precision lasts the month, passed public deadlines close, a past opening reads as history                       |
| Availability loses provenance and overstates scope                                        | **Partly fixed**: rows keep verification; only settled readings headline; a session-scoped "full" reads "some sessions full". Scoped readings and history are §8.7 |
| Camp identity changes with model wording                                                  | **Nov 5** (§8.1)                                                                                                                                                   |
| Milestone uniqueness can't hold phases                                                    | **Nov 5** (§8.2); migration not applied                                                                                                                            |
| WebTrac groups across season years                                                        | **Fixed**: grouped per summer                                                                                                                                      |
| Sibling locations become attendance sites; centroids decide the radius                    | **Fixed**: no sibling fallback; town-level geocodes leave the radius unknown and store no drive time                                                               |
| Verified hours/prices omit exceptions (LEAF Friday noon, Art Museum half-day price)       | **Nov 5** (§8.5)                                                                                                                                                   |
| Sessions bypass verification                                                              | **Nov 5** (§8.4); the detail page now says sessions aren't individually verified                                                                                   |
| Conditional accommodations become "Yes"; scoped lunch becomes a badge                     | **Nov 5** (§8.6)                                                                                                                                                   |

**Should-fix:** "2027 details posted" now needs a publishable 2027 fact (fixed); both pages render
per request so the registration line follows the clock (fixed); an extraction whose response isn't
`completed` is rejected (fixed). For Nov 5: last-checked from successful fetch time (§8.14), price
summaries per unit and tier, source timezone (§8.2), weekday checks tied to their date expression
(done for the first date; full association later), Chrome-TLS rung keeping the final URL and
content type, run versioning (§8.11).

**Nice to have** (later): report publishable counts separately from quote-found counts; keep
directory filters in the URL; surface extra eligibility restrictions (Trinity's potty-training rule)
on the card.

**Codex on the two open choices:** bundle mode as the default, with search for discovery and
missing official subpages ("evidence-match rates, not factual precision"); replace Pelias as the
primary geocoder and keep ORS for routing. Both match §8.

## 12. Review gates (plan §8, Matt's rule of 2026-10-28)

After the pilot was built, Matt asked for a Codex review after every major implementation step,
checking that the step (a) follows the plan, (b) is fully correct and (c) is as simple and clean as
it should be, with every finding triaged (adopt, or reject with a reason) and fixed before the
next step. The pilot's steps already existed, so the gates ran retroactively, one per step, in
parallel (`gpt-6.1-sol`, xhigh, read-only), followed by a confirmation gate over the fixes. Gate 0
is the whole-pilot review in §11.

| Gate | Step                                                                                | Verdict                                                                    | Findings (must / should / nice)                | Outcome                                                            |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| 0    | Whole pilot                                                                         | Hold bulk extraction and DB import                                         | 15 / 10 / 2                                    | §11: verifier and display bugs fixed; contract items to Nov 5 (§8) |
| 1    | Fetch layer: `fetchPageText`, `responses`, `platforms`, `geo`, `webtrac`            | Pass with fixes                                                            | 2 / 7 / 3                                      | All adopted; one adopted in part                                   |
| 2    | Extraction + verification: `types`, `extract`, `verify`, `run-pilot`, `test-verify` | Fail                                                                       | 12 / 2 / 2                                     | All adopted; one adopted in part                                   |
| 3    | Schema + import: schema, `0025_camps.sql`, `importRows`, `build-pilot`              | Fail                                                                       | 1 / 7 / 3                                      | All adopted                                                        |
| 4    | Pages + display: `display`, `/camps`, `/camps/[slug]`, `CampDirectory`              | Fail                                                                       | 6 / 4 / 2                                      | All adopted                                                        |
| 5    | Confirmation of gates 1–4                                                           | Gate 3 closed; 1, 2, 4 open                                                | 9 partly fixed + 2 must / 2 should regressions | All adopted                                                        |
| 6    | Second confirmation                                                                 | Gate 4 closed; 1, 2 open                                                   | 4 partly fixed + 2 must / 1 should regressions | All adopted                                                        |
| 7    | Final confirmation of gates 1–2                                                     | Gate 1 closed with a follow-up; gate 2 open on one regression, since fixed | 4 partly fixed + 2 must regressions            | One fixed; the rest are Nov 5 follow-ups (§8.15)                   |
| 8    | Final deep review of the whole branch                                               | Sound base; fix 4 musts before bulk extraction                             | 4 / 4 / simplifications                        | All adopted; fixed and re-verified                                 |
| UX   | Hands-on UX review of `/camps` and `/camps/[slug]` (Opus, browser)                  | Filters and registration messaging untrustworthy in places                 | 7 P1 / 11 P2 / ~15 P3                          | Filter and wording P1s fixed; the rest to Nov 5 (§8.17-20)         |

### Gate 1: fetch layer

- _Must:_ platform authority was host-wide (one linked Google Form authorized every form). **Adopted:**
  `platformTenant()` keys an account by host plus its id (Google Form, Jotform, Ryzer event,
  Jackrabbit org, Qgiv org, CampDoc org, Eventbrite event); subdomain platforms by host.
- _Must:_ a cleared Cloudflare interstitial kept its first 403. **Adopted:** the status is the last
  main-document response.
- Shared site-builder domains (Squarespace, Wix, Shopify) could establish ownership. **Adopted:**
  the whole host is the identity on those domains.
- The WebTrac adapter dropped the catalog's registration tooltips. **Adopted in part:** a tooltip
  with a date becomes a milestone (parser-verified, still needs a hand check). **Rejected for now:**
  relative rules ("opens 30 days before start date") aren't dates and have no field until
  milestones can hold approximate wording (§8.2).
- Chrome dispatcher raced across concurrent reads; a PDF without `.pdf` broke browser navigation;
  the Responses body read sat outside the retry; "Check Availability" became `closed`. **All
  adopted** (shared promise; download fallback; body read inside the retry; unknown statuses map to
  `unknown`).
- Simplicity: each page was converted twice, unused exports, a made-up `fetchMethod` on WebTrac
  checks. **All adopted.**
- Check after fixing: the 95-URL probe reads every URL exactly as before (89 plain fetch, 1 Chrome
  TLS, 5 browser, 0 failed).

### Gate 2: extraction + verification

- _Must:_ N15 wasn't enforced (a verified milestone was publishable without a hand check). **Adopted:**
  milestones need a hand check (`isPublishableMilestone`); Mason Plumlee's deadline now reads
  "Registration date found, not confirmed yet".
- _Must (8 reproductions of wrong facts passing as verified):_ dates as loose tokens ("October 6,
  2026" verifying 2027-10-06; June 20 from "June 10 … July 20"); short ellipsis fragments ignored
  (an invented "May 9"); $1499 vs $14.99 and $300 vs $300.50; "$7.00" read as 7 p.m. and "9:00–11:00
  AM" as 9 p.m.; deadline relabeled as opening and "returning families in all programs" as public;
  "expected" just outside the quote; grades unchecked (rising 3–5 verifying completed K–12); a
  Friday start verified by "June 12–16 Mon–Fri". **All adopted**, each now a case in
  `scripts/camps/test-verify.ts` (24 cases).
  - **Rejected in part:** "ambiguous times should require review". A range with am/pm on either end,
    or one that runs backwards ("8:30–4:30", a camp day), is resolved; a single unlabeled time or a
    forward unlabeled range still accepts both readings. Flagging those would send nearly every
    camp's hours to review, and registration times in the pilot all carry am/pm. Revisit if a wrong
    time gets through.
- _Must:_ authority could grow through a listing-site seed's links or a sponsor domain the model
  named, and was judged on the requested URL, not where it redirected. **Adopted:** only own and
  platform seeds extend authority; the model may add only the provider website, and only if an own
  seed links it; redirects are re-judged (a milestone that lands on a listing is dropped).
- Resumed runs skipped the completed-status guard; the tenant regression was masked (its quote
  wasn't on the fake page). **Adopted.**
- Simplicity: the tentative regex existed twice and disagreed; unused `hostLabel` and field types.
  **Adopted:** `lib/camps/wording.ts`; deleted the rest.
- Effect, checked by hand: verified 580 → 554 after this gate (543 after gates 5–6), review
  69 → 95 (106). The new review flags land on
  Lutheridge's grade lines that don't say "completed" (20) and on facts from platform accounts the
  seed pages don't link (10: Mason Plumlee's 2027 Ryzer event, LEAF's Qgiv form). Reading the flags
  also turned up three false positives from the new parsers, fixed before counting: Lutheridge's
  word-joiner after dashes ("June 13–⁠18"), names run into grades ("Climb High4th–6th"), and
  "rising seniors / sophomores" as grades.

### Gate 3: schema + import

- _Must:_ the tables couldn't store the verification the rows carry. **Adopted:** milestones and
  availability get `verify_status`, `flags`, `checked_at`, `hand_checked_at`, `hand_checked_by`,
  `hand_check_source`.
- Hand-check source discarded (Reynolds still cited the listing). **Adopted:** kept and shown
  ("Confirmed on facebook.com").
- Imports wrote `hidden: false`; weekly FMIDs collapsed to one; typed filter columns used
  review-only facts; town-level geocodes still carried drive minutes; PK/FK names differed between
  Drizzle and the SQL. **All adopted** (no `hidden` in imports; every FMID kept; filter columns from
  publishable facts only; town-level matches aren't routed; named PKs in Drizzle, Drizzle-style FK
  names in SQL).
- Simplicity: availability stored twice; untyped season facts forcing casts; an unused `corrected`
  hand-check result. **All adopted.**

### Gate 4: pages + display

- _Must (6):_ unverified milestones reached the "expected" headline; tags and combined
  eligibility/hours lost their own year; a newer unconfirmed fact hid an older confirmed one; a
  session-scoped "full" or "closed" became the whole camp's status; an unspecified grade basis was
  filtered as rising; an "expected" deadline closed registration. **All adopted:** separate
  `published` (cards, filters) and `facts` (details) selections; a year label on every part and
  tag; scoped readings shown as "Session A: full" with the rest unknown; unspecified basis matches
  as unknown; tentative milestones never open or close anything and read as history once their
  month passes.
- Availability lacked its quote and source on the detail page; the provider "Show all" button
  lacked `aria-expanded`; `as never` casts; a second ordinal formatter; unused card fields. **All
  adopted.**
- Check after fixing, in the dev server: /camps shows Greenville "opened Oct 13, 2026" (hand-checked),
  UNCA "expected December 2026", Mason Plumlee "date found, not confirmed yet", the Art Museum's
  financial-aid tag labeled 2026; Reynolds' detail page shows "Confirmed on facebook.com"; no
  server errors.

### Gate 5: first confirmation

Codex checked every adopted fix against its finding, replayed all 40 saved verifications offline,
and rebuilt the import in memory (matched the committed rows). **Gate 3 closed.** Still open:

- _Partly fixed, now adopted:_ N15 applied to the one publication rule (`isPublishable` now
  requires a hand check for anything flagged `needs_hand_check`, including the "expected" headline:
  UNCA now reads "Registration date found, not confirmed yet"); month-precision dates keep their own
  year; action conflicts read in the quote's sentence; "all campers returning from Summer 2026" is
  not "everyone"; platform accounts with no known id format never authorize (UltraCamp `idCamp`
  added); seeds are judged by where they land, and a model-named website waits for review
  (`domain_not_reviewed`) unless a person lists it in `providers.json` `domains` (Lutheridge's
  novusway.org, reviewed); redirects compared by account, and the resolved URL kept on the check;
  "current" grade basis needs evidence; browser PDF downloads read from Chromium.
- _Regressions my fixes introduced, now fixed:_ dropping the old calendar-year guard let "2026
  registration opens October 6" verify as 2027-10-06 (guard restored alongside the date
  expressions); "12:30–4:30" read as 00:30 (an unlabeled range starting at 12 starts at noon); ISO
  dates weren't parsed; "K–5" missed grade 5.
- _Rejection reviewed:_ Codex judged the remaining am/pm tolerance for camp hours reasonable.

### Gate 6: second confirmation

**Gate 4 closed.** Still open, all adopted:

- ActiveNet accounts (in the URL path) shared authority; subdomain accounts are now accepted only
  on platforms that use them (CampInTouch, WebTrac, RecDesk, CampBrain, SportsEngine, Square,
  Church Center), and ActiveNet, iClassPro, Sawyer, Amilia and Subsplash accounts are parsed.
- "Registration opens January 10, 2027; register by June 20, 2027" with only "June 20" quoted
  verified as an opening: action conflicts are now judged in the date's own clause.
- "Grades 3–5 welcome. Current students receive a discount" counted as "current grade" evidence:
  the wording must now name the grades.
- Registration times with no am/pm in the quote: now `time_ambiguous` (review); the hours
  tolerance stays.
- _Regressions, now fixed:_ a seed redirecting to another platform account authorized that
  account; Chromium downloads hid a redirect (now `download.url()`); "opens October 2027" beside
  last year's "October 6, 2026" was rejected (month-only and full-date mentions read together).
- Checking these on the pilot data found one more false positive of my own: "10am" (no space
  before "am") read as a time without am/pm. Fixed before counting.
- The regression script now has 43 cases. The pilot numbers are unchanged by gate 6 (none of these
  cases occur in the 20 providers): 543 verified, 106 review, 0 dropped.

### Gate 7: final confirmation

Codex replayed all 40 saved runs offline (1,053 facts) and ran the 43 regressions. **Gate 1 closed
with a follow-up** (Sawyer checkout URLs share an account id; Sawyer isn't in the pilot). Gate 2
stayed open on one new regression: month-only facts could take their year from an abbreviated or
day-first date ("Oct. 6, 2026", "6 October, 2026"). **Fixed after the gate**: a month inside a
written full date now counts only with that date's year; two regression cases added (45 in all).
That fix was not re-reviewed by Codex. Codex itself suggested the other two partly-fixed items
(a whole-sentence quote with both an opening and a deadline; a redirected seed account that links
to itself) as Nov 5 follow-ups rather than keeping the gate open: they are §8.15.

The pilot numbers are unchanged by gates 6 and 7: 649 facts, 543 verified, 106 review, 0 dropped.

### Gate 8: final deep review (Oct 28-29)

A whole-branch review at xhigh, looking at the seams between layers and at the unreviewed gate-7
fix. Codex replayed all 40 saved runs offline (1,053 facts) and rebuilt the import in memory (both
matched). Verdict: the architecture is a sound base; four musts before bulk extraction; no migration
blocker beyond §8. All findings adopted:

- _Must:_ availability checked the quote but not its status or season ("2026 Registration Closed
  ... When 2027 Registration Opens" verified as 2027 closed; "is closed" verified as open). Now the
  quote must state the status and no other, and the status's own clause must name this season or
  none (`availability_status_not_in_quote`, `availability_status_conflict`,
  `availability_year_conflict`).
- _Must:_ a page's year came from anywhere on it, footer included, and ages and grades skipped the
  check (PACA's dates and prices "verified" for 2026 on pages whose only year is "© 2026"). Now the
  year must govern the quote: the nearest year above it (a dated year like "October 13, 2026" does
  not hide the section heading above it), one written just after it, or one below a title; © and
  "all rights reserved" years never count; ages and grades are year-checked. A first version
  (years within 4,000 characters) flagged 34 correct facts whose "2026" heading sat above a long
  list (Parks & Rec, the Arboretum, the Art Museum, LEAF), and a nearest-year-above rule flagged
  Camp Greenville's 2027 deposit (5) under "families of 2026 waitlisted campers", with "rates for
  summer 2027" just after it; the final rule flags none of those. Net effect on the pilot: 31 facts to review, all genuine (PACA 29: footer
  year only; Hahn's and Lutheridge: the page never names the season).
- _Must:_ last year's opening ("Opened Feb 9, 2026 last year") skipped N15 and the context checks,
  and "Register by February 9, 2026" verified as an opening. Now it is a registration date like any
  milestone: official source, `kind_conflict` and audience checks, `needs_hand_check` (§8.20).
- _Must:_ "Camp runs June 3-12, 2027" verified as ages 3-12, and "K-2 and grades 6-8" as rising
  K-8. Now ages must come from one stated age range ("ages 4-7 and 8-16", "13-adult", "15+"; dates
  are blanked first) and every grade from min to max must be covered.
- _Should:_ parenthesized years ("October 6 (2026)") are bound to their date; `run-pilot` exits
  non-zero when a provider fails (its old files would otherwise feed the build); an availability
  scope covering every session ("All four sessions") is camp-wide; 16 regression cases added (61).
  Publication and display assertions are not in the script yet (Codex ran 16 of its own offline;
  they passed): a Nov 5 item.
- Simplifications: `dateExpressions` evaluated once per check; `evidenceItems` moved to `types.ts`
  so import code no longer depends on the verifier; `hostOf` and `campKeyFor` private;
  `hashPageText` deleted until §8.14 needs it. Also from reading the replays: quote positions now
  use the whole quote before its first 40 characters (two Greenville sentences share a 40-character
  opening), and sentences split on "!" and "?" as well as ".".
- Not re-reviewed by Codex after these fixes.

### UX review (Oct 29)

An Opus agent used the pages as a parent would (four scenarios: a week for a 7-year-old, overnight
registration timing, browsing by interest, the big providers), at desktop, 375 px and in dark mode.
It ran in the app's built-in browser: the Claude in Chrome window was minimized and screenshots
timed out. No console errors.

- **Fixed now (P1):** the age filter ignored camps that state only grades and the grade filter
  those that state only ages (a 7-year-old saw "Rising 9th-12th"; `fitsKid` now converts: rising
  grade = age - 5 or 6, and an unspecified basis fits when either reading does); the drive filter
  silently hid 68 camps with no drive time (now "68 without a drive time hidden · show them");
  filters were lost on Back (now in the URL, as on /groups); verifier codes, "not yet by Matt" and
  "needs a look" showed on detail pages (now plain "not confirmed yet" / "checked in a browser");
  "(time not stated)" printed above a quote that states 11:59pm; the card said the date was "shown
  on the details page once checked" when it already was. Also: "unconfirmed" instead of a yellow
  "check" chip, "Rising 1st grade and up", "About 1 min drive", a "Clear filters" button on the
  empty state.
- **Rejected:** putting UNCA's "expected December 2026" on the card unconfirmed. N15 (Matt's
  decision) keeps every registration date off cards until a person checks it; the detail page shows
  it labeled.
- **To Nov 5** (it changes with the card redesign): card granularity (§8.17), session weeks, a
  "Week of" filter, price qualifiers and a per-week price sort (§8.18), pipeline text in variants
  (§8.19), last year's opening for every provider (§8.20), unconfirmed-but-found facts shown in an
  unconfirmed style on cards, a single card-level "2026 details" note instead of per-fact chips
  (touch devices never show their tooltip), a collapsed filter panel at 375 px, search over
  descriptions and session names, pill chips like /groups, map links for addresses, and a check of
  the hidden duplicate page copy dev mode renders.

**Where the gates stand:** all gates closed; the gate-8 and UX fixes have regression cases and a
browser check but no further Codex pass. Pilot numbers after gate 8: 649 facts, 512 verified, 137
review, 0 dropped.
