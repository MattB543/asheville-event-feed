# Codex review of the camps plan (2026-10-28)

Codex (`gpt-6.1-sol`, xhigh, live web search, read-only) reviewed `01-context-and-plan.md` as it stood around 15:05 ET, before sections 2.6a/2.6b (fetcher test and extraction bake-off) were added, so its fetcher advice predates those results. Its code-level claims were spot-checked and hold (see `01-context-and-plan.md` section 12). Verbatim below.

---

**1. Verdict**

The plan is sound enough to start building after tightening the data contract and reducing the work required before launch. Its strongest choices are official-source evidence, clearly labeled historical data, a separate directory, and postponing the session planner. The biggest risk is displaying a registration date, availability status or eligibility match that is technically sourced but applies to the wrong year, audience or program. The second is letting discovery, blocked-site handling and archival research consume the five weeks before December 1. The third is feed integration: existing scoring, deduplication and geographic cleanup do not provide the behavior the plan assumes. December’s product should be presented as a directory and registration tracker; Robert’s week-by-week planning problem remains phase 2.

**2. Simplifications**

These are rough working-day savings, including implementation and review. They overlap and should not be added together.

| What to simplify                                                                                                                                                           | Why                                                                                                                                                          | What is lost                                                                                                     | Rough time saved                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Defer the subscribable calendar.** Keep individual ICS downloads and on-device saved camps.                                                                              | D7 explicitly makes subscriptions conditional. Token management, updates, calendar caching and client compatibility introduce another substantial subsystem. | Dates added or changed later will not automatically update downloaded reminders. State that beside the download. | **2–4 days**                                               |
| **Bound discovery instead of exhausting every approved method.** Start with seeds, local guides, municipal catalogs and targeted gaps; limit seed-similar searches.        | Approximately 300 grid searches plus per-seed searches can produce many repeated candidates and a large review queue.                                        | Some obscure providers arrive after launch.                                                                      | **2–4 days**                                               |
| **Remove completeness estimates from launch criteria.** Publish coverage by town/type and known missing fields instead.                                                    | Capture-recapture assumptions are not satisfied here; “several hundred” is an estimate, not a deliverable.                                                   | No percentage-complete claim.                                                                                    | **½–1 day**, plus less pressure to chase marginal listings |
| **Limit historical registration research.** Extract dates already visible on official pages; try Wayback for a small priority set.                                         | The plan’s own archival probe found sparse coverage. This should not block current information.                                                              | Fewer “opened last year” lines at launch.                                                                        | **1–2 days**                                               |
| **Build a fetch ladder, not universal browser automation or ten vendor integrations.** Start with ordinary HTML, a working Jina option, PDFs and bounded browser fallback. | A platform name does not imply a usable public API. Inventory actual local usage before writing adapters.                                                    | Some blocked or account-only information remains unknown.                                                        | **2–5 days**                                               |
| **Launch without images, related-camp recommendations or the optional logo badge.** Keep the tent banner and navigation decisions.                                         | These add little to eligibility, price comparison or registration reminders.                                                                                 | Less visual polish and incidental discovery.                                                                     | **½–1½ days**                                              |
| **Show one popularity window: trailing seven Eastern calendar days.**                                                                                                      | All-time counts favor older listings and add little to opening-date decisions. Daily buckets cannot provide an exact rolling 24-hour count.                  | No all-time or hourly interest history in the UI.                                                                | **¼–½ day**                                                |

Keep D6 intact. Adding a planner, session booking grid or comparison tool before December would substantially increase the risk of missing launch.

**3. Improvements**

The most useful patterns in ACA, ActivityHero and Sawyer are eligibility, schedule, location, price and logistics. Asheville City Schools’ **Beyond School** directory is particularly relevant: it already emphasizes grades, sliding-scale cost, scholarships, transportation and extended care. Reviews, featured placements and elaborate category browsing are less useful models for AVLGO’s distinctive registration-tracking job.

