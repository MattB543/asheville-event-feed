# Summer Camps (`/camps`): context, decisions and v1 plan

Status: **draft plan, 2026-10-28, revised the same day after a Codex review**
(`02-codex-review.md`). Nothing is built. This doc collects everything known so far, every
decision Matt has made, and the proposed v1 design, so a reviewer (human or agent) can
critique it without the original conversation. **§12 records the decisions Matt made after
that review (all settled 2026-10-28).**

Target: **live by about December 1, 2026**, ahead of summer-2027 camp registration.

---

## 1. Where this came from

### 1.1 The request

Robert, an AVLGO user and parent, sent Matt two voice memos and a Slack thread. Robert is in a
group chat with parents from local elementary schools who are already strategizing about
summer-2027 camps. What Robert described:

- **Everything is disconnected.** Parents piece camps together from dozens of separate
  websites. They want one view where they can sort and filter by days, availability, price,
  location, ages and other attributes, and compare camps.
- **It is competitive.** Popular camps sell out fast. Registration opens from November
  through January, and much of it opens in the new year. Parents set alarms for opening
  times.
- **Registration dates and reminders.** Robert's own workaround would be to research camps,
  feed them to Claude, and have it set calendar reminders for each sign-up date. A site that
  does the evaluation and surfaces sign-up dates would replace that.
- **A popularity signal.** "This camp was clicked 25 or 30 times in the last 24 hours" would
  tell a parent which openings deserve an alarm. A horse-riding camp that looks nice but will
  not sell out on day one doesn't need a 7 a.m. alarm; a camp lots of parents are looking at
  does.
- **Timing.** Robert would like it done by December.
- **Help and money.** Robert and others in the chat offered to help, and Robert raised
  possibly monetizing it.

### 1.2 Matt's responses so far

- Matt is in: it fits "make AVLGO the best website for Asheville", and it will be **free**.
- First step: gather links to every relevant camp. Matt ran an exa.ai search (96 rows) into a
  Google Sheet and asked Robert to have parents add missing camps at the bottom.
  **Nothing was added.** The sheet's Crowdsource tab still has only its header row.
- Matt asked which pain point matters most (finding by attributes, comparing, judging
  quality, other). Robert's answer: all of discovery, comparing by price, location, dates
  and attributes, registration dates with reminders, and popularity.

### 1.3 Principles that follow

1. **No reliance on user-entered data.** People are lazy (the empty Crowdsource tab proves
   it). Everything must come from code + AI. A feedback box is a bonus, never a dependency.
2. **Free, no sponsors, no ads**, like everything else on AVLGO.
3. **Trust over coverage for dates.** A wrong registration date is the worst possible error:
   a parent misses it. State a date only when the camp's own page states it, show where it
   came from and when we checked, and label the year of every fact.

---

## 2. Research to date

### 2.1 The exa.ai sheet

Sheet: "Buncombe County Summer Camps"
(`https://docs.google.com/spreadsheets/d/1X2ypxq0w1TJs0ii2pfYHqQ8ZN5PiLNL5EYzITb0OaZY`).
Tab `summer-camps`, columns: Name, Evidence Status, Summer 2026 Dates, Ages / Grades,
Location, Programs, Notes, Confidence, Sources.

- **96 rows.** 74 are "2026 schedule documented" (confidence high); 22 are "Candidate only,
  2026 not verified" (confidence medium, no dates).
- **All data is for Summer 2026,** which is over. Its value is as a seed list of names and
  URLs, which is what Matt wanted.
- **No price column and no registration-open column.** Only 3 rows mention price anywhere;
  5 mention registration at all.
- **One row is a provider; parents choose a session.** Example: the Asheville Museum of
  Science row packs 7 themes × 8 weeks × 3 grade bands into one cell.
- **Mixed kinds:** 7 Vacation Bible Schools (some run 5:30-8 p.m.), about 9 overnight camps
  (Rockmont, Merri-Mac, Ridgecrest, Crestridge, Cedar Cliff, Lakey Gap, Lutheridge, Windy
  Gap, UNCA pre-college residential), sports clinics, a pre-college program.
- **Geography:** Location mentions Asheville 64, Black Mountain 12, Arden 6, Hendersonville
  6, Swannanoa 4, Candler 3, Fairview 3, plus single mentions elsewhere.
- Notes are full of exa boilerplate ("operation not independently confirmed"), useless to
  parents.
- Aggregator sites appear among its sources: `asheville.macaronikid.com` (6),
  `kidvoyage.com` (6), `asheville.com` (4), `allevents.in` (3), `campsearch.com` (2).

### 2.2 Macaroni Kid Asheville camp guide

`https://asheville.macaronikid.com/directory/category/623a084d4aa4f27ce8606e46/summer-camp-guide`
plus its four subcategories (STEAM, adventure/outdoor, arts, sports). The pages are
server-rendered with no pagination: **15 camps total**. 12 are already in the sheet. Missing:
**Asheville Youth Sailing, Bricks 4 Kidz, Summit CrossFit.** It is a small directory of
mostly paid listings, so it is a weak completeness check.

### 2.3 AVLGO's own events table

