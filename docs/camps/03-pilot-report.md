# Summer camps pilot: report (2026-10-28)

The pilot from plan §8 (`01-context-and-plan.md`): 20 deliberately varied providers taken end to
end (extract → verify → store → show) before scaling to several hundred camps. Built and run on
Oct 28, 2026, ahead of the Nov 4 due date. A whole-pilot Codex review (§11) and four step-level
Codex review gates (§12, per Matt's rule in plan §8) ran the same day; their verifier, fetcher,
schema and display findings are fixed here, and the data-contract changes are on the Nov 5 list
(§8).

## 1. Summary

- **The extraction approach works, with one change: give Sol our own fetched page text ("bundle
  mode") as well as web search.** On the same 20 providers, bundle mode produced **649 facts, 554
  (85%) verified on the cited page, 95 sent to review, none dropped**. Web search alone produced
  404 facts with **68 dropped**: the search index quotes pages as they used to be (Lutheridge moved
  to novusway.org; all 66 of its quotes were stale). Bundle mode also found 24 registration
  milestones against search-only's 4, at the same token cost.
- **"Verified" means the quote is on the page and its date, time, amount and year agree with the
  fact, not that the fact is right.** The Codex reviews showed the first verifiers passed a wrong
  calendar year, a time read from a day number or a price, a relabeled audience or action, a
  shuffled date, an invented fragment, a grade basis and another tenant's platform page; those
  checks are now in (§4), with 24 offline regressions in `scripts/camps/test-verify.ts`. What no mechanical check
  catches: a quote read slightly wrong (Evergreen's "case-by-case" accommodation became "special
  needs: yes"), and a provider-wide statement copied onto every card. Every registration date I
  checked by hand was right.
- **Publication now has one gate**: a fact drives a card, a filter or the registration line only
  when it is verified or hand-checked (`data/camps/pilot/hand-checks.json`), and a registration
  milestone only when hand-checked (N15). Of the 24 milestones, the 11 at Camp Greenville pass.
- **The data model needs a second pass before bulk import** (§8): stable camp identity, milestones
  with scope, certainty and separate date and time evidence, a season-publication fact, evidenced
  sessions, and option-scoped hours and prices. Codex's verdict: start discovery Nov 5; hold bulk
  extraction and the DB import until those contracts are fixed.
- **Geocoding is the weak link.** HeiGIT/ORS (Pelias) placed 48 of 131 camps at an address or
  street, 69 only at the town centroid, and 14 have no publishable site. Town-level drive times are
  meaningless (the NC Arboretum came out 2 minutes from downtown) and are no longer shown or used
  for the radius. Per N12 ("Google only if geocodes are poor"), this is the case for a better
  address geocoder plus ORS for routing. **Decision needed.**
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

Flag counts (bundle mode, final): `year_not_on_page` 31, `grade_basis_not_in_quote` 20
(Lutheridge's grade lines don't say "completed"; its page does, elsewhere), `value_not_in_quote`
13, `tentative_wording` 12 (UNCA), `platform_tenant_not_linked` 10 (Mason Plumlee's 2027 Ryzer
event isn't the 2026 one the seed links; LEAF's Qgiv form isn't linked from its pages),
`unrecognized_domain` 7 (Kanuga, no seed URL), `third_party_source` 2 (Reynolds); informational:
`weekday_supports_year` 21, `needs_hand_check` 24.

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

| Provider                    |   Cards |   Facts | Verified | Review | Dropped | Reg. dates | 2027 facts |       Time | Tokens in/out  | Search-only: facts / dropped |
| --------------------------- | ------: | ------: | -------: | -----: | ------: | ---------: | ---------: | ---------: | -------------- | ---------------------------- |
| asheville-art-museum        |       4 |      27 |       27 |      0 |       0 |          0 |          0 |        70s | 20.4k / 4.2k   | 22 / 0                       |
| asheville-museum-of-science |       3 |      27 |       15 |     12 |       0 |          0 |          0 |        80s | 24.6k / 4.4k   | 18 / 0                       |
| asheville-parks-rec (model) |      17 |     170 |      170 |      0 |       0 |          0 |          0 |       259s | 25.8k / 17.4k  | 18 / 0                       |
| asheville-school            |       0 |       0 |        0 |      0 |       0 |          0 |          0 |        21s | 30.4k / 0.5k   | 0 / 0                        |
| black-mountain-summer-camp  |       1 |       6 |        6 |      0 |       0 |          0 |          0 |        31s | 15.9k / 1.4k   | 6 / 0                        |
| camp-greenville             |       6 |      27 |       17 |     10 |       0 |         11 |         27 |        88s | 30.5k / 4.8k   | 35 / 0                       |
| camp-rockmont               |       6 |      33 |       33 |      0 |       0 |          0 |         33 |        85s | 19.5k / 4.9k   | 17 / 0                       |
| evergreen-summer-adventures |       1 |      12 |       12 |      0 |       0 |          0 |          0 |        34s | 15.7k / 1.8k   | 12 / 0                       |
| hahns-gymnastics            |       1 |       4 |        2 |      2 |       0 |          0 |          0 |        44s | 30.0k / 1.7k   | 4 / 0                        |
| kanuga-day-camp             |       1 |       7 |        0 |      7 |       0 |          0 |          0 |        43s | 22.1k / 1.7k   | 7 / 0                        |
| leaf-global-arts            |       1 |      11 |        7 |      4 |       0 |          0 |          3 |        38s | 18.0k / 1.8k   | 11 / 0                       |
| lutheridge                  |      23 |      49 |        9 |     40 |       0 |          0 |         49 |       142s | 33.4k / 8.9k   | 68 / 66                      |
| mason-plumlee-basketball    |       1 |      14 |        8 |      6 |       0 |          1 |         14 |        36s | 20.7k / 1.9k   | 14 / 0                       |
| nc-arboretum                |      22 |      23 |       23 |      0 |       0 |          0 |          0 |       151s | 34.2k / 8.9k   | 3 / 0                        |
| ninjaville                  |       1 |       7 |        7 |      0 |       0 |          0 |          0 |        30s | 13.9k / 1.3k   | 0 / 0                        |
| paca                        |      11 |      33 |       33 |      0 |       0 |          0 |          0 |       118s | 23.7k / 5.8k   | 11 / 0                       |
| reynolds-baptist-vbs        |       1 |       2 |        0 |      2 |       0 |          0 |          0 |        25s | 24.6k / 0.8k   | 3 / 2                        |
| trinity-episcopal-vbs       |       1 |       8 |        8 |      0 |       0 |          0 |          0 |        26s | 15.3k / 1.3k   | 8 / 0                        |
| unca-precollege             |      12 |      96 |       84 |     12 |       0 |         12 |         12 |       183s | 28.3k / 11.9k  | 74 / 0                       |
| ymca-wnc                    |      16 |      93 |       93 |      0 |       0 |          0 |          0 |       192s | 31.8k / 12.3k  | 73 / 0                       |
| **Total**                   | **129** | **649** |  **554** | **95** |   **0** |     **24** |    **138** | **1,696s** | **479k / 98k** | **404 / 68**                 |

The search-only totals: 404 facts, 308 verified, 28 review, 68 dropped, 4 milestones.

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
  weekday check confirmed 2027 where a weekday was printed next to the date. Most of its facts are
  in review: the grade lines ("Climb High 4th–6th grade") don't say "completed", which the page
  says once, elsewhere; and its year sits outside most quotes.
- **Mason Plumlee (Ryzer)**: everything from the registration platform, including early-bird price
  deadlines, kept as price tiers. Correctly preferred the camp's own June 21–24, 2027 over a school
  news article's June 21–27. Its "Register By Jun 20, 2027 11:59pm CST" lost the CST (Codex B).
  Its 2027 facts sit on a new Ryzer event (id 338224) that its seed (the 2026 event, id 309477)
  doesn't link, so they're in review until checked: Ryzer posts a new event every year.
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
  and "registration expected mid-December 2026", now in review and shown as expected.
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

## 9. Decisions for Matt

1. **Apply `drizzle/0025_camps.sql` to the live database?** Not done. Recommendation: not yet. Codex
   and the pilot both say the milestone and identity tables change (§8, 1–3), so apply once after
   those changes. (The gate fixes already added verification columns to milestones and
   availability, and named every constraint the way Drizzle does.)
2. **Geocoding**: Google geocoding (billing account; its terms limit storing results) or hand pins
   for the ~60% (83 of 131) that come back town-level or without a site?
3. **Card granularity**: YMCA's 16 cards and Lutheridge's 23 follow D5. Keep them as cards grouped
   under the provider (as the pilot page does), or collapse site variants into one card with a site
   list?

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