| Priority | Change                                                                                                                                                                              | Why it matters                                                                                                                                                                       | Rough effort                              | Timing                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------ |
| 1        | **Separate season publication, registration milestones and availability.**                                                                                                          | “2027 dates posted,” “registration opens January 10,” and “some sessions have space” are different facts. One status enum cannot reliably represent them.                            | **1–2 days**                              | **v1**                               |
| 2        | **Represent date precision and registration audience.** Store public/member/returning-family/lottery milestones separately.                                                         | A correctly quoted members-only opening can still cause a parent to miss public registration. A date without a time must not become a timed alarm.                                   | **½–1½ days**                             | **v1**                               |
| 3        | **Make saved eligibility explicitly seasonal:** “Age during summer 2027” or “Rising grade.” Preserve additional restrictions.                                                       | Grade-to-age approximations produce false matches. LEAF, for example, states both rising-first-grade eligibility and a minimum age.                                                  | **1–2 days**                              | **v1**                               |
| 4        | **Make workday coverage and price comparisons honest.** Add early dropoff, weekdays, extended-care cost and required fees.                                                          | Evergreen publishes $325/week for 8:30–4:30, $375/week for 7:30–5:30, plus a $40 family registration fee. A base-price card with an aftercare tag hides the relevant comparison.     | **½–1½ days**                             | **v1**                               |
| 5        | **Add a simple saved-camps filter.**                                                                                                                                                | A shortlist directly helps parents return to opening dates and discuss options, even before subscriptions or comparison tools exist.                                                 | **½–1 day**                               | **v1**                               |
| 6        | **Make partial data visible and actionable.** Show “2027 not confirmed; 2026 details below,” field-specific year labels, and registration freshness.                                | A page titled “2027” containing historical prices and hours otherwise implies more current knowledge than AVLGO has.                                                                 | **½–1 day**                               | **v1**                               |
| 7        | **Start with a 15–25-provider pilot and usable vertical slice.** Include WebTrac, a PDF, an overnight camp, VBS, grade-only eligibility, multiple pricing tiers and a blocked site. | This exposes extraction and schema failures while there is still time to change them.                                                                                                | **2–3 days**, mostly replacing later work | **Immediately**                      |
| 8        | **Preserve structured session facts when cheaply available, without building session UI.**                                                                                          | A small JSON collection of source session IDs, dates and applicable variants prevents loss of information and makes phase 2 easier. It also supports safer availability aggregation. | **½–1 day**                               | **v1 where available**               |
| 9        | **Show concrete aid and support notes with official links.**                                                                                                                        | “Special-needs support” is too broad to establish suitability. Scholarship application requirements and specific accommodations matter more than an unexplained badge.               | **½–1 day**                               | **v1 details; richer filters later** |

For registration sorting, put **upcoming actionable openings first**, then currently open registration, then incomplete announcements. Historical opening dates and past scheduled openings should not dominate the default sort.

**4. Corrections**

1. **Challenge to D5 — split on different offerings, not every price tier.**  
   Literally splitting whenever price differs creates separate cards for resident/nonresident, member/nonmember, early-bird and extended-care prices for the same offering. Keep separate cards for meaningful program, eligibility and site differences; represent pricing tiers within a card. Also, D5’s separate-location rule conflicts with `other_locations` in §5. Decide whether those are actual alternative attendance sites or merely excursion locations.

2. **Challenge to D10 — low scores are not a reliable Top 30 exclusion.**  
   [The Top 30 query](lib/db/queries/events.ts:791) requires a non-null score but has no minimum, and ranks three different dimensions. A read-only database check found real 2026 camps scoring **18** for UNCA’s guitar camp and **16** for Costumes & Cosplay and Torched. That does not establish actual Top 30 placement, but it disproves dependable low scoring. Explicitly exclude identified camps from all Top 30 categories while retaining D10’s feed presence. December scoring cannot validate June placement because the query looks only 30 days ahead.

3. **Eligible cross-state camp events would be deleted.**  
   §4.8 conflicts with D3: [cleanup checks every event for non-NC locations](app/api/cron/cleanup/route.ts:319) and hard-deletes matches. It does not select source or camp membership for an exemption. Protect verified, radius-qualified camp events.