Summer-2026 events (May 15 - Aug 31) whose titles say camp / VBS: **140 events** (AVL Today
78, Explore Asheville 38, Eventbrite 14, Facebook 4, Meetup 4, others). After removing noise
(Burial Beer's "Forestry Camp" venue, "boot camp", breastfeeding "Boob Camp", Drupal Camp),
about **25 real camp providers**, of which **13 are not in the sheet**:

Torched AVL (art + metalsmithing), Fired Up Creative Lounge, AVL Clay (Kids Maker's Camp),
Trinity United Methodist (Kids Yoga + Art), Groce United Methodist (summer music camp),
SHINE Camp for Teen Girls, Goodwill Career Camp, UNC Asheville STEAM Studio (build your own
electric guitar), Carol Belk Theatre (costumes & cosplay), Highland Brewing (youth volleyball
camps), Reynolds Baptist VBS, Grassy Branch Baptist VBS, Haywood County 4-H STEM camp.

Also notable: **Ninjaville alone had 44 listings** (one per camp day) via AVL Today and
Explore Asheville. Camps already leak into the feed as daily events.

### 2.4 How many camps exist (rough)

Lincoln-Petersen capture-recapture against the sheet (n = 96):

- vs Macaroni Kid: 96 × 15 / 12 ≈ **120**
- vs AVLGO events: 96 × 25 / 12 ≈ **200**

So **roughly 150-200 camps in Buncombe alone** under the sheet's own definition. The sheet is
maybe half complete. With a 55/75-minute drive radius and a low bar for what counts (§3),
expect **several hundred**. Both samples are biased (paid listings; event-feed sources) and
not independent of the sheet's web search, so treat these as order-of-magnitude numbers,
never as a completeness percentage or a launch target.

### 2.5 Azure web search works

Probe on 2026-10-28:

```
POST https://batch-ai.services.ai.azure.com/openai/v1/responses
api-key: $AZURE_OPENAI_API_KEY
{"model":"gpt-6.1-sol","input":"<question>","tools":[{"type":"web_search"}],"reasoning":{"effort":"low"}}
```

- HTTP 200. Output items: `web_search_call`, `reasoning`, `web_search_call`, `message`, with
  `url_citation` annotations. About **14k input / 300 output tokens** per call (search
  results count as input).
- Asked for day camps within an hour but outside Buncombe, it returned Kanuga Day Camp and
  Camp Tekoa (Hendersonville) and Waynesville Summer Basecamp, all real.
- **Its drive-time guesses were wrong:** it put Hendersonville at 50-60 minutes, which is
  about twice the real ~30-minute drive. Never let the model judge drive time (§6.2).
- Nothing in the codebase uses the Responses API yet; every Azure call is Chat Completions
  (`lib/ai/provider-clients.ts`). The installed `openai` SDK (^6.10) supports
  `client.responses.create`, so the pipeline needs a small new helper.
- Env note: the app's Azure client already uses Batch-AI locally (`.env`
  `AZURE_OPENAI_ENDPOINT` → `batch-ai`, key from the Windows user env var
  `AZURE_OPENAI_API_KEY`). The `.env` lines `AZURE_ENDPOINT` / `AZURE_KEY_1` point at an old
  `wrenly-openai` resource and are unused because the code prefers the `AZURE_OPENAI_*`
  names. Batch-AI deployments include `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`.

### 2.6 Jina is blocked from this PC

`r.jina.ai` from Matt's PC: keyless → 401 "blocked" (the home IP was flagged during the
2026-10-14 verify work); with `.env`'s `JINA_API_KEY` → 401 "Invalid API key". Jina works
from Vercel (the verify cron uses it). Before running extraction locally we need a new Jina
key or a different fetcher (§6.3).

### 2.6a We don't need Jina: our own fetcher reads every camp page

Test on 2026-10-28 from Matt's PC, all 92 sheet camps with an own-site URL:

- **86 plain `fetch`** (current Chrome UA), **2 `fetchAsChrome`** (Chrome TLS fingerprint),
  **4 headless patchright**, **0 failed**, 0 thin pages. None needed Matt's real Chrome.
  Three of the headless four were HTTP 404 to plain fetch (moved or soft-404 pages: Asheville
  Junior Theater, Ruby Ranch, The Asheville Kitchen); recheck those URLs.
- Landing pages: 54/92 show a price, 82/92 mention 2026 or 2027, 62/92 mention registration,
  **20/92 link PDFs**.
- **Registration platforms are fragmented:** 32/92 pages link a known platform, spread over
  Google Forms (8), Jotform (4), Shopify (4), Jackrabbit (3), iClassPro (3), CampDoc (3), and
  one each of Tandem, WebTrac, PlayMetrics, Doubleknot, RecDesk, Procare, Brightwheel, Square,
  Eventbrite, SportsEngine. No platform covers enough camps to justify a v1 integration.

### 2.6b Sol + web search vs. fetch + Sol (extraction bake-off)

Four camps (Art Museum, Museum of Science, YMCA Adventure Camp, Rockmont), seven fields each
(season dates, ages, weekly price, hours, aftercare, registration opens, financial aid), each
answer with a source URL and a verbatim quote. Quotes were then checked against the cited
page fetched by our own fetcher (PDFs via `unpdf`).

| Mode                                          | Fields filled | Quotes found verbatim on the cited page | Time / tokens per camp      |
| --------------------------------------------- | ------------: | --------------------------------------: | --------------------------- |
| **Sol + `web_search`** (camp name + site URL) |   **22 / 28** |                             **21 / 22** | 22-44 s, 16-28k in, ~1k out |
| Fetch the given URL + Sol (no search)         |        7 / 28 |                                   7 / 7 | 7-13 s, ~1k in              |

