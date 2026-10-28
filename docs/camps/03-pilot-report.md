# Summer camps pilot: report (2026-10-28)

The pilot from plan §8 (`01-context-and-plan.md`): 20 deliberately varied providers taken end to
end (extract → verify → store → show) before scaling to several hundred camps. Built and run on
Oct 28, 2026, a week ahead of the Nov 4 due date.

## 1. Summary

- **The extraction approach works, with one change: give Sol our own fetched page text ("bundle
  mode") as well as web search.** On the same 20 providers, bundle mode produced **649 facts, 602
  of them (93%) found word for word on the cited page**, 47 sent to review and **none dropped**.
  Web search alone produced 404 facts, 68 dropped (17%), because the search index quotes pages as
  they used to be (Lutheridge moved to novusway.org; all 66 of its quotes were stale). Bundle mode
  also found 24 registration milestones against search-only's 4. Same token cost.
- **Verification catches what it is built to catch** (quotes not on the page, stale index text,
  third-party sources, a 2026 page relabeled 2027) but **"verified" means "the quote is on the
  page", not "the field is right"**. In the ~60 facts I read by hand, the model's reading of a
  quote was wrong or overclaimed once or twice; every registration date I hand-checked was right.
- **The data model holds**, with a handful of changes before scale-up (§8): registration dates
  need a separate date quote and time quote, a "tentative/expected" marker and provider-level
  scope; seasons need a "2027 posted / coming soon / not posted" fact; tri-state support flags;
  and a camp identity that doesn't depend on the model's wording.
- **Geocoding is the weak link.** HeiGIT/ORS (Pelias) placed only 38 of 131 camps at an address
  or street; the other 93 fell back to the town centroid (the NC Arboretum came out 2 minutes from
  downtown). Nominatim found 3 of 10 test addresses. Per N12 ("Google only if geocodes are
  poor"), this is the case for Google geocoding plus ORS for drive times. **Decision needed.**
- **No site blocked us.** The fetch ladder read all 95 seed URLs (89 plain fetch, 1 Chrome TLS, 5
  headless browser) and every page cited during verification. WebTrac needs the browser (4 min a
  run). A church's public Facebook event reads fine in a real browser but not by plain fetch.
- **Cost is small**: about 24k input / 5k output tokens and 2.4 web searches per provider, ~85 s
  of model time; roughly $0.10 per provider at GPT-5-class list prices (§6). Several hundred
  providers is tens of dollars.
- The rough `/camps` and `/camps/[slug]` pages work on the pilot data (noindex). The migration is
  written but **not applied** (`DATABASE_URL` is production).

## 2. What was built

| Piece                                                                                                                                                              | File                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Page reader: plain fetch → `fetchAsChrome` dispatcher → headless patchright; PDFs via `unpdf`, HTML via cheerio; soft-404 and challenge detection; 12 h disk cache | `lib/camps/fetchPageText.ts`                                                            |
| Azure Responses API v1 helper (`gpt-6.1-sol`, `web_search`, `reasoning: {effort}`, strict JSON schema, retries)                                                    | `lib/camps/responses.ts`                                                                |
| Extraction schema (every fact has `year`, `url`, verbatim `quote`, `source_kind`)                                                                                  | `lib/camps/types.ts`                                                                    |
| Prompt with the camp rule (N8), card rule (D5/N4), year and evidence rules; bundle mode; output cleaning (citation markdown, `utm_source=openai`)                  | `lib/camps/extract.ts`                                                                  |
| Verification (§4)                                                                                                                                                  | `lib/camps/verify.ts`                                                                   |
| Registration platform hosts (never a merge key)                                                                                                                    | `lib/camps/platforms.ts`                                                                |
| WebTrac catalog → cards, reusing the Parks & Rec parser (exports only; the scraper is unchanged)                                                                   | `lib/camps/webtrac.ts`, `lib/scrapers/ashevilleparksrec.ts`                             |
| Geocode + drive minutes from Pack Square (`api.heigit.org`), plausibility check                                                                                    | `lib/camps/geo.ts`                                                                      |
| Rows shaped like the tables; display logic (newest year per field, registration line)                                                                              | `lib/camps/importRows.ts`, `lib/camps/display.ts`, `lib/camps/pilotData.ts`             |
| Schema + migration for the revised §5 model (RLS deny-all)                                                                                                         | `lib/db/schema.ts`, `drizzle/0025_camps.sql`                                            |
| Scripts: `probe-sites`, `run-pilot [--mode bundle\|search] [--only] [--force] [--verify-only]`, `read-webtrac`, `build-pilot`, `summarize-pilot`, `show-provider`  | `scripts/camps/`                                                                        |
| Pages                                                                                                                                                              | `app/camps/page.tsx`, `app/camps/[slug]/page.tsx`, `components/camps/CampDirectory.tsx` |
| Pilot data (committed, like `data/groups/`)                                                                                                                        | `data/camps/pilot/`                                                                     |

Run order: `probe-sites` (optional) → `run-pilot` → `read-webtrac` → `build-pilot` →
`summarize-pilot`. `build-pilot` writes `data/camps/pilot/import.json`, which the pages read until
the migration is applied.

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
| YMCA Camp Greenville (SC)                                          | Out of state, overnight, at the edge of the 75-minute radius (74.3 min)  |
| Asheville School                                                   | Site that blocks plain fetch (403; Chrome TLS gets through)              |
| Performing Arts Company of Asheville (ex-Asheville Junior Theater) | Jackrabbit catalog, moved URL, browser-only page                         |
| Hahn's Gymnastics                                                  | iClassPro                                                                |
| Lutheridge                                                         | PDF brochure, day + overnight, many programs, site moved domains         |
| UNC Asheville Pre-College                                          | Pre-college, CampDoc                                                     |
| Mason Plumlee Basketball Camp                                      | Clinic, registration-platform-only (Ryzer), early-bird price deadlines   |
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
  ellipsis in order; then an alphanumeric-only match (PDF text often loses spacing). No match →
  **dropped**.
- **Value in quote**: the stated date (month + day), time, price, fee or age must appear in the
  quote. Else → review.
- **Year**: a year in the quote or the URL must match the fact's season (or the year before, for
  registration dates); a fact about a specific summer from a page that never mentions that year →
  review (`year_not_on_page`), unless a weekday in the quote fits the date, which only happens in
  the right year ("June 7–11 Mon – Fri" is Mon–Fri only in 2027). A weekday that doesn't fit →
  review.
- **Registration-date source**: the camp's own domain or a registration platform; a church's own
  Facebook/Instagram post only for VBS (N9); anything else → dropped. Every milestone is also
  marked `needs_hand_check` (N15).
- A page that can't be fetched → review, never dropped (it may be a block).

What it **can't** catch, seen in the pilot:

- **Mapping errors**: the quote is real but the field reading is off. Evergreen's "we will work
  case-by-case to determine if we can provide a positive experience" became
  `special_needs: available = true`, and the card showed a "Special-needs support" tag.
- **Provider-wide facts copied to every card**: UNCA's "registration expected to open in
  mid-December 2026" is the same milestone on all 12 cards.
- **Tentative dates stored as firm**: that UNCA milestone is `precision: month`, date
  2026-12-01, with nothing saying "expected". The pages detect "expect/tentative" in the quote as a
  stopgap and show "expected, not confirmed".
- **Quotes that split date and time**: Camp Greenville's page has "PHASE 2 - October 13, 2026" as
  a heading and "All others may register starting at 7:00 PM." below it. One quote can't hold
  both, so 10 of 11 Greenville milestones went to review even though all were right.

Flag counts (bundle mode, after fixes): `year_not_on_page` 31, `value_not_in_quote` 13,
`weekday_mismatch` 1 (a false positive: "optional overnight – Thursday evening"),
`third_party_source` 2, `weekday_supports_year` 23 (informational), `needs_hand_check` 24.

**Hand checks** (in a real browser, about 2 minutes each):

- Camp Greenville's 2027 registration: Phase 1 Oct 6, 2026 for returning families at 6 / 7 / 8 PM
  by division; Phase 2 Oct 13 at 6 PM (2026 waitlist families) and 7 PM (everyone else). All
  extracted correctly.
- Reynolds Baptist VBS: the church's public Facebook event says Jun 24–26 (2026), Wed–Fri
  5:30–7:30 PM, meal provided. This matches the facts extracted from the allevents copy, so they can
  be relabeled "from the church's Facebook page". No 2027 post yet.

## 5. Results per camp (bundle mode)

"Reg. dates" are registration milestones kept after verification; "2027 facts" are facts labeled
summer 2027. Time and tokens are the single model call. The last column is the search-only run.

| Provider                    |   Cards |   Facts | Verified | Review | Dropped | Reg. dates | 2027 facts |       Time | Tokens in/out  | Search-only: facts / dropped |
| --------------------------- | ------: | ------: | -------: | -----: | ------: | ---------: | ---------: | ---------: | -------------- | ---------------------------- |
| asheville-art-museum        |       4 |      27 |       27 |      0 |       0 |          0 |          0 |        70s | 20.4k / 4.2k   | 22 / 0                       |
| asheville-museum-of-science |       3 |      27 |       15 |     12 |       0 |          0 |          0 |        80s | 24.6k / 4.4k   | 18 / 0                       |
| asheville-parks-rec (model) |      17 |     170 |      162 |      8 |       0 |          0 |          0 |       259s | 25.8k / 17.4k  | 18 / 0                       |
| asheville-school            |       0 |       0 |        0 |      0 |       0 |          0 |          0 |        21s | 30.4k / 0.5k   | 0 / 0                        |
| black-mountain-summer-camp  |       1 |       6 |        6 |      0 |       0 |          0 |          0 |        31s | 15.9k / 1.4k   | 6 / 0                        |
| camp-greenville             |       6 |      27 |       17 |     10 |       0 |         11 |         27 |        88s | 30.5k / 4.8k   | 35 / 0                       |
| camp-rockmont               |       6 |      33 |       33 |      0 |       0 |          0 |         33 |        85s | 19.5k / 4.9k   | 17 / 0                       |
| evergreen-summer-adventures |       1 |      12 |       12 |      0 |       0 |          0 |          0 |        34s | 15.7k / 1.8k   | 12 / 0                       |
| hahns-gymnastics            |       1 |       4 |        2 |      2 |       0 |          0 |          0 |        44s | 30.0k / 1.7k   | 4 / 0                        |
| kanuga-day-camp             |       1 |       7 |        6 |      1 |       0 |          0 |          0 |        43s | 22.1k / 1.7k   | 7 / 0                        |
| leaf-global-arts            |       1 |      11 |       10 |      1 |       0 |          0 |          3 |        38s | 18.0k / 1.8k   | 11 / 0                       |
| lutheridge                  |      23 |      49 |       29 |     20 |       0 |          0 |         49 |       142s | 33.4k / 8.9k   | 68 / 66                      |
| mason-plumlee-basketball    |       1 |      14 |       14 |      0 |       0 |          1 |         14 |        36s | 20.7k / 1.9k   | 14 / 0                       |
| nc-arboretum                |      22 |      23 |       22 |      1 |       0 |          0 |          0 |       151s | 34.2k / 8.9k   | 3 / 0                        |
| ninjaville                  |       1 |       7 |        7 |      0 |       0 |          0 |          0 |        30s | 13.9k / 1.3k   | 0 / 0                        |
| paca                        |      11 |      33 |       33 |      0 |       0 |          0 |          0 |       118s | 23.7k / 5.8k   | 11 / 0                       |
| reynolds-baptist-vbs        |       1 |       2 |        0 |      2 |       0 |          0 |          0 |        25s | 24.6k / 0.8k   | 3 / 2                        |
| trinity-episcopal-vbs       |       1 |       8 |        8 |      0 |       0 |          0 |          0 |        26s | 15.3k / 1.3k   | 8 / 0                        |
| unca-precollege             |      12 |      96 |       96 |      0 |       0 |         12 |         12 |       183s | 28.3k / 11.9k  | 74 / 0                       |
| ymca-wnc                    |      16 |      93 |       93 |      0 |       0 |          0 |          0 |       192s | 31.8k / 12.3k  | 73 / 0                       |
| **Total**                   | **129** | **649** |  **602** | **47** |   **0** |     **24** |    **138** | **1,696s** | **479k / 98k** | **404 / 68**                 |

The import (`import.json`) has 131 camps: 112 model cards for 18 providers plus 19 WebTrac cards
for Parks & Rec (the model's 17 Parks & Rec cards are kept only for the cross-check below).

Per camp, what happened and why:

- **Asheville Art Museum**: 4 cards by rising grade band, $175/week, hours, last year's opening
  (Feb 9, 2026), all verified. No 2027 yet. The search-only run first came back empty because the
  prompt said "open each page to confirm" and Sol's page opener returns nothing for this site;
  fixed by telling it our crawler does the confirming.
- **Museum of Science**: details come from the 2026 camp-guide PDF, which search found and our
  reader parsed. 12 facts in review because the PDF never prints "2026" (only its file name does).
  Flags a real source conflict: single-day registration opens Apr 13 on the event page, May 18 in
  the PDF.
- **Parks & Rec**: see §7. 2027 schedules "will be published February 1, 2027" per the city page,
  a publication date the schema has no place for.
- **Asheville School**: correctly **0 cards**. The seed row was a summer-reading page; the only camps
  found were 2019 news stories. The blocked-site path worked (403 → Chrome TLS on every page).
- **Black Mountain**: one card with rising 1st–6th and resident / non-resident prices. The summer
  camp brochure PDF couldn't be read, and RecDesk's program list was empty.
- **Camp Greenville**: 2027 dates, rates ($1,525 Base Camp, $1,675 Adventure) and the phased
  registration, all correct by hand check. Its availability chart is an image and wasn't read.
  The $200 non-refundable deposit per camper per session was extracted as a required fee. Its site
  geocoded only from the venue name (no address on the pages): 73.9 min, inside the
  75-minute overnight radius and flagged as near the cutoff.
- **Rockmont**: 2027 dates and rates, verified ("Registration is Open!" on the 2027 page).
  Sol saw "general registration opens August 27 at 11:00 am" for 2027 in search-index text of
  the CIT page and **left it out** because the prompt forbids search snippets for registration dates.
  Since our verifier checks the page anyway, the prompt should allow official-page text from the
  index and let verification decide.
- **Reynolds VBS**: our fetcher can't read Facebook (login wall to a plain fetch), so the bundle had
  nothing; Sol fell back to the allevents copy (third party → review). Hand-checked against the
  public Facebook event: correct.
- **Evergreen**: all 12 facts verified, the tiers and the fee on one card as intended. One mapping
  overclaim (special needs, §4). Flagged a real conflict on the site (rising K–8 vs K–9).
- **Hahn's (iClassPro)**: thin. The summer page has policies but not dates; the iClassPro catalog
  isn't public until registration opens.
- **Kanuga**: no seed URL; search found the right pages, but Sol's page opener got empty text, so
  quotes come from index text, and they verified (6 of 7).
- **LEAF**: 2027 dates and starting tuition already posted ("more info coming soon"), mixed with
  2026 fallbacks, labeled per field as intended.
- **Lutheridge**: moved to novusway.org with renamed 2027 programs; 23 cards, one per program (these
  are real separate programs with different grades). Its program pages print dates without a year;
  the weekday check confirmed 2027 where a weekday was printed.
- **Mason Plumlee (Ryzer)**: everything from the registration platform, including early-bird price
  deadlines (by Mar 1 / after Mar 1), kept as price tiers. Correctly preferred the camp's own June
  21–24, 2027 over a school news article's June 21–27.
- **NC Arboretum**: **over-split**, 22 cards (one per themed week). The page says "2027 dates coming
  soon", and eligibility wasn't on the fetched text, so the cards are theme names with 2026 dates.
  Should be one Discovery Camp card (or one per age track) with themes as sessions.
- **Ninjaville**: prices ($380 full / $280 half per week, day rates), hours and lunch, 2026 fallback;
  season dates left null because "the week of June 10th" has no year. Right call.
- **PACA**: Jackrabbit listing read; 11 cards by show and age band, mostly ages only, with prices
  where they could be tied to a camp.
- **Trinity Episcopal VBS**: dates (June 22–25, 2026), eligibility (age 3, potty trained, through
  completed 5th), $45 / $25 tiers. Verified.
- **UNCA Pre-College**: 12 programs with 2026 dates and prices, all verified; 2027 "tentative" weeks
  and "registration expected mid-December 2026" (see §4).
- **YMCA of WNC**: 16 cards (Adventure × 3 sites × 2 age bands, Discovery × 7 school sites, CILT ×
  2, Explorer). Correct under D5, but the YMCA's Daxko "Activity Finder" isn't readable, so
  **no prices or registration dates**. The plan's "Discovery" is really one program at 7 sites, so
  grouping by provider on the page matters.

## 6. Cost and time per card

Bundle mode, 20 providers, one model call each:

|               |   Total | Per provider | Per model card (129) |
| ------------- | ------: | -----------: | -------------------: |
| Input tokens  | 478,741 |        23.9k |                 3.7k |
| Output tokens |  97,742 |         4.9k |                0.76k |
| Web searches  |      47 |          2.4 |                 0.36 |
| Model time    | 1,696 s |         85 s |                 13 s |

With 4 calls in parallel the 20 providers took about 8 minutes of wall time. Building the bundle
(our own fetches) adds 5–20 s per provider; verification afterwards is 1–2 s per provider from
the page cache (WebTrac: 4.5 min, Cloudflare forces the browser).

**Money:** I don't have Azure's price for `gpt-6.1-sol`. At GPT-5-class list prices ($1.25 / M
input, $10 / M output, $10 per 1,000 web searches) the pilot cost about **$2.05**: $0.10 per
provider, $0.016 per card. Several hundred providers, with a re-run, is on the order of $50–100
even at a few times those prices. Check the Batch-AI resource's cost view for the real number.

## 7. WebTrac (Asheville Parks & Rec)

`read-webtrac` reads the full catalog (1,186 activities; 30 searches + detail pages) and keeps
every summer row whatever its status (the scraper drops full / closed rows and looks only 120 days
ahead). 331 summer rows → **19 cards**, one per program × site × age band, with the 10 weekly
sessions and each week's status.

- **A title filter isn't enough.** "camp" in the title missed the Grant and Montford youth camps
  ("Grant Summer Week 1"), Venture Bound, Nature Nuts and Future Innovators. The rule now also takes
  camp-shaped youth programs (summer, youth / teen / therapeutic category, a 3–7 day run of 3+
  hour days), minus afterschool.
- **Cross-check against Sol's reading of the city page: 88 of 100 comparable facts agree.** Real
  differences: Tabletop Gaming ages 10–13 on the city page vs 10–14.99 in the catalog; Sol merged
  the two Therapeutic camps (6–12 and 13–21) into one 6–18 card. The rest were my matching
  heuristic. The catalog should win for its own rows.
- 2026 availability (Full / Unavailable) is stored as 2026 and never shown as 2027 status.

## 8. Changes needed before scale-up (Nov 5)

Schema / extraction contract:

1. **Registration milestones**: `date_quote` and `time_quote` as separate evidence (Camp
   Greenville); `certainty: announced | expected` (UNCA); `applies_to: provider | card` plus a
   `scope_text` ("D3 campers", "returning families") so a provider-wide date is one row, not 12.
2. **Season publication**: a per-provider/per-card fact `{year, status: posted | coming_soon |
not_posted, publish_date?, quote}` ("2027 dates coming soon", "published February 1, 2027").
3. **Support facts**: `financial_aid`, `special_needs`, `lunch`, `transportation` as
   `yes | case_by_case | no` with the official wording; show the wording, not a badge.
4. **Season dates**: separate start and end evidence, or derive the season from sessions when
   sessions are listed (most `value_not_in_quote` flags were season spans quoted from one week).
5. **Camp identity**: `camp_key` is built from the model's name + variant today, which can change
   between runs. Scale-up needs a matching step against existing camps (platform IDs, URL, aliases,
   then a reviewed merge) before insert, and the key must come from that match.

Prompt:

6. Themed weeks of one program with the same eligibility stay on **one** card with the themes as
   sessions (NC Arboretum: 22 → 1–4).
7. Allow registration dates from official pages seen only through the search index; verification
   decides (Rockmont's Aug 27, 11 a.m.).
8. Keep bundle mode. Improve its link picking: skip login / cart / privacy / terms / alert / contact
   pages; prefer PDFs and pages with dates, rates or registration in the URL or anchor text; follow
   one more hop to PDFs.

Pipeline:

9. **Geocoding**: Google geocoding for addresses (one-time, a few hundred calls), ORS for the
   matrix. Or hand-pin the ~70% that come back town-level. Town-level drive times are hidden on the
   pages until then.
10. **Facebook (VBS)**: public event pages render in a real browser; try the headless rung on
    `facebook.com/events/*` before falling back to a hand check.
11. **Verifier false positives**: `year_not_on_page` for PDFs whose year is only in the file name
    or an image, and for FAQ/policy pages; the weekday check on "Thursday evening".
12. Store `text_hash` per fetched page in `camp_observations` (the reader computes it; the pilot
    import doesn't keep it yet), so the weekly refresh can skip unchanged pages.

## 9. Decisions for Matt

1. **Apply `drizzle/0025_camps.sql` to the live database?** Not done; it's additive and idempotent.
   I'd wait until the §8 schema changes (milestones, season publication, support facts) are in, so
   it's applied once.
2. **Geocoding provider**: Google geocoding (needs a billing account; its terms limit storing
   results) or hand pins for town-level matches?
3. **Card granularity**: YMCA's 16 cards and Lutheridge's 23 follow D5. OK with the page grouping
   them under the provider (as the pilot page does), or collapse site variants into one card with
   a site list?

## 10. Blocked sites

None blocked outright. From the 95-URL probe and the pilot's own fetches:

- **Asheville School**: 403 to plain fetch; Chrome TLS fingerprint gets through.
- **WebTrac (Parks & Rec)**: Cloudflare challenges the HTTP path; headless browser works (~4.5 min).
- **PACA (ex-Asheville Junior Theater)**, **Ruby Ranch**, **The Asheville Kitchen**: 404 to plain
  fetch, real pages in the browser.
- **WNC Dance Academy**: broken TLS certificate chain for Node; only the browser reads it.
- **Buncombe County Schools ag camp**: JavaScript-rendered (thin to plain fetch); browser.
- **Facebook**: login wall to plain fetch; public events readable in a real browser (N9 hand check).
- **Account-only catalogs** (not blocks, but no data): YMCA Daxko Activity Finder, iClassPro
  before registration, CampMinder/CampInTouch and CampDoc logins.

## 11. Codex review

(Triage of the Codex review of this pilot goes here.)