4. **Preseeding tags prevents the proposed “usual tagger pass.”**  
   §4.8 proposes Summer Camp + Family, then AI tagging. [The AI cron only writes tags when existing tags are empty](app/api/cron/ai/route.ts:216). Seed complete tags or explicitly implement camp enrichment.

5. **Existing deduplication can merge distinct camp variants.**  
   [Known-venue matching allows one shared title word on the same day](lib/utils/deduplication.ts:728). Winner selection favors price, description length and recency; its merged fields do not preserve camp associations or tags. §4.8 needs explicit camp identity and variant protection, not just another fuzzy title rule.

6. **The Parks & Rec scraper is reusable below its event projection.**  
   [Its parser](lib/scrapers/ashevilleparksrec.ts:459) already captures FMID, dates, hours, ages, fees and registration-open tooltips. But the scraper has a **120-day horizon**, drops full/closed/waitlist rows, and projects the next upcoming occurrence. Reuse the catalog parser with camp-specific inclusion rules; do not reuse the exported scraper unchanged.

7. **The calendar generator is not a drop-in implementation.**  
   [The existing generator](lib/utils/icsGenerator.ts:65) uses random UIDs, defaults to two hours, truncates descriptions to 500 characters, and lacks the required alarms and date-only mode. The Top 30 generator contains useful stable-UID/alarm examples. Also, §4.4 needs distinct UIDs for registration opening versus season start, and for different registration audiences.

8. **The proposed schema does not implement Q9’s per-year retention.**  
   §5 stores a single set of facts and one `last_year_reg_opened` value. Ages, hours, support and location can change annually too. A stable camp row plus a `camp_seasons` row per year solves this without introducing the session planner. The bare detail URL also cannot uniquely identify separate annual feed events while `events.url` remains unique; specify annual event identity before rollover.

9. **The Group Directory seed’s deletion behavior should not be copied.**  
   [It deletes rows absent from the input file](scripts/groups/seed-groups.ts:113). Camps need history and protection against incomplete discovery runs. §5 also creates two competing authorities: committed JSON and direct database refreshes. A stale reseed must not overwrite newer evidence.

10. **The Azure helper must use the endpoint that was actually tested.**  
    [The current Azure client](lib/ai/provider-clients.ts:232) uses the versioned `AzureOpenAI` configuration; the SDK builds an `/openai` base rather than automatically selecting `/openai/v1`. Add an explicit v1 Responses helper. In §6.3, Responses reasoning syntax should follow the successful probe: `reasoning: { effort: "low" }`, rather than the Chat Completions-style `reasoning_effort`.

11. **Discovery estimates and rejection rules are too strong.**  
    §6.1’s grid and seed-similar searches share search indexes and visibility biases; they are not independent capture samples. Provider/card/session units also differ. A URL that fails to fetch may be blocked, not hallucinated. Keep blocked candidates in a review queue rather than dropping them solely for fetch failure.

12. **Validation boundaries are not universal camp rules.**  
    §6.3’s ages 2–19 and October–June registration window should be review flags, not assumed validity limits. July VBS registration or earlier overnight registration can be legitimate. Camp Carolina already explicitly advertises registration for summer 2027.

13. **“Unknown” must not mean free or unavailable.**  
    [The existing event free-price helper](lib/utils/eventFilterMatch.ts:46) intentionally treats missing/Unknown/TBD prices as free. Do not reuse that policy for camps. Unstated aid, aftercare or support should likewise remain unknown.

14. **Refresh observations cannot establish exact sell-out durations.**  
    §§2.7, 5, 6.5 and 9 overstate what daily observations establish. They identify an interval between last observed availability and first observed full status. A card may also contain both full and available sessions. Store that scope and uncertainty now.

15. **Geocoding/routing wording needs updating.**  
    §6.2’s Google Distance Matrix is a legacy API; use Routes **Compute Route Matrix** for new work. Google can fit this volume within free allowances, although billing and storage terms still matter. Nominatim’s one-request-per-second limit is not its complete batch policy; recurring scripts have stricter limits. OpenRouteService’s official announcement now schedules the old API host’s shutdown for **November 2–6, 2026**.