- Web search found the right subpages and PDFs by itself (AMOS's PDF guide, the YMCA's
  program page, Rockmont's `dates-rates-2027` page). Three of the four given URLs were hub
  pages, so the single-page fetch had little to read.
- The one unverified quote (YMCA aftercare) was a paraphrase. A mechanical verify step
  catches that.
- **Overnight camps run on a different calendar.** Rockmont already lists 2027 dates
  (June 27 - July 23) and rates ($2,650), and its CIT page says registration opened Thursday,
  Aug 27 at 11 a.m. Day camps opened in January-February 2026 (Museum of Science Jan 12, Art
  Museum Feb 9 at 10 a.m.). So by December some overnight camps will already be open or full,
  and that's useful information to show.

**Decided (Matt, 2026-10-28, N1): no Jina and no real Chrome.** Extraction = Sol + `web_search`, then
**verify every quote against the cited page with our own fetcher**; a field whose quote isn't
on the page is dropped or sent to review. The fetcher is still needed for verification and
for the weekly refresh (hash the source pages, re-run Sol only when one changed). See §6.3.

### 2.7 Wayback Machine coverage of last winter

Can we recover last year's registration-open date and sold-out timing from archived camp
pages? CDX query, distinct page versions (status 200), Nov 1, 2025 - Apr 30, 2026:

| Page                                               | Versions | Range           |
| -------------------------------------------------- | -------: | --------------- |
| ashevillenc.gov register-for-asheville-summer-camp |        2 | Feb 15 - Mar 24 |
| rockmont.com (home)                                |        1 | Nov 8           |
| ymcawnc.org/camps                                  |        0 |                 |
| ashevillescience.org/camps                         |        0 |                 |
| ashevilleart.org summer-camp                       |        0 |                 |
| abysa.org camp page                                |        1 | Jan 22          |
| ashevillefarmstead.org/camp-farmstead              |        3 | Jan 14 - Apr 17 |
| ashevillemusicschool.org/summer-camps              |        4 | Nov 7 - Apr 17  |
| ashevillejuniortheater.com/summer-camps            |        2 | Jan 24 - Mar 11 |
| bmtmont.org/summer-camps                           |        0 |                 |
| cultivateclimbing.com (home)                       |        7 | Nov 8 - Mar 6   |
| ncarboretum.org (home)                             |      308 | daily           |

**Conclusion:** "Sold out in N days last year" is not recoverable for nearly any camp: a few
snapshots over six months can't time a sell-out. "Registration opened Jan 10 last year" is
sometimes recoverable when a snapshot quotes the date, or when the current page still says
it. Our own refresh job (§6.5) will record 2027 openings and sell-outs as they happen, so
that history exists for 2028.

---

## 3. Decisions made (Matt, 2026-10-28)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Free. No sponsors, no ads, no paid placement.                                                                                                                                                                                                                                                                                                                                                                                           |
| D2  | Never rely on user-entered data. Code + AI find and extract everything.                                                                                                                                                                                                                                                                                                                                                                 |
| D3  | Inclusion radius measured by **drive time from downtown Asheville**: **≤55 min for day camps, ≤75 min for overnight camps.** Crossing state lines is fine (Greenville SC, Johnson City TN) if a camp is within the limit.                                                                                                                                                                                                               |
| D4  | **Low bar for what counts as a camp.** VBS, one-off clinics and teen pre-college programs all count. A type filter lets parents exclude what they don't want.                                                                                                                                                                                                                                                                           |
| D5  | **Card unit** (refined by N4): a separate card when the program, ages/eligibility or attendance location differ. Price tiers (member, resident, early-bird, extended care) stay on one card. A program's themed weeks stay on one card.                                                                                                                                                                                                 |
| D6  | **v1 is one card per camp** (a directory + registration tracker) by about Dec 1. Session-level detail comes later.                                                                                                                                                                                                                                                                                                                      |
| D7  | **Reminders v1:** a per-camp `.ics` download so parents add the date to their own calendars, **plus a subscribable calendar feed of saved camps if it fits in v1** (§4.4), so dates posted later reach parents' calendars on their own.                                                                                                                                                                                                 |
| D8  | **Popularity:** count camp-detail page views + clicks out to the camp's site as **one number**. Count each visitor once per camp per day, from a beacon after page load (like the Spotify player) so crawlers don't inflate it. **No minimum** before a count shows. Window: **views in the last 14 days** (N6).                                                                                                                        |
| D9  | **Feedback:** a generic box where anyone can drop a camp link to check or a fix for wrong data, like the existing "event data is wrong" report flow (posts to Slack).                                                                                                                                                                                                                                                                   |
| D10 | **Camps also appear in the event feed**, with a camp tag, dated at the camp's start. Low scores should keep them out of Top 30. They must dedupe against camp listings already scraped (AVL Today, Explore Asheville, Parks & Rec).                                                                                                                                                                                                     |
| D11 | Registration dates live on `/camps`, **not** as events in the feed.                                                                                                                                                                                                                                                                                                                                                                     |
| D12 | **Show 2026 data labeled "2026"** when that's all we have; replace it once 2027 data is posted.                                                                                                                                                                                                                                                                                                                                         |
| D13 | URL **`/camps`**. Header: replace the "Playlist" tab with a **"More"** dropdown holding **Playlist** and **Summer Camps**.                                                                                                                                                                                                                                                                                                              |
| D14 | A **seasonal banner with a tent icon** during registration season, **plus the season's item in the Events dropdown** (as Halloween has). Window **Nov 5 - Mar 31** each year (N13); this first season it starts at launch.                                                                                                                                                                                                              |
| D15 | Filters: **hours and aftercare**; **kids' ages entered once and stored on the device**, plus a **"fits both kids"** filter; **financial aid** and **special-needs support** as tags.                                                                                                                                                                                                                                                    |
| D16 | Show **"Registration opened Jan 10 last year"** when we have it. **Skip "sold out in N days last year"** for now (not recoverable for 2026, §2.7); still record 2027 status changes so it's possible later.                                                                                                                                                                                                                             |
| D17 | **A detail page per camp** (`/camps/[slug]`) for SEO ("summer camps Asheville" is searched heavily each winter).                                                                                                                                                                                                                                                                                                                        |
| D18 | **Pipeline:** Azure `gpt-6.1-sol` with web search (Batch-AI) to expand the list, then a second Azure flow with web search + a page fetcher to extract details. Matt's Chrome as a fallback for sites that block agents. All discovery ideas (seed-similar, category × town grid, aggregator sweeps, our own DB, stop rule) and extraction ideas (linked pages + PDFs, evidence quotes, Wayback, change-detection refresh) are approved. |

---

## 4. v1 product spec

### 4.1 `/camps` (the directory)

**Header area:** title ("Summer camps near Asheville, 2027"), one line on what's here, a
count ("312 camps"), and "Last checked" freshness.

**My kids (on device):** one or more ages (or grades) stored in localStorage. Used by the
age filter and "fits both kids". No account.

**Filters** (all client-side over the full list, which is small):

- Kid age / grade (from "my kids", or ad hoc); **fits all my kids** (card's age range covers
  every saved kid; same-week matching needs sessions, so it arrives in phase 2)
- Type: day, half-day, overnight, evening, VBS, clinic / one-off, pre-college
- Category: arts, music, theater, dance, STEM / coding, nature / outdoor, sports (by sport),
  horses, cooking, academic, faith-based, general / multi-activity, special needs
- Drive time from downtown (≤15, ≤30, ≤45, any) and town
- Price band (free, <$150/wk, $150-300, $300+, overnight priced per session), with a
  "price is 2026" marker when applicable
- Hours: "covers a workday" (e.g. drop-off ≤8:30 and pickup ≥5:00 with aftercare),
  full day, half day
- Registration: open now, opens soon (≤14 days), not announced, waitlist/full
- Tags: financial aid / scholarships, special-needs support, lunch included,
  transportation, aftercare

**Sort:** registration date (soonest first; the default during registration season),
popularity this week, drive time, price, name.

**Card contents:** name + provider; type and category chips; ages; town + drive minutes;
price range (with year label); season dates (with year label); hours / aftercare;
**registration status** line (the most prominent element, §4.3); popularity count; buttons:
**Add registration reminder** (.ics), **Camp website** (counted, §4.5), **Details**.

### 4.2 `/camps/[slug]` (one camp)

Everything on the card plus: a short factual description written from the camp's page,
all locations, sessions/themes as listed (text in v1), what's included, financial aid
details, special-needs notes, **sources with "checked on" dates**, "Registration opened
<date> last year" when known, a feedback link prefilled with the camp, and related camps
(same category, similar ages, nearby).

SEO: unique title/description per camp, canonical `https://www.avlgo.com/camps/<slug>`,
listed in `sitemap.xml`. Don't emit Event JSON-LD (a camp isn't one event and Google
rejects partial Event data, see CLAUDE.md); consider `Organization` / `Place` only if it adds
something. `/camps` itself should rank for "summer camps Asheville" queries.

### 4.3 Registration status model

(Per §12 N2, this one status is stored as three separate facts in §5's revised model: season
published, registration milestones per audience, and availability. The labels below are
still what a parent sees.)

Per camp, per year:

- `not_announced`: no 2027 info yet (show "Opened Jan 10 last year" when known)
- `dates_posted`: 2027 camp dates are up, registration date not stated
- `opens`: a stated open date (and time when stated, e.g. "Jan 10, 9:00 a.m."); members-
  first or lottery details in a note
- `open`
- `waitlist` / `full` (record the timestamp we first saw it: that's next year's sold-out
  history)
- `closed`

Every status carries `source_url`, `quote` and `checked_at`. Only the camp's own pages (or
its registration platform) can set `opens`, never a third-party listing.