16. **Seasonal and scheduling reuse needs additional work.**  
    [Season end formatting](lib/seasons.ts:34) also assumes the current calendar year; wrap-around matching alone is insufficient. `EventsMenu` is specialized rather than a ready-made generic dropdown. [The local scheduler](scripts/scheduled-local.ps1:23) supports only news/events and runs only while Matt is logged in. Cron health will list recorded camp runs, but needs explicit cadence and data-freshness checks to detect a camp job that never ran or did no useful work.

**5. Pipeline recommendations**

**Discovery**

- **Search for providers first, then enumerate offerings.** Deduplicate the 96 seeds before issuing searches. Query each provider’s camp/program/registration pages once instead of searching separately for every eventual card.
- Add **Asheville City Schools Beyond School** and **828newsNOW’s WNC camp guide** immediately. The latter includes faith-based and overnight categories; use it for discovery, not authoritative registration facts.
- Prioritize municipal catalogs, county **4-H/Extension**, schools, universities, museums, arts organizations and youth sports providers before national aggregators.
- For VBS, use church-association/member directories to generate church seeds, then inspect their children’s ministry, events and public official posts. Search both `vacation bible school` and `VBS`, with **2026, 2027 and no year**. A church’s existence does not establish that it runs VBS.
- Use category/town searches to fill measured gaps. Include “summer program,” “summer childcare,” “clinic” and “youth enrichment,” not only “camp.”
- Do not give the model the entire growing exclusion list on every call. Deduplicate returned identities and URLs in code.
- Replace “a round adds <5%” with a bounded rule: **complete the priority source inventory, run two comparable gap-filling rounds with low yield of verified new providers, then stop at the agreed date/budget**. Report blocked sources separately.

**Registration platforms**

The useful opportunity is **public catalog harvesting**, not a universal vendor API. I did not establish what percentage of Asheville-area providers each platform serves.

| Platform                      | Public-data finding                                                                                                                  | Recommendation                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **WebTrac / Vermont Systems** | Structured HTML is already parsed locally, including official registration tooltips and fees.                                        | **First v1 adapter.** Retain unavailable offerings and query summer 2027 beyond the event horizon.                           |
| **UltraCamp**                 | Public upcoming-session/detail pages can expose dates, grades/ages and prices without an account. Its management API requires a key. | Harvest public HTML where present. Preserve `idCamp` and `idSession`; do not infer availability solely from a Register link. |
| **Jackrabbit**                | Official class-listing embeds expose public catalog tables through organization-specific listing URLs.                               | Follow the embedded listing rather than scraping an empty container. A stable anonymous JSON contract was not verified.      |
| **Sawyer**                    | Its documented Live View is a public read-only schedule; customer links identify individual activities.                              | Fetch the actual widget/customer page. No stable public API was established.                                                 |
| **ACTIVENet**                 | System APIs require organization-specific licensing and credentials. A separate ACTIVE.com public Activity Search API exists.        | Scrape public catalogs; optionally test the search API’s local coverage before investing. Do not equate the two APIs.        |
| **Amilia**                    | API documentation contains rich activity/schedule/price fields, but v2 is deprecated and current access is authenticated/scoped.     | Do not treat `PublicApi` in a URL as proof of anonymous access. Use public storefront data unless access is established.     |
| **Campminder / CampInTouch**  | Documented APIs require admin-generated API and subscription keys.                                                                   | Prefer official dates/rates pages and linked public registration information.                                                |
| **CampBrain**                 | No documented anonymous session inventory was established.                                                                           | Treat individual public portals as site-specific sources; account walls remain unknowns.                                     |
| **CampDoc**                   | Integration APIs exist; registration supports audience-specific early-access codes.                                                  | Preserve public versus priority registration distinctions. No anonymous cross-camp inventory was verified.                   |
| **Regpack**                   | Markets APIs and webhooks for integrations; that does not establish a public catalog.                                                | Inspect public provider forms/catalogs; defer a generic adapter.                                                             |
| **Squarespace / Wix**         | Website hosting or a generic form does not imply a session database. Wix Bookings has structured APIs when actually installed.       | Follow the real embedded system. Evergreen illustrates Wix + Jotform + MySchoolBucks; LEAF links to Qgiv.                    |