### 4.4 Registration reminder (.ics)

Build on `lib/utils/icsGenerator.ts`, which is **not drop-in**: it uses random UIDs, a
2-hour default, truncates descriptions to 500 chars and has no alarms or date-only mode (the
Top 30 generator has stable-UID and alarm examples). Rules:

- **Explicit time stated** → timed event in America/New_York with two alarms (the day
  before, and 15 minutes before).
- **Date only** → all-day reminder titled "… registration opens (time not stated)", alarm
  the day before only. Never invent a time.
- Stable `UID` per camp + season + milestone + audience (public / member / lottery …), so a
  public opening and a members' opening are separate reminders.
- Lottery or application deadlines are labeled as such, not as "opens".
- Description: registration URL + AVLGO camp page URL. If the date isn't announced, the button reads "Registration date not posted
  yet". Open question Q4 covers an optional "remind me to check" reminder.

**Subscribable feed of saved camps (D7, v1 if it fits):**

- Saved camps are a list on the parent's device (localStorage, like favorites).
- "Subscribe in your calendar" creates a short random token and stores
  `camp_calendars (token, camp_ids[], created_at, updated_at, last_fetched_at)`. Saving or
  unsaving a camp updates that row, so the URL never changes.
- `GET /api/camps/calendar/<token>.ics` builds the ICS on every request from current data:
  one all-day or timed event per saved camp's registration opening (with alarms), plus the
  camp's 2027 season start once known. Stable `UID` per camp + year so calendar apps update
  events in place instead of duplicating them. `Cache-Control` short (e.g. 15 min).
- Buttons: `webcal://` link (Apple Calendar, Outlook) and a Google Calendar "add by URL"
  link (`https://calendar.google.com/calendar/r?cid=webcal://…`). Google re-fetches
  subscribed feeds slowly (hours to about a day); fine for dates posted weeks ahead, and the
  page says so.
- No account. The token is unguessable; the feed contains only public camp data.
- Excluded from the `proxy.ts` matcher (no session cookies) and from `robots`.

### 4.5 Popularity

- Beacon: after the detail page loads (in a `useEffect`, never during render), and when the
  "Camp website" link is clicked, POST `/api/camps/[id]/view`.
- Count once per visitor per camp per day: a localStorage guard on the client (skip if
  already sent today for this camp) plus a per-IP rate limit (`lib/utils/rate-limit.ts`,
  in-memory like the favorites endpoint). Like favorites, it's forgeable; that's
  acceptable.
- Storage: `camp_views (camp_id, day, count)` incremented with an upsert.
- Display: one number, **"views in the last 14 days"** (N6): the sum of the last 14 Eastern
  days of `camp_views`. No all-time count.

### 4.6 Feedback box

On `/camps` and each detail page: one textarea ("Missing a camp, or something wrong? Paste a
link or tell us") + optional camp id → `POST /api/camps/feedback` → Slack, rate limited per
IP, stores nothing. That mirrors `/api/events/report` + `sendEventReport` in
`lib/notifications/slack.ts`. A later upgrade could auto-run extraction on a submitted link
into a review queue.

### 4.7 Header and seasonal banner

**Header (D13):** today the tabs are Events (dropdown) · Disaster Plan · News · Playlist ·
Parking (`components/EventTabSwitcher.tsx`). Replace Playlist with a **More** dropdown
(Playlist, Summer Camps), reusing the Events menu's dropdown component (hover at lg+ with a
fine pointer, tap otherwise). "More" highlights on `/playlist` and `/camps*`.

**Seasonal banner (D14):** `lib/seasons.ts` + `components/seasonal/SeasonalLinks.tsx`
already run Halloween. A running season gives three things:

1. a thin banner across the top of every page, linking to the season page;
2. a badge beside the logo (the pumpkin);
3. an extra item in the **Events** dropdown (the "menu link"; for Halloween it's
   "Halloween" with a ghost icon).

For camps: the banner with a **tent icon** ("Summer camp registration is opening: dates and
reminders →") and the **Events-menu item** ("Summer camps", tent icon), even though Summer
Camps also lives under More (Matt, 2026-10-28). No logo badge at launch (scope cut).
**Window (N13): Nov 5 - Mar 31 every year;** this first season from launch (~Dec 1) to
Mar 31. Nov 1-2, 2026 carry a separate banner for `/plan` (the open letter), handled as its
own change before Nov 1, not part of the camps build. Code changes needed:

- `currentSeason()` compares `MM-DD` strings within one year, so a season that **wraps the
  new year** (`11-05` → `03-31`) never matches. It needs wrap-around support, and
  `seasonBanner()` builds the end date from the current year (`lib/seasons.ts:34`), so in
  November it would name last spring's date; it must roll the year forward too.
- `EventsMenu` in `components/EventTabSwitcher.tsx` is specialized to the event tabs; the
  "More" dropdown needs a small shared dropdown extracted from it, not a copy.
- `LOOK` needs a camps entry (tent mark, colors), and the menu item and badge need to be
  optional per season.
- Halloween-only behavior (`DARK_ONLY`, the season-picks admin) must not apply to camps.

### 4.8 Camps in the event feed (D10)

- Source `CAMPS`. One event per camp card, dated at the **first 2027 session start**. Create
  it only once a 2027 date is known (a 2026 date is in the past).
- `url` = `https://www.avlgo.com/camps/<slug>`, not the camp's website: `events.url` is
  unique, and AVL Today rows often already use a venue's or organizer's homepage as their
  URL, so a camp website URL could collide with an existing row. Pointing at our camp page
  also keeps parents on AVLGO's richer view.
- **Annual identity:** `events.url` is unique, so one URL per camp can't carry a 2027 and a
  2028 event. Use `https://www.avlgo.com/camps/<slug>?season=2027` (or a `sourceId` of
  `camp:<id>:2027`) as the event identity.
- **Tags must be seeded complete** (new official "Summer Camp" tag + Family + categories):
  the AI cron only tags events whose `tags` are empty (`app/api/cron/ai/route.ts:216`), so a
  pre-tagged event never gets the "usual pass".
- **Top 30 needs an explicit exclusion.** Camps do _not_ score low: last summer's 122 scored
  camp events had a median of 10 (all summer events: 9) and a max of 18 (the 90th
  percentile), and the Top 30 query has no minimum score
  (`lib/db/queries/events.ts:791`). Exclude by **camp membership** (the CAMPS source _and_
  scraped listings mapped to a camp), across all three Top 30 categories.
- **Cross-state camps would be hard-deleted.** The cleanup cron deletes every event whose
  location looks non-NC (`app/api/cron/cleanup/route.ts:343`), which would remove
  radius-qualified Greenville SC or Johnson City TN camp events (D3). Exempt camp events.
- **Dedupe needs camp identity, not another fuzzy rule.** Rule-based dedup's "Method E"
  merges a known venue + same day + **one** shared title word
  (`lib/utils/deduplication.ts:728`), which can merge two different camps at one venue, and
  merged rows don't keep camp associations. Map scraped camp listings (AVL Today, Explore
  Asheville, Eventbrite, Parks & Rec) to their camp explicitly and suppress them in favor of
  the canonical camp event; never let generic dedup merge two camp events.
- **Parks & Rec:** reuse the WebTrac catalog _parser_ (`lib/scrapers/ashevilleparksrec.ts`,
  FMID, dates, hours, ages, fees, registration-open tooltips), not the scraper as is: it
  looks only 120 days ahead and drops full / closed / waitlist rows.
- **"All events" (N7):** camp events are hidden by default and shown when the "Summer Camp"
  tag filter is selected. They never appear in Top 30.

### 4.9 Conventions

Mobile first (16px gutters), dark mode, Tailwind inline classes, one shared "live camp"
predicate (not hidden) like `liveEvent`, `useSearchParams` behind its own `<Suspense>` if
used, filters kept in the URL (like `/groups` with
`history.replaceState`) so links to a filtered view can be shared in parent chats.

---

## 5. Data model (proposed)

New tables (migration by hand, RLS deny-all like `groups`; all access through server-side
Drizzle):

**`camps`**, one row per card:

| Field                                                                           | Notes                                                                       |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`, `slug`                                                                    | slug from provider + camp name                                              |
| `provider_name`, `name`                                                         | "YMCA of WNC", "Adventure Camp"                                             |
| `website_url`, `camp_page_url`, `registration_url`                              |                                                                             |
| `type`                                                                          | day / half_day / overnight / evening / vbs / clinic / pre_college           |
| `categories text[]`, `tags text[]`                                              | tags include financial_aid, special_needs, aftercare, lunch, transportation |
| `age_min`, `age_max`, `grade_min`, `grade_max`                                  | both kept; "rising 3rd grade" ≈ age 8 conversion documented                 |
| `location_name`, `address`, `lat`, `lng`, `town`, `state`                       | first/primary site                                                          |
| `other_locations jsonb`                                                         | for multi-site cards that still share ages and price                        |
| `drive_minutes`                                                                 | from downtown Asheville (§6.2)                                              |
| `price_min_cents`, `price_max_cents`, `price_unit`, `price_year`, `price_notes` | unit: week / session / day                                                  |
| `season_start`, `season_end`, `dates_year`                                      |                                                                             |
| `hours_start`, `hours_end`, `aftercare_until`                                   |                                                                             |
| `reg_status`, `reg_opens_at`, `reg_opens_text`, `reg_year`, `reg_note`          | §4.3                                                                        |
| `last_year_reg_opened`                                                          | date, when recovered                                                        |
| `description`                                                                   | short, factual                                                              |
| `image_url`                                                                     | optional, `og:image`                                                        |
| `evidence jsonb`                                                                | per field: `{url, quote, checked_at}`                                       |
| `page_hash`, `last_checked_at`, `last_changed_at`                               | refresh bookkeeping                                                         |
| `discovered_by text[]`                                                          | which discovery methods found it (completeness math)                        |
| `hidden`, `event_id`, `created_at`, `updated_at`                                |                                                                             |

**`camp_status_history`**: `(camp_id, year, status, seen_at, source_url)`. Append-only. This
is where "sold out 2 days after opening" comes from next year.

**`camp_views`**: `(camp_id, day, count)`.

**Phase 2 `camp_sessions`**: `(camp_id, year, start, end, days, hours, age_min, age_max,
price_cents, theme, status)`.

**Revised model (after the Codex review; approved as §12 N2; supersedes the tables
above).** The single-row model above can't keep per-year facts (Q9) and folds
three different facts into one status. Split:

- `camps`: stable identity of one offering (provider, program, variant, slug, aliases,
  `hidden`), independent of year, price or URL.
- `camp_seasons (camp_id, season_year)`: that year's facts (dates, ages/grades, hours incl.
  early drop-off / late pickup and their cost, prices, locations, tags) + evidence.
- `camp_registration_milestones`: `(camp_id, season_year, audience, kind, date, time NULL,
precision, source_url, quote)`; audience = public / member / returning / lottery …,
  kind = opens / deadline / lottery_results. **Season year ≠ date year** (2027 registration
  can open in 2026).
- Availability, separate from milestones: `unknown | available | mixed | waitlist | full |
closed`, with the session/variant scope it applies to and when it was observed.
- `camp_observations`: append-only fetch/verify log (status, hash, failures). Sell-out timing
  is the interval between last-seen-available and first-seen-full, never an exact time.
- Platform identity kept (FMID, `idCamp`/`idSession`, OrgID); a registration host's domain
  is never a merge key.
- **Unknown is unknown:** don't reuse the event feed's `isFreeEvent` (missing price = free);
  unstated aid, aftercare or support stay unknown.
- **Eligibility:** store stated ages and grades separately and apply both; never convert
  "rising 2nd grade" into an age. "My kids" asks for age during summer 2027 or rising grade.

**Source of truth (revised):** the pipeline writes reviewed JSON imports to `data/camps/`
plus a hand-edited `data/camps/camp-overrides.json`. **After the first import the database
is authoritative**: an import never deletes a camp it doesn't mention (unlike
`scripts/groups/seed-groups.ts`, which deletes absent rows), and an older import never
overwrites newer evidence. Overrides are re-applied on every write.

---

## 6. Data pipeline

All stages are scripts under `scripts/camps/`, resumable, writing intermediate JSON to
`data/camps/` (committed, like `data/groups/`), with a Codex review after each major phase.

### 6.1 Stage A: discovery

Goal: every candidate camp (name + URL + town + why) within the radius.

1. **Seeds:** the sheet's 96 rows, Macaroni Kid's 15, the ~25 providers from our events
   table (re-queried by title/organizer, summer 2025 + 2026).
2. **Seed-similar (Matt's idea):** per seed, Sol + web search: "camps similar to X for kids
   near Asheville NC that are not in this list: …". Cheap-ish but biased toward
   well-ranked camps and the seeds' categories.
3. **Grid:** ~15 categories × ~20 towns inside the radius (Asheville, Black Mountain,
   Swannanoa, Weaverville, Woodfin, Fairview, Arden, Fletcher, Candler, Leicester,
   Hendersonville, Brevard, Waynesville, Canton, Marshall, Mars Hill, Burnsville,
   Old Fort / Marion, Saluda / Tryon, Johnson City, Greenville SC area for overnight).
   Includes "vacation bible school <town> 2026" and town/county Parks & Rec (the probe
   found Waynesville's).
4. **Aggregator sweeps:** Macaroni Kid (Asheville and neighboring editions), kidvoyage,
   campsearch, the American Camp Association's camp finder, allevents, asheville.com,
   Explore Asheville, local parent-magazine camp guides if any still publish.
5. **Our own DB:** AVL Today / Explore Asheville / Eventbrite / Parks & Rec camp-like
   listings (§2.3).

Each candidate records `discovered_by`.

**Revisions after the Codex review:**

- **Providers first, then offerings.** Dedupe the seeds into providers, then read each
  provider's camp / registration pages once to enumerate its cards, rather than searching
  per card.
- **Add two local directories now:** Asheville City Schools' **Beyond School** directory
  (`beyondschool.ashevillecityschools.net`: grades, sliding-scale cost, scholarships,
  transportation, extended care) and **828newsNOW's WNC summer camp guide** (includes
  faith-based and overnight). Discovery inputs only, never authoritative for dates.
- Priority order: municipal catalogs, 4-H / Extension, schools, universities, museums, arts
  orgs, youth sports, then national aggregators. Search terms beyond "camp": "summer
  program", "summer childcare", "clinic", "youth enrichment".
- **VBS:** seed churches from church-association directories, search "vacation bible school"
  and "VBS" with 2026, 2027 and no year. A church existing doesn't mean it runs VBS.
- Don't feed the model the growing exclusion list; dedupe returned names/URLs in code.
- **Stop rule (bounded):** finish the priority source list, run two gap-filling rounds, stop
  when both yield few _verified_ new providers or the date/budget is reached. Report blocked
  sources separately. No completeness percentage.
- **Hallucination guard:** a URL that doesn't resolve, or a page that doesn't mention a kids'
  camp/program, goes to a review queue, not the bin: a fetch failure can be a block.

### 6.2 Stage B: normalize, geocode, drive time, dedupe

- **Geocode** each attendance site (the drop-off entrance, not an office address).
- **Drive minutes** from one fixed origin (Pack Square) as a 1×N matrix; no map UI, no N×N.
  Options (per the Codex review): HeiGIT / OpenRouteService (free key; the old
  `api.openrouteservice.org` host is being retired Nov 2-6, 2026, use `api.heigit.org`;
  results are CC-BY-SA, so credit them), Nominatim for a small one-time geocode batch, or
  Google (Routes "Compute Route Matrix", not the legacy Distance Matrix; affordable at this
  volume but its terms limit storing results). Apply D3 on unrounded minutes; review sites
  within ~5 minutes of the cutoff and uncertain geocodes. **Not the LLM** (§2.5).
- **Dedupe:** normalized registrable domain + name similarity + geocode proximity, then an
  LLM pass over candidate clusters, then `camp-overrides.json`. Traps:
  - Registration platforms host many unrelated camps on one domain (UltraCamp, CampBrain,
    CampMinder, Jackrabbit, ActiveNet / WebTrac, Eventbrite, Squarespace / Wix sites); keep
    a platform-domain list and never merge on those domains alone.
  - One provider, many cards: the YMCA is 4 rows today and UNCA 4. Apply D5.

### 6.3 Stage C: extraction

Per camp:

- **Extract with Sol + `web_search`** (§2.6b), given the camp's name and site URL, into the §5
  schema with a **source URL and verbatim quote per field**, `null` when unstated, and the
  **year** each fact applies to (prefer 2027, else 2026). Splits a provider into cards per D5.
  Web search finds the subpages and PDFs itself.
- **Verify every quote** against the cited page using our own fetcher, a small
  `fetchPageText(url)` utility: plain fetch → `fetchAsChrome` → headless patchright, PDFs via
  `unpdf`, cheerio cleanup to text (add `turndown` only if markdown turns out to help).
  A field whose quote isn't on its page is dropped or queued for review. Registration dates
  must verify on the camp's own domain or its registration platform. (Jina isn't needed:
  §2.6a.)
- **Chrome fallback** (Matt's Chrome via claude-in-chrome, or headed patchright as for
  MountainX) for Cloudflare-blocked or login-walled pages.
- **Responses helper:** a separate client for `https://batch-ai.services.ai.azure.com/openai/v1`
  (the existing `AzureOpenAI` client builds a versioned `/openai` base and Chat Completions
  calls). Responses syntax is `reasoning: { effort: 'low' }`, not `reasoning_effort`.