Build another adapter only when the pilot demonstrates enough repeated local usage or enough catalog rows to justify it.

**Identity and schema**

Use a stable identity independent of current price, year, slug or URL:

- `camps`: stable provider/program/variant identity, slug, aliases and moderation.
- `camp_seasons`: `(camp_id, season_year)`, annual facts and their evidence.
- Registration milestones: audience, milestone kind, date, optional time, timezone, precision and evidence.
- Availability: `unknown`, `available`, `mixed`, `waitlist`, `full`, `closed`, with applicable session/variant scope.
- Hours: normal hours, early dropoff, late pickup, weekdays and extension fees.
- Prices: amount, unit, duration, eligibility tier, required fees and notes.
- Evidence: URL, exact quote, season year, program/site/audience scope, successful fetch time and source reference.
- Source bookkeeping: platform/tenant/external IDs, relevant URLs, hashes, fetch failures and successful verification times.

Keep platform identity parameters such as **FMID, OrgID, idCamp and idSession** when normalizing URLs. Registration-host domain alone must never be a merge key.

**Extraction and validation**

1. Fetch a bounded source bundle: official camp page, rates, registration, schedule/FAQ and relevant PDFs. Follow links to the real catalog.
2. Prefer deterministic catalog parsing for dates, fees, IDs and explicit statuses. Use Sol to interpret and normalize prose.
3. Use web search to locate missing official evidence. Search snippets and third-party guides must not set opening dates.
4. Require evidence to establish **the correct season and applicable offering**, not merely contain a matching date string.
5. Preserve unstated and conflicting facts. Never infer an opening date from last year, a recurring annual rule, copyright year or the first successful observation of registration.
6. Keep season year distinct from date year: **2027 camp registration may open in 2026**.
7. Do not convert rising grades into definitive ages. Apply explicitly stated age and grade requirements together.
8. Run deterministic checks for date/time parsing, contradictory weekday/date combinations, price units, min/max order and source applicability. Queue consequential conflicts.
9. Review every advertised opening milestone before launch. Spot-check other fields across the diverse pilot and subsequent batches.

For ICS: explicit time → timezone-correct timed event with D7’s alarms; date only → all-day reminder saying **“opening time not stated,”** without an invented 15-minute-before alarm. Label lottery/application deadlines as such.

**Routing**

Use one fixed Pack Square origin and a **1×N driving matrix**, caching unique attendance-site addresses. There is no need for an N×N matrix, map UI or self-hosted routing stack.

My default is HeiGIT/OpenRouteService geocoding plus routing, using the current hosts:

- `api.heigit.org/pelias/v1`
- `api.heigit.org/openrouteservice/v2/matrix`

Confirm current dashboard quotas and attribution/storage terms during the pilot; official guidance says results use CC-BY-SA. Nominatim is a reasonable alternative for a small, compliant one-time geocoding batch. Google is financially feasible at this scale, but its shared-directory caching restrictions make permanent committed coordinates less straightforward.

Route to the actual dropoff entrance. Keep unrounded duration for D3’s cutoff, display approximate minutes, and review uncertain geocodes and sites within roughly five minutes of the boundary.

**Feed integration**

Create one canonical event per card/season at the first confirmed session start, using `timeUnknown` when necessary. Map scraped camp events to that identity; suppress duplicate daily listings without merging unrelated programs or destroying useful existing associations.

Apply camp membership consistently to default-feed exclusion, counts and all Top 30 categories. Source `CAMPS` alone misses camps scraped through other sources. Let the camp refresh pipeline verify official sources; adding internal AVLGO detail URLs to generic verification would not independently verify their facts.