- **Evidence must fit the season and offering**, not just contain the date string. Never
  infer an opening date from last year, a recurring pattern, a copyright year or the first
  time we saw registration open.
- **Deterministic catalog parsing first** where a page is a structured catalog (WebTrac,
  UltraCamp public session pages, Jackrabbit listing tables); Sol for prose.
- **Validation flags, not rules:** ages outside 2-19, odd price units, registration outside
  Oct-Jun (overnight camps open in late summer; Camp Carolina already takes 2027
  registrations), weekday/date contradictions, min > max. Flags go to review.
- **Review every registration-opening milestone by hand before launch**; spot-check other
  fields.

### 6.4 Stage D: last year's registration date

For each camp, ask the current page first (many say "registration opened Jan 10"). Then
Wayback: list snapshots Nov 2025 - Apr 2026 (CDX API), fetch the few that exist, extract
"registration opens/opened" statements. Expect a minority of camps (§2.7). Store in
`last_year_reg_opened` with evidence.

### 6.5 Stage E: refresh (ongoing, through the summer)

- Weekly re-fetch of **every evidence URL** (pages, catalogs, PDFs), hashing normalized
  text; re-run extraction only on change.
- Daily during January, and daily around any camp's opening date and just after it.
- A failed fetch keeps the facts, logs the failure and does **not** advance "checked on".
- Record observations in `camp_observations` (§5).
- Keep refreshing **through the summer**, not only to April; re-run discovery in spring
  (VBS posts late).
- Camp cache invalidation (tag), plus a freshness check in `cron:health` that flags a camp
  job that didn't run or did nothing useful.
- Runs as a Vercel cron (`/api/cron/camps-refresh`, recorded in `cron_job_runs` and covered by
  `npm run cron:health`). Pages that only Chrome can read are refreshed by the nightly local
  scheduled task.

### 6.6 Stage F: publish

Seed script (dry run by default, `--apply`) upserts `camps`, applies overrides, prints a
coverage report (by type, town, category, fields missing), and creates/updates feed events
(§4.8).

### 6.7 Cost

A discovery web-search call is ~14k input tokens; extraction with web search measured
16-28k input + ~1k output per camp (§2.6b). A few hundred of each, plus retries, is on the
order of 10-20M input tokens: small. The weekly refresh only calls the model when a page
changed. Measure cost per accepted card during the pilot and set a budget from that.

---

## 7. What AVLGO already has (reuse map)