**Refresh and publication**

- Make the **database authoritative after initial import**. Treat JSON as reviewed imports/snapshots; older imports cannot supersede newer evidence, and omission does not delete a camp.
- Refresh every relevant evidence URL and catalog/PDF, not just the landing page. Hash normalized substantive content.
- A failed fetch preserves facts, records failure, and does **not** advance successful verification freshness.
- Keep weekly baseline checks; use daily checks around openings and immediately afterward. Preserve the distinction between a scheduled opening and verified current registration.
- Continue refresh **through summer**, not only April. Repeat discovery in spring, particularly for VBS.
- Record last observed available and first observed full, with scope and evidence.
- Add camp-cache invalidation, stale-source/backlog monitoring and expected job cadence.
- Measure cost per accepted provider/card during the pilot. §6.7’s token estimate omits fetched content, retries and extra searches.

Reorder §8: **pilot and working pages by November 4; broader data, filters and refresh by November 18; release candidate by November 25**. Keep Thanksgiving week primarily for verification.

**6. Open questions**

| §10 question                         | Recommended answer                                                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1: popularity windows**           | One count for the trailing seven Eastern calendar days, labeled “views in the last 7 days.” Explain that it counts daily interest, not unique weekly parents or predicted sellouts. Keep D8’s no-minimum decision.            |
| **Q2: camps in All events / winner** | Hide identified camps by default; show them when the camp tag is selected. Prefer the canonical camp event after verified mapping, and suppress mapped daily duplicates. Exclude all identified camps from Top 30 explicitly. |
| **Q3: banner window**                | From launch through March 31 for this season; annually November 1–March 31 thereafter. Keep `/camps` permanently accessible through More.                                                                                     |
| **Q4: reminder without a date**      | No opening reminder. Show the evidenced historical date and disabled reminder explanation. Defer optional “check this camp” tasks.                                                                                            |
| **Q5: fetcher**                      | Test a valid Jina key immediately; use direct HTML/catalog fetching first and bounded browser/PDF fallbacks. Do not make a temporary Vercel extraction endpoint the default architecture.                                     |
| **Q6: geocoding/routing**            | HeiGIT/OpenRouteService geocoding + single-origin matrix, with persisted attribution and current terms checked. Keep Google as an alternative if local geocoding quality proves inadequate.                                   |
| **Q7: camp boundary**                | Include finite, supervised youth summer programs, summer-only childcare, VBS and short clinics. Exclude ordinary year-round childcare/classes, leagues, employment recruitment and adult/family-only retreats from v1.        |
| **Q8: cards per provider**           | No arbitrary cap. Split meaningful offerings and attendance sites; group visually by provider. Resolve pricing-tier treatment through the D5 challenge above.                                                                 |
| **Q9: year handling**                | Retain annual records. Prefer 2027 facts field by field, with explicitly labeled 2026 fallback; never carry 2026 registration availability into 2027.                                                                         |
| **Q10: descriptions**                | Short factual AI paraphrases grounded in official evidence. Avoid promotional claims, quality judgments and invented suitability.                                                                                             |

**New decisions to settle before building**

- **Pricing/card identity:** adopt the D5 refinement for pricing tiers, and define a stable variant across annual changes.
- **Availability language:** use “registration open; session availability varies” for mixed offerings; define when an observation becomes visibly stale.
- **Official social sources:** whether verified provider-owned public Facebook/Instagram posts count as the camp’s own page. I recommend yes when ownership is established; this matters for VBS coverage.
- **Reminder milestones:** public opening as the default, with separately labeled priority/lottery milestones; no invented opening time.
- **Launch acceptance and budget:** verified coverage and trustworthy dates, rather than a camp-count target; set research/fetch limits after the pilot.
- **Data ownership:** database authority after import, preserved overrides/history, and no automatic deletion from incomplete files.
- **Eligibility promise:** label sibling matching as **age/grade eligibility only**. It does not establish matching weeks, available seats or every prerequisite.

**7. Sources**

The review was read-only: the plan and `CLAUDE.md` were read in full, reuse code was inspected, and database checks used read-only SELECTs. No repository files or database records were changed.

- Directory patterns: [ACA Find a Camp](https://find.acacamps.org/index.php?id=25&view=section), [ActivityHero](https://www.activityhero.com/), [CampSearch](https://www.campsearch.com/), [Kidvoyage](https://kidvoyage.com/).
- Parent planning: [Sawyer’s planning guide](https://events.hisawyer.com/blog/how-sawyer-makes-summer-camp-planning-simple-for-parents), [Asheville parent discussion](https://www.reddit.com/r/asheville/comments/1s4rscz/summer_is_coming_need_advice_parenting/). Vendor guidance and a local discussion are directional evidence, not representative user research.
- Local discovery: [Asheville City Schools Beyond School](https://beyondschool.ashevillecityschools.net/), [828newsNOW WNC camp guide](https://828newsnow.com/summer-camp-guide-asheville-western-north-carolina-2026/).
- Official local examples: [Evergreen registration](https://www.evergreensummercamp.org/registration), [LEAF camps](https://www.theleaf.org/camps/), [LEAF registration](https://secure.qgiv.com/for/leafcampregistration/event/leafcamp/), [Camp Carolina 2027 registration](https://www.campcarolina.com/current-families), [Asheville municipal camps](https://www.ashevillenc.gov/service/register-for-asheville-summer-camp/).
- VBS discovery: [Newbridge children’s ministry](https://newbridgebaptist.org/children/), [Trinity Episcopal VBS](https://www.trinityasheville.org/vbs), [NC Baptist VBS resources](https://ncbaptist.org/ministries/children-and-family/vacation-bible-school/).
- UltraCamp: [public session catalog example](https://www.ultracamp.com/info/upcomingsessions.aspx?campcode=IPP&idCamp=1310), [API license](https://ultracampmanagement.com/api-license-terms/).
- Other catalogs/APIs: [Campminder API requirements](https://help.campminder.com/en/articles/6988427-get-to-know-campminder-api), [Jackrabbit listings](https://help.jackrabbitclass.com/help/class-listings-tables), [Sawyer Widget Guide](https://help.hisawyer.com/en/articles/11105559-widget-guide), [ACTIVENet authentication](https://help.aw.active.com/ActiveNet/standard/en_US/api_authentication.htm), [ACTIVE public Activity API](https://developer.active.com/docs/read/Activity_APIs), [Amilia authentication/version documentation](https://app.amilia.com/apidocs/Index.html).
- Additional platforms: [CampBrain software](https://campbrain.com/software/), [CampDoc integrations](https://www.campdoc.com/integrations/), [CampDoc early registration](https://support.docnetwork.org/hc/en-us/articles/32097159967757-Early-Registration), [Regpack API/webhooks](https://www.regpacks.com/features/api-webhooks), [Wix Time Slots V2](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/introduction).
- Geocoding/routing: [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/), [HeiGIT API migration announcement](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912), [ORS matrix documentation](https://github.com/GIScience/openrouteservice/blob/main/docs/api-reference/endpoints/matrix/index.md), [current ORS licensing guidance](https://ask.openrouteservice.org/t/free-plan-in-an-app-with-a-paid-tier-license-cc-by-sa-4-0-personal-data-and-attribution-questions/8079).
- Google: [pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [legacy APIs](https://developers.google.com/maps/legacy), [service-specific storage terms](https://cloud.google.com/maps-platform/terms/maps-service-terms).

**FINAL ANSWER**

- Start building, beginning with a diverse 15–25-provider pilot.
- Separate annual facts, registration milestones and availability.
- Preserve date precision, audience, eligibility rules and official evidence.
- Refine D5 so pricing tiers do not multiply identical cards.
- Explicitly protect camp events from Top 30, bad merges and non-NC deletion.
- Defer subscriptions, broad Wayback research and speculative vendor adapters.
- Launch verified coverage by December 1; continue discovery and refresh through summer.
- Keep the week planner in phase 2, with structured source facts preserved now.