| Need                                                | Existing piece                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Research → JSON → overrides → seed pipeline         | Group Directory: `data/groups/README.md`, `scripts/groups/build-directory.ts`, `scripts/groups/seed-groups.ts` |
| Directory page with search + chips in the URL       | `/groups` (`app/groups/page.tsx`, `components/groups/`)                                                        |
| Azure client                                        | `lib/ai/provider-clients.ts` (Chat Completions only; add a Responses helper)                                   |
| Page reading + "only what the page says" extraction | `lib/ai/eventVerification.ts` (Jina fetch with optional `JINA_API_KEY`)                                        |
| Cloudflare-resistant fetch                          | `lib/scrapers/fetchAsChrome.ts`; patchright (MountainX's headed tier)                                          |
| Calendar file                                       | `lib/utils/icsGenerator.ts`                                                                                    |
| Report → Slack                                      | `app/api/events/report/route.ts`, `sendEventReport` in `lib/notifications/slack.ts`                            |
| Beacon after load                                   | `components/EventSpotifyPlayer.tsx` (`useEffect` fetch)                                                        |
| Per-IP rate limit                                   | `lib/utils/rate-limit.ts`                                                                                      |
| Seasonal banner / badge / menu item                 | `lib/seasons.ts`, `components/seasonal/`                                                                       |
| Header tabs + dropdown                              | `components/EventTabSwitcher.tsx` (`EventsMenu`)                                                               |
| Cron bookkeeping + health                           | `cron_job_runs`, `npm run cron:health`                                                                         |
| Local-only jobs                                     | `scripts/scheduled-local.ps1` (Windows scheduled tasks)                                                        |
| Family tag                                          | `lib/config/tagCategories.ts` (Family, Education exist; no camp tag)                                           |

---

## 8. Phases and timeline

Today is Wed Oct 28, 2026. About five weeks to Dec 1.

Revised after the Codex review: **pilot first**, so extraction and schema failures show up
while there's time to change them.

| Week            | Work                                                                                                                                                                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oct 29 - Nov 4  | **Pilot: 15-25 deliberately varied providers** (a WebTrac catalog, a PDF-only camp, an overnight camp, a VBS, grade-only eligibility, several price tiers, a blocked site) through extraction + quote verification into the §5 tables, and a rough working `/camps` + detail page on that data. Codex review of the pilot. |
| Nov 5 - Nov 18  | Discovery at scale (§6.1), geocode / drive time / dedupe, extraction + verification for every camp, review queue; filters, per-camp .ics, saved camps, popularity, feedback box.                                                                                                                                           |
| Nov 19 - Nov 25 | Release candidate: header "More" menu, seasonal banner + Events-menu item, feed events (identity, Top 30 exclusion, dedupe, non-NC exemption), sitemap, refresh cron. Subscribable calendar if on schedule (§12).                                                                                                          |
| Nov 26 - Dec 1  | Verification week (Thanksgiving): hand-check every registration milestone, real-browser UX review (mobile, dark mode), Codex review; launch; Robert shares the link in the parent chats.                                                                                                                                   |

**Review gate after every major implementation step (Matt, 2026-10-28).** Each major step (for
example the fetcher + Responses helper, extraction + verification, the schema/migration, the
pages, and each scale-up stage) ends with a Codex review (`codex-as-subagent` skill, `gpt-6.1-sol`
at xhigh, read-only) that checks three things:

1. the step follows this plan, especially §5's revised model and the §3/§12 decisions;
2. the code is fully correct;
3. it is as simple and clean as it should be.

Every finding is triaged (adopt, or reject with a reason), the adopted fixes are applied before the
next step starts, and the gate's outcome is logged in the pilot report
(`03-pilot-report.md`) or, after the pilot, in that stage's report.

**Phase 2 (Jan - Mar):** session-level rows as camps publish; **week-by-week summer planner**
(pick each kid's age, see what's open each of the ~10 weeks; the real job for working
parents); side-by-side compare; same-week "fits both kids".

**Phase 3:** popularity history and email reminders.

---

## 9. Potential upgrades (parked)

- (The subscribable calendar feed moved into v1 scope; see §4.4.)
- Email reminders for signed-in users (Postmark + Google sign-in already exist).
- Week-by-week planner, compare view, same-week sibling matching (phase 2).
- Spring break, winter break and teacher-workday camps (`/camps` already fits).
- Showing "sold out N hours after opening last year" in 2028, from `camp_status_history`.
- Live seat counts for platforms that expose them publicly (WebTrac shows openings).
- Auto-processing feedback-box links through extraction into a review queue.

---

## 10. Open questions

(Recommended answers to all of these, plus new decisions from the Codex review, are in §12.)

1. **Popularity windows:** show "this week" and "all time"? Recommendation: yes. "This week"
   is the signal during registration season; "all time" adds weight once counts are small.
   Label as "views" (visitors aren't necessarily parents). Is "24 hours" better than "this
   week" (Robert's framing) given small early counts?
2. **Camps in "All events":** low scores keep camps out of Top 30, but "All events" lists by
   date regardless of score, so June 7 and June 14, 2027 could each carry 100+ camp events.
   Accept that, or hide source `CAMPS` from the default feed unless the camp tag is selected?
   And when a camp is already in the feed from AVL Today/Explore Asheville (often one event
   per day, e.g. Ninjaville's 44), which copy wins?
3. **Seasonal banner window:** Nov 1 - Feb 28? Through March? From launch day?
4. **Reminder when no date is posted:** offer "remind me to check" around last year's
   opening date (or a fixed early-January date)? Or nothing?
5. **Fetcher (decided, N1):** Sol + web search extracts; our own fetcher verifies quotes
   and drives refresh (§2.6a, §2.6b, §6.3). No Jina key needed.
6. **Geocoding / routing provider:** free (Nominatim + OSRM / OpenRouteService) or Google?
7. **Edge of "camp":** with a low bar, where does it stop? Weekly summer classes (a 6-week
   Tuesday swim series), daycare summer programs, sports leagues, adult camps, family camps.
   A crisp written rule is needed for the extraction prompt even with a low bar.
8. **Max cards per provider:** Asheville Parks & Rec has 15+ programs; D5 could make each its
   own card. Fine, or group under the provider on the page?
9. **Year handling:** keep 2026 facts after 2027 replaces them (for "last year" lines and
   history)? Recommendation: store per year; show the latest.
10. **Description text:** short AI-written factual summary, or the camp's own wording
    (as the event feed does)?

---

## 11. Risks

- **Wrong registration date** → the trust rule (§1.3, §4.3), evidence per field, and a
  visible "checked on" date.
- **Timeline:** five weeks is tight for several hundred camps with good extraction.
  Discovery and extraction can't slip past mid-November.
- **Hallucinated camps or URLs** from web search → the resolve-and-mention guard (§6.1).
- **Coverage illusions:** capture-recapture gives a number, but both samples skew toward
  visible, online-marketed camps. Church VBS and small programs will be under-found.
- **Low early traffic** makes popularity numbers small (Matt chose no minimum).
- **Blocked sites:** Cloudflare / login walls (Chrome fallback); Jina blocked locally.
- **Feed flood / duplicates** (Q2).
- **Robert's expectations:** Robert offered help and raised money. The answer is free, no
  sponsors, and no data entry needed; Robert's most useful role is sharing the launch in the
  parent chats.

---

## 12. Decisions after the Codex review (settled 2026-10-28)

**Matt's answers (2026-10-28), via the decisions page:** every recommendation in the table
below was accepted **except**:

- **N6:** popularity is **"views in the last 14 days"** (not 7).
- **N13:** the camps banner runs **Nov 5 - Mar 31** each year (from launch this first
  season), and **Nov 1-2, 2026 show a banner for `/plan`** instead (separate change, due
  before Nov 1).

So: N1 Sol + web search with quote verification, no Jina · N2 revised data model · N3 pilot
first · N4 price tiers stay on one card · N5 calendar subscription built last, shipped if on
schedule by ~Nov 22 · N7 camps hidden from All events by default · N8 the written camp
rule · N9 church Facebook posts allowed for VBS, labeled and hand-checked · N10 public
opening by default · N11 ages next summer or rising grade, no conversion · N12
OpenRouteService (Matt creates the key) · N14 no date, no reminder · N15 every registration
date hand-checked, no count target · N16 short factual descriptions · scope cuts accepted.

The table below is kept as the record of what was proposed.

Codex's review (`02-codex-review.md`) said the plan is sound enough to start once the data
contract is tightened and the pre-launch work is cut down. Its code claims were checked and
hold: Top 30 has no minimum score; the cleanup cron hard-deletes non-NC events; the AI cron
skips pre-tagged events; dedup Method E merges on one shared word; the Parks & Rec scraper
stops at 120 days and drops full/waitlist rows; the ICS generator uses random UIDs;
`seed-groups.ts` deletes absent rows; `seasonBanner()` uses the current year. Those are
already fixed in the sections above. What was put to Matt:

| #   | Decision                                                                                                                                                                                                                                                                                                                        | Recommendation                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| N1  | **Extraction:** Sol + web search extracts; our own fetcher verifies every quote and drives refresh; no Jina (§2.6a-b). Codex suggested testing a Jina key, but it reviewed before the bake-off.                                                                                                                                 | Yes                                                                                   |
| N2  | **Data contract:** adopt the revised model in §5 (stable `camps`, per-year `camp_seasons`, registration milestones with audience + precision, availability separate, observations log, DB authoritative after import). More tables, but it's what keeps a correctly quoted date from being the wrong year, audience or program. | Yes                                                                                   |
| N3  | **Pilot first** (15-25 varied providers end to end by Nov 4) and the reordered timeline in §8.                                                                                                                                                                                                                                  | Yes                                                                                   |
| N4  | **Refine D5:** price tiers (resident / member / early-bird / extended care) stay on one card; split only on a different program, eligibility or attendance site. Otherwise one camp becomes four identical cards.                                                                                                               | Yes                                                                                   |
| N5  | **Subscribable calendar:** Codex says defer (2-4 days of work). Per-camp .ics and saved camps are needed anyway and cover most of it.                                                                                                                                                                                           | Keep it in v1 as the **cut line**: build it last, ship only if on schedule by ~Nov 22 |
| N6  | **Popularity window:** one number, "views in the last 7 days" (Codex), vs 7 days + all time. All-time adds little in a first season.                                                                                                                                                                                            | 7 days only                                                                           |
| N7  | **"All events" feed:** hide camp events by default and show them when the camp tag is selected, vs show them. 100+ camps share the same June Monday start dates.                                                                                                                                                                | Hide by default                                                                       |
| N8  | **Written "what counts" rule** for the extraction prompt: include finite, supervised youth programs in summer (day, overnight, half-day, evening), summer-only childcare, VBS, short clinics, pre-college. Exclude year-round classes and childcare, sports leagues, job programs, adult- or family-only retreats.              | Yes; edge cases go to review                                                          |
| N9  | **Provider-owned Facebook/Instagram posts as an official source** (matters for VBS). Our fetcher can't read those pages (login walls), so such facts need a hand check.                                                                                                                                                         | Yes for VBS, labeled "from the church's Facebook page", hand-checked                  |
| N10 | **Reminders default to the public opening;** member / returning-family / lottery milestones shown and remindable separately; no invented times.                                                                                                                                                                                 | Yes                                                                                   |
| N11 | **Eligibility:** "my kids" = age during summer 2027 or rising grade; no grade→age conversion; "fits both kids" is labeled as age/grade eligibility only (not same week or open seats).                                                                                                                                          | Yes                                                                                   |
| N12 | **Routing/geocoding provider:** HeiGIT/OpenRouteService (free key, CC-BY-SA credit) or Google Routes (billing account, storage limits). Either way Matt creates the account/key.                                                                                                                                                | HeiGIT/ORS; Google only if geocodes are poor                                          |
| N13 | **Banner window:** launch → Mar 31 this season; Nov 1 - Mar 31 each year after.                                                                                                                                                                                                                                                 | Yes                                                                                   |
| N14 | **No posted date → no reminder;** show "Opened Jan 10 last year" when known.                                                                                                                                                                                                                                                    | Yes                                                                                   |
| N15 | **Launch bar:** every registration milestone shown is hand-checked, plus a coverage report by town and type. No camp-count target.                                                                                                                                                                                              | Yes                                                                                   |
| N16 | **Descriptions:** short factual AI paraphrase of official pages, no promotional claims (Q10).                                                                                                                                                                                                                                   | Yes                                                                                   |

**Scope trims accepted from the review unless Matt objects:** no camp images, no
related-camps list and no logo badge at launch (the banner and Events-menu item stay); last
year's opening dates come from current official pages plus Wayback for a small priority set
only; no registration-platform adapters beyond WebTrac until the pilot shows a platform
repeats; a saved-camps filter is added (it's needed for the calendar feed anyway).

---

## Appendix A: sheet rows by kind (from the exa sheet)

- 74 documented 2026 schedules, 22 candidates without dates.
- VBS (7): Lakewood Church, Trinity Baptist, Trinity Episcopal, Westview Baptist,
  First Baptist Black Mountain, Newbridge Baptist, a VBS on N Fork Right Fork Road.
- Overnight (≈9): Camp Cedar Cliff, Camp Crestridge for Girls, Camp Lakey Gap, Camp Merri-Mac,
  Camp Ridgecrest for Boys, Camp Rockmont, Lutheridge, Windy Gap (Young Life), UNCA
  pre-college residential.
- Multi-row providers: YMCA (Adventure, CILT, Discovery, Explorer), UNC Asheville (athletics,
  pre-college, young writers, songwriting).

## Appendix B: camps found missing from the sheet

- From Macaroni Kid: Asheville Youth Sailing, Bricks 4 Kidz, Summit CrossFit.
- From AVLGO events: the 13 in §2.3.
- From the web-search probe (outside Buncombe): Kanuga Day Camp, Camp Tekoa,
  Waynesville Summer Basecamp, Mountain Roots (Brevard).
