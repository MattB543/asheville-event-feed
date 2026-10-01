# 03 · Presenting local news in AVL GO

Presentation / UX proposal · **v4, 2026-09-27**: revised for Matt's feedback on the v3 mockup (one page, no following, Reddit in the same row design, a simpler row and header) · v3 (2026-09-25) added **Top vs All** and **sharing** · aligned with `docs/news/decisions.md` (S12–S18, D21–D30)

**Companion mockup: `docs/news/news-mockup.html`.** Open it in a browser. It's one self-contained file.
- **Views:** the feed (`#/`), a multi-source story page (`#/s/bears`), a single-source story page (`#/s/housing`), and the Sources page with its removal request (`#/sources`). "these sources" in the feed header opens the sources modal.
- **Search:** try `bears`, `wildlife`, `dolly`, `montford traffic` or `what's happening with the police chief?`.
- **Top vs All and sharing:** the feed opens on **Top stories**, with a "+N more" line per day and a **Top | All** switch. Every row has a **Share** button (a share panel with a preview of the link card). The ribbon links show what arriving on a shared link looks like:
  - `?s=gas`: a story that isn't in Top
  - `?s=costco`: an older story
  - `?s=dolly-bear`: an old id from a merged story
- **Real:** every headline, outlet, byline, time and URL comes from the scouts' Sep 24 test runs. Only Asheville and Buncombe items are used. The events are from avlgo.com's own data, as the Top 30 stood on Sep 24.
- **Written by me as stand-ins for AI output:** all story headlines, summaries, "in the full story" lines, community paraphrases and the curator note.
- The v3 mockup was checked with headless Chromium at 375px and 1280px, light and dark: no console errors and no horizontal overflow.

---

## Matt's feedback on the v3 mockup (settled 2026-09-27) and what it changed

| Decision | What changed in this design |
|---|---|
| **No following or bookmarks in V1** (S12) | Gone from the whole plan: the ☆ on rows, "Follow story" on the story page, the Following tab, strip and rail card, follow alerts, and followed stories forcing their way into Top. |
| **One page** (S13) | `/news` is a single view with everything. No News sub-tabs, no Around town strand or tab, no `/news/around`. The Events · News switch and the Top / All toggle stay (§1, §2). |
| **Reddit posts look like every other story** (S14) | No violet anywhere. A post about an existing story still attaches to it. Any other post gets in only if it clears a bar (enough upvotes or comments, or the AI rates it important), and then it's an ordinary story row with a "Read on r/asheville ↗" button, framed as unverified. Everything else is dropped (§5). |
| **No "Developing" tag** (S15) | Not on rows, not on story pages, and no "Developing only" filter. |
| **A quieter feed header** (S16) | No source-kind legend and no topic chip row. The disclaimer reads "Headlines and summaries by us, reporting from **these sources**", and "these sources" opens a modal listing every source with links. Topics live in the filter sheet. The rail loses "How to read sources" and "Sources we read" (§2). |
| **A simpler row** (S17) | Headline first, then our summary, then one bottom row: an outlined "Read at X ↗" button, the other source chips, the topic · place tag, and the time and Share at the right. No kicker line above the headline, and no list of the other outlets' headlines on the row (§2). |
| **The end cap uses Top 30 cards** (S18) | "That's the news. Now go do something." shows the Top 30 events happening in the next 7 days, in the Top 30 card design, keeping their Top 30 ranks (§1). |

## Owner decisions (settled 2026-09-25) and what they changed

| Decision | What changed in this design |
|---|---|
| **1. `/news` is its own section**, with cross-links welcome | This was already the recommendation. **New:** how people move between the two sections. The header gets an **Events · News section switch** (§1). Events keeps its row of tabs; News is one page with none (09-27). |
| **2. Asheville + Buncombe County only** | Places are Asheville neighborhoods plus Buncombe towns and communities (§4). The Henderson County entries in `zipNames.ts` (Fletcher, Hendersonville, Mills River, Flat Rock) are excluded, and there's no Statewide or WNC filter. I rebuilt the mockup on Buncombe-only items; the statewide trout story is gone. **A WNC or statewide story appears only when its subject is Buncombe itself** (FEMA money *for Buncombe*, not for WNC generally). |
| **3. We store full text but show only our AI summaries, and link out** | The trust rule becomes **"Our words, their link"** (§6). Every headline and summary we display is ours. An outlet's own headline appears only as the label of a link to that outlet. **Every row gets a "Read at [outlet] ↗" button.** Every article on a story page gets an **"In the full story:" line**, which says what the article covers that our summary doesn't (§2, §3). |
| **4. Reddit and community posts are in scope** | There are **three kinds of source**: Reporting, Official, Community (§6). The approach is **"Attach first, then a row only above the bar"** (§5). A community post about an existing story attaches to it as "What locals are saying". Any other post becomes its own story row only if it clears the bar, in the same design as every other row (09-27). Community posts never become facts in a reported story, never move a story, and never enter its summary. |
| **5. robots.txt and site terms aren't blockers.** AVL GO is a free, open-source community platform, and any outlet that asks is taken down | No legal hedging anywhere in the design: text-first is a design choice (§2). Attribution and link-out prominence stay, because they're about respecting local journalism. **New: a small public Sources page** (`/news/sources`, `#/sources` in the mockup) lists every outlet and community source we aggregate and has a **removal-request link**. That's the takedown path. No outreach to outlets before launch; they’ll reach out if needed (D29). |
| **6. Top vs All** (S9): greatest hits by default, everything one tap away, plus topic filters and search | A **Top stories / All news** switch, remembered per visitor. Top means importance ≥ 15 of 30, at most 5 a day, at least 2. A "+N more" line per day expands in place. **Search and topic filters always cover All** (§2, "Top stories and All news"). |
| **7. Sharing is first-class** (S10) | A **Share** button on every row and story page (the native share sheet on phones, copy-link on desktop). Feed rows share `/news?s=<id>`, which opens the feed scrolled to the story and highlighted. Story pages share the permalink. The link always forces its target visible, redirects merged ids, and unfurls as a branded card (§3b). |
| *(From the pipeline brief)* **Semantic search isn't user-facing anywhere today** | /news is the site's first semantic-search surface, so the search section is rewritten (§4). Results come in two labelled groups, **"Mentions ‘x’"** and **"Related by meaning"**, and each result says why it matched. |

---

## TL;DR

- **Navigation:** a compact **Events · News** switch sits next to the logo.
  - Events keeps its tabs: All · Top 30 · Your List · Posters (unchanged).
  - News is **one page** with no sub-tabs.
  - A small warm dot on "News" means there are stories since your last visit.
  - Cross-links: related events on stories, "In the news" on event pages, and the feed's ending hands off to events.
- **Feed: "The Rundown, by day"** (unchanged).
  - Compact, text-first story rows under the events feed's own sticky day headers. Each day opens with a 3-sentence "short version" and the feed stops at a "caught up" line.
  - A story is filed under the day of its latest *development*. A second outlet re-reporting the same news, or a community thread, doesn't move it.
- **A quiet header:** title, subtitle, and one line, "✦ Headlines and summaries by us, reporting from **these sources**". "these sources" opens a modal listing every source we read, with links. Then the search bar. No legend and no topic chips; topics live in the filter sheet.
- **Top stories by default, All news one tap away.**
  - Top means importance ≥ 15 of 30, at most 5 a day, at least 2 on quiet days. Only in AVL always makes it.
  - Each day ends with "+6 more stories · public safety (2) · briefs (3)", which expands in place.
  - Search and topic filters always cover All.
- **The row:** our headline, our summary, then one bottom row: an outlined **"Read at WLOS ↗"** button, the other source chips, the topic · place tag ("Civic · Citywide"), and the time and Share at the right. Nothing above the headline, and no list of the other outlets' headlines.
- **Sharing:** a Share button on every row and story page.
  - Rows share `/news?s=<id>`, which opens the same feed scrolled to the story with a warm highlight that fades. It forces the story visible even when Top or the recipient's filters would hide it.
  - Links unfurl as an AVL GO-branded card.
- **The link out is the most visible action on every row and story.**
  - Every row leads its bottom row with the **"Read at WLOS ↗"** button.
  - Every story page leads its source list with a featured card and a full-width **"Read the full story at Asheville Watchdog ↗"** button.
  - Our summaries are capped at 80 words, carry no quotes, and are **deliberately incomplete**: an "In the full story:" line lists what only the article has.
- **Three kinds of source, one row design:**
  - **Reporting:** neutral chip.
  - **Official:** green chip with a landmark icon. Always attributed ("the City says").
  - **Community:** neutral `r/asheville` chip. The difference is in the words: attributive framing and "not verified".
- **Community content:** attach to a story first. Otherwise a post gets its own ordinary row only if it clears the bar (enough upvotes or comments, or the AI rates it important). Everything else is dropped.
  - Framed in our own attributive words ("Locals ask…"), with a link to the thread.
  - No usernames, no quotes, and no claims about named people.
  - Never in the short version, Top or the email.
- **Search:** two labelled result groups, "Mentions" and "Related by meaning".
  - Each result gets a "why it matched" line.
  - Places and topics in a query turn into one-tap filter chips.
  - Ambiguous names get "did you mean" chips. "Dolly" means the bear on one story and Dolly Parton Day on another.
  - Questions route to Ask AI.
- **Sources page:** `/news/sources` lists every outlet and community source we aggregate, with a removal-request link. It's the takedown path, and it's linked from the sources modal, the footer and every story page.
- **The end cap:** "That's the news. Now go do something." shows the Top 30 events happening in the next 7 days, as Top 30 cards with their ranks.
- **Tone:** local-relevance gate, crime collapsed to one daily "Public safety" line, press-release filler collapsed to "Briefs", and one "Only in AVL" story a day. The page states the cadence honestly ("checked every 3 hours").

---

## 0. What I calibrated against

I read the events-side code closely. The Chrome extension wasn't connected, so I couldn't view the live site. This is the site's grammar, and the news design reuses it on purpose:

| Pattern | Where | Reuse in news |
|---|---|---|
| Header pill tabs: All · Top 30 · Your List · Posters | `components/Header.tsx`, `EventTabSwitcher.tsx` | Unchanged under Events. News is one page and has none (§1) |
| Page chrome: `bg-gray-50 / dark:bg-gray-950`, `max-w-7xl`, white list container `sm:rounded-lg sm:border sm:shadow-sm`, full-bleed mobile rows with `px-3` and `border-b` | `EventPageLayout.tsx`, `EventFeed.tsx` | Same container and divider rhythm |
| **Sticky day headers** `text-xl font-bold sticky top-0 bg-white` | `EventFeed.tsx:2108` | The spine of the news feed |
| Brand-600 titles, small `px-2 py-0.5 rounded text-xs` badges | `EventCard.tsx` | Outlet chips and the topic · place tag. The end cap reuses the whole Top 30 card |
| FilterBar (search, filter count, share, Ask AI), ActiveFilters include/exclude chips | `FilterBar.tsx`, `ActiveFilters.tsx`, `ui/FilterChip.tsx` | Same bar and chips |
| "Hide host" synced as `blockedHosts` | `EventCard.tsx`, `user_preferences` | "Hide this outlet" (`newsBlockedOutlets`) |
| Posters' Today marker (hairlines + 11px uppercase `tracking-[0.18em]`) | `PosterWall.tsx:279` | "Caught up · last visit Tue 8:12 PM" |
| Sparkles icon means AI | Ask AI, "See similar events" | Marks every piece of AI text |
| Warm `#e8825f` (poster focus rings only) | `globals.css` | "New since your visit" dots |
| Fraunces `.font-display`, used sparingly | home hero, poster lightbox | **News headlines and the story H1.** A "paper" voice that tells news apart from events at a glance |
| "Summary first, then *View original*" | EventCard, EventContent | **Can't carry over.** News has no "original" to reveal (decision 3). The equivalent is the link out, which is why it has to be so prominent |
| Voice: "Built for Asheville, not for profit." · "No ads, ever." · "Asheville Weird" | home, Top 30 | Feed header and end-of-feed copy |

Aside: `app/layout.tsx` puts `inter.className` on `<body>`, which overrides the DM Sans that `globals.css` imports. The site effectively renders in Inter.

**Constraints on the news side:**

- **Scrapes run every 3h** (D9). The feed reads as a digest, not a wire service, so nothing is labelled "live" or "breaking". For emergencies, point to official channels.
- **TV feeds are mostly noise for a Buncombe-only feed.** Fox Carolina's RSS on Sep 24: 1 of 20 items about the Asheville area, 6 of 20 crime.
- **Government feeds mix useful and promotional.** The City and County post real news (the new police chief, council recaps, grants) next to promotions and tips. That's what "Briefs" is for.
- **Reddit:** the community scout's prototype keeps about 17 posts a day after filtering. Its RSS has **no score or comment counts**; engagement would need an OAuth app or Scry (D8). The inclusion bar (§5) has two halves, engagement or the AI's importance call, so it still works on the AI half alone until counts arrive.

---

## 1. Information architecture

### Section structure (settled: news is its own section)

| Route | What |
|---|---|
| `/news` | **The one news page.** The feed, last 3 days by default, with "Load earlier days". Everything is here: reporting, official sources, and community posts that cleared the bar |
| `/news?s=<storyId>` | **Shared-link deep link** (§3b): opens the feed at the story's day, scrolled and highlighted |
| `/news?view=all` | All news instead of the default Top stories (overrides the saved choice, like `/posters?view=all`) |
| `/news?topic=…&place=montford&q=…&outlet=-WLOS` | Shareable filtered views, same pattern as `/events?tagsInclude=…` |
| `/news/[slug]` | Story page. `slug = {headline-kebab}-{shortId}`, looked up by shortId. **Stories get retitled as they develop**, so a stale slug 308-redirects to the canonical one. Events currently ignore a mismatched slug (`app/events/[slug]/page.tsx:112`) |
| `/news/sources` | Every source we read: its kind (Reporting / Official / Community), what we use, and subscribe or donate links. It also carries a **publisher removal contact** ("Want your outlet or post removed? hi@avlgo.com"). A takedown is a per-source kill switch: it purges stored text and removes that source's links and summaries from every story |
| `/api/export/news.json`, `/news/rss.xml` | Open data, like events |

### Moving between Events and News

| Option | Verdict |
|---|---|
| (a) News as a fifth pill in today's tab row | Cheapest, but it mixes levels: the other four pills are all *views of events*, and News is a different kind of content. At 375px the row is also already shared with the "Open-sourced by Matt" credit |
| **(b) A section switch, Events · News** | **Recommended.** Two clear levels. Events keeps its tab row; News is one page, so its second row stays empty (09-27). It scales if another section is added later (a Groups directory is in the works per memory). It fits the header's existing two-row mobile layout without adding height |
| (c) A mobile bottom tab bar | App-like, but it's a new pattern for the site, it covers content, and it competes with the poster lightbox and the filter sheets |

```
Mobile header (375px)                          Desktop header (≥ lg)
┌────────────────────────────────────────┐     ┌────────────────────────────────────────────────────────────────┐
│ AVL GO  [Events|News•]     [+] [◐] [MB]│     │ AVL GO  [Events|News•]                             … [+][◐][MB]│
└────────────────────────────────────────┘     └────────────────────────────────────────────────────────────────┘
                                                 On /events the switch is followed by: All Events · Top 30 · Your List · Posters
```

- **The switch** is a segmented control (`bg-gray-100` track, white active thumb), styled like Top 30's category selector. It remembers your last Events tab (localStorage), so switching back returns you where you were.
- **The News dot** is the warm `#e8825f` dot, shown when there are stories since your last visit. It's the only "unread" signal on the Events side. There's no count badge and no pulsing.
- **Home page `/`:** the "Jump into an event list" grid gains a News card. A "Today in Asheville" module (3 stories, 3 events, any civic alert) comes in phase 3.

### Bridges between the sections (instead of blending)

1. **Story → events: "Go in person."** Related events come from embedding similarity above a threshold, plus explicit links. Real pairs from today's data:
   - The Dolly Parton Day story links to the Grey Eagle's "Let Her Fly" tribute (tonight) and Jack of the Wood's Dolly Day show (Friday).
   - The council's river-corridor story links to the City's French Broad Riverfront drop-in session (Saturday).
2. **Event → news: "In the news."** A one-line strip on `/events/[slug]` when a story mentions the event, venue or organizer.
3. **Feed end → events:** "That's the news. Now go do something." The **Top 30 events happening in the next 7 days**, drawn as Top 30 cards (image, "6. Title", date, venue, price and tag badges, the AI summary) and keeping their Top 30 rank numbers, so a week can read 6, 7, 8, 9, 10, 17, 18, 19. A "See the full Top 30 →" link follows.
   - Mockup, as the Top 30 stood on Thu Sep 24: #6 Tommy Stinson's living-room show (Thu), #7 Gov't Mule and Ziggy Marley (Fri), #8 Blue Ridge Pride Festival (Fri), #9 Houndmouth (Sat), #10 Hot Fix Sideshow (Wed), #17 the Preservation Society gala (Sat), #18 Rising Appalachia's Helene anniversary show (Sat), #19 Geese (Wed).
4. **Community → civic events: "Ask them in person."** The r/asheville thread asking where council candidates stand on Flock cameras clears the bar as its own story, and that story's "Go in person" links to the real "Asheville City Council and Mayoral Candidate Forum" event row (Sat Oct 3).
5. **Civic meetings become events.** Council and commission agendas become event rows, so "Next: Council meets Oct 13" is a real row with the Calendar button.
   - **Check the dates first.** The prod export has "Asheville City Council Regular Meeting" on **Thu Sep 24** and **Thu Oct 22**, from Mountain Xpress's community calendar. BPR reports Council met **Tue Sep 22** and next meets **Tue Oct 13**, and the scout's `avlcouncilagenda` source has draft agendas for Oct 13, Oct 27 and Nov 10. Take meeting dates from the City's agenda source and Buncombe's CivicClerk, not a third-party calendar.

---

## 2. The feed: four concepts, and the recommendation

Legend for the wireframes (roughly a 375px phone):
`[Read at X ↗]` = the outlined link-out button · `⌂` = official source · `•` = new since last visit · `✦` = AI-written · `[$]` = paywalled · `[⇪]` = Share

### Concept A: The Rundown (clustered headlines, Techmeme-style, ranked)

A single ranked list. Each row is a cluster: our headline, then the other outlets' links (their headlines used as link labels).

```
│ TOP STORIES             last checked 6:10PM│
│ Jackie Stepp named Asheville's permanent   │
│ police chief                               │
│ [Read at WLOS ↗]  ⌂City  WSPA · 3 sources  │
│   WLOS · ‹their headline as link label› ↗  │
│   WSPA · ‹their headline as link label› ↗  │
│ Buncombe challenges its share of Helene    │
│ housing money                              │
│ [Read at Watchdog ↗] · 1 source            │
```
- **Good at:** scanning fast and sending traffic out.
- **Weak at:** it has no "when" and no "done". The ranking is opaque. Long-running stories either squat at the top or vanish.

### Concept B: Brief cards (Smart Brevity)

A kicker, headline, "why it matters", bullets, "what's next" and a source row, with an optional image.

```
│ ┌────────────────────────────────────────┐ │
│ │ CIVIC · NORTH ASHEVILLE                │ │
│ │ Residents press City Council on bears  │ │
│ │ ✦ Why it matters: ‹one line›           │ │
│ │ • ‹fact› • ‹fact›                      │ │
│ │ What's next: Council, Oct 13  [+ Cal]  │ │
│ │ [Read at BPR ↗]  ACT[$]  ⌂City         │ │
│ └────────────────────────────────────────┘ │
```
- **Good at:** understanding a story without clicking.
- **Weak at:** under decision 3 almost everything on screen is our prose. It's the format most likely to *replace* the article, which is exactly what decision 3 wants to avoid. Cards are also tall on phones. **I use its structure on the story page, not in the feed.**

### Concept C: The Morning Edition (a finite daily issue)

A dated issue: a masthead, "The short version", fixed sections, and "That's the edition."

```
│          The Asheville Rundown             │
│          Thursday, September 24            │
│  ✦ THE SHORT VERSION  • ¹ • ² • ³          │
│  TOP OF THE NEWS  1 ‹row›  2 ‹row›         │
│  CITY HALL · HELENE · ONLY IN AVL          │
│  GO DO SOMETHING  ‹3 events›               │
│  ──────── That's the edition ────────      │
```
- **Good at:** it's calm and finite, it doubles as the email, and it has a strong identity.
- **Weak at:** stale by 4 PM. Stories that develop across days get split. Fixed sections look empty on slow days.

### Concept D: Storylines (a board of ongoing sagas)

Cards for ongoing stories, each with a mini timeline.

```
│ Bears in the neighborhoods                 │
│ ●──────●──────────●· · · ○ Oct 13          │
│ Latest: residents asked Council to…        │
│ Helene recovery money                      │
│ ●─●──●───●──●─────● · Buncombe challenges… │
```
- **Good at:** civic memory, and tracking a story over weeks.
- **Weak at:** it can't answer "what happened today?". It also depends on clustering being right for weeks at a time.

### Comparison

| | A | B | C | D | **Rundown by day** |
|---|---|---|---|---|---|
| "What happened today?" in 20s | good | slow | great | poor | **great** |
| Risk of replacing the article (decision 3) | low | **high** | medium | medium | **low** |
| Traffic sent to outlets | high | low | medium | medium | **high** |
| Finite / anti-doomscroll | no | no | yes | n/a | **yes, per day** |
| Fits existing site grammar | ok | new | new | new | **native** |
| Build cost | low | medium | medium | high | **low–medium** |

### Recommendation: "The Rundown, by day" (A's rows, C's frame)

It's the only option that answers "what's happened since I looked?", stops when it's done, keeps our prose to one line per story, and makes the link out the main action on every row. The sticky day headers are the events feed's own. The Edition becomes the email, Storylines stays a later-phase idea (§8), and Brief cards become the story page's structure.

#### Filing rules (what moves a story)

- A story sits under the day of its latest **development**: a new fact, decision, filing or event. That comes from reporting or an official source.
- **Extra coverage of a development we already have doesn't move the story.** For example, 828 News Now wrote up the bear meeting on Thursday, two days after it happened. The row just gains a source chip (or its "+N" goes up).
- **Community posts never move a story.** The injured-cub thread attaches to the bear story without re-filing it.
- **An official release that confirms earlier reporting doesn't move it either.** Black Mountain News reported Swannanoa's $786,000 sidewalk grant on Sep 21; the County's own release on Sep 24 adds a green chip and nothing more.

#### Feed header

- **Title and switch:** "Asheville news", with the Top | All switch and the Email button on the right.
- **Subtitle:** "Asheville and Buncombe County, from local newsrooms and public agencies. Checked every 3 hours, last at 6:10 PM."
- **One disclaimer line:** "✦ Headlines and summaries by us, reporting from **these sources**." "these sources" is a link that opens the **sources modal**:
  - Every source we pull from, grouped as **Newsrooms** (BPR, Asheville Watchdog, WLOS, Mountain Xpress, 828newsNOW, FOX Carolina, Black Mountain News, Carolina Public Press, The Urban News, The Beacon Tribune, The Blue Banner, WNC Business, plus other outlets' headlines via Google News, such as the Citizen Times), **Government & institutions** (City of Asheville and its Council agendas, Buncombe County and its Commission agendas, the towns of Black Mountain, Weaverville, Montreat and Biltmore Forest, Buncombe County Schools, Asheville Regional Airport, Mission Health, UNC Asheville) and **Community** (r/asheville, r/BlackMountain and r/wnc, only posts that clear the bar; the Wake Up, Asheville! podcast). The groups follow `kind` in `lib/news/sources/*.ts`.
  - Each name links to that source's site, with a one-line note on what we use from it.
  - It ends with the takedown line and a link to `/news/sources`.
- **Then the search bar** (search, filters, share/export, Ask AI). **No legend and no topic chip row.** Topics live in the filter sheet (§4).

#### Mobile wireframe

```
┌────────────────────────────────────────────┐
│ AVL GO  [Events|News•]         [+] [◐] [MB]│
├────────────────────────────────────────────┤
│ Asheville news            [Top|All]  [✉]   │
│ Asheville and Buncombe County, from local  │
│ newsrooms and public agencies. Checked     │
│ every 3 hours, last at 6:10 PM.            │
│ ✦ Headlines and summaries by us, reporting │
│   from these sources                       │ ← "these sources" opens the sources modal
│ [⌕ Search news…          ] [⚟] [⇪] [✦]    │ ← topics live behind ⚟
│┌──────────────────────────────────────────┐│
││ Today, Sep 24            6 of 12 stories ││ ← sticky
│├──────────────────────────────────────────┤│
││ ✦ THE SHORT VERSION · as of 6:10 PM      ││
││ Asheville made Jackie Stepp its permanent││
││ police chief [City][WLOS]. Buncombe is   ││
││ challenging its share of Helene housing  ││
││ money [Watchdog]. And the schools have a ││
││ new superintendent [FOX].                ││
│├──────────────────────────────────────────┤│
││ Jackie Stepp named Asheville's permanent ││ ← Fraunces, OUR headline, first thing
││ police chief                             ││
││ The interim chief got the job after a    ││ ← OUR dek (≤30 words)
││ national search.                         ││
││ [Read at WLOS ↗] WSPA ⌂City r/asheville  ││ ← outlined button, then source chips,
││ Civic · Citywide           • 5h   [⇪]   ││   topic · place tag, time and Share
│├──────────────────────────────────────────┤│
││ ‹more rows›                              ││
│├──────────────────────────────────────────┤│
││ Dolly Parton Day is Friday, with         ││
││ tributes around town                     ││
││ ‹our dek›                                ││
││ [Read at Citizen Times [$] ↗] r/asheville││
││ Arts · Citywide  Only in AVL   5h  [⇪]  ││ ← "Only in AVL" is a neutral tag
│├──────────────────────────────────────────┤│
││ PUBLIC SAFETY · 2 reports             ▾  ││
││ BRIEFS · County: free OTC medicine · …   ││
│├──────────────────────────────────────────┤│
││ ⌄ +6 more stories · public safety (2) ·  ││
││   briefs (3)                   All news ›││
│└──────────────────────────────────────────┘│
│ ───── CAUGHT UP · LAST VISIT TUE 8:12 PM ──│
│   ‹Wednesday, Tuesday…›  [Load earlier days]│
│ That's the news. Now go do something.      │
│ ┌────────────────────────────────────────┐ │
│ │ [ image ]                              │ │ ← Top 30 card, rank kept
│ │ 6. Tommy Stinson (The Replacements)    │ │
│ │ Living Room Show                       │ │
│ │ ‹AI summary, 2 lines›                  │ │
│ │ [Today · 7:00 PM] [$36] [Live Music]   │ │
│ └────────────────────────────────────────┘ │
│  ‹7. · 8. · 9. · 10. · 17. · 18. · 19.›    │
│  See the full Top 30 →                     │
└────────────────────────────────────────────┘
```

A community post that clears the bar and matches no story (§5) is an ordinary row in this list, in the same design: our attributive headline and dek, `[Read on r/asheville ↗]`, and its topic · place tag. It shows in All news and behind "+N more", not in Top.

**Desktop (≥ lg):** a reading column on the left and a 320px right rail.
- **Rail contents:** Go in person (civic) only. (The Following card, the "How to read sources" legend and "Sources we read" are gone; the sources modal replaces the last two.)
- **Rows are the same at every width:** source chips plus "+N", never the other outlets' headlines. Those are on the story page.

#### Story row anatomy

| Part | Rule |
|---|---|
| Headline | **Ours**, always, and **the first thing on the row**. Neutral, Fraunces 600, 18–19.5px. Brand-600 on hover. It goes to the story page |
| Dek | **Ours**, at most 30 words, 2-line clamp. Describes the *latest development* |
| Next | Only when the story has a future date, between the dek and the bottom row: `◷ Next: Council meets · Tue, Oct 13, 5 PM [Add]` |
| **Bottom row** | One line that wraps on phones, in this order: the Read button, the other source chips, the topic · place tag, any status tag, then the time and Share at the right |
| **Read button** | **An outlined `Read at WLOS ↗` button** (brand border and text, no fill), first in the bottom row. It links straight to the lead article. The lead is the most complete *original* reporting (ties go to the free outlet). A paywalled lead shows a lock. A community-only story reads `Read on r/asheville ↗` |
| Other sources | Chips: neutral for reporting and community (`r/asheville`), green `⌂` for official. At most 2, then `+N`. **No expandable list of the other outlets' headlines** and no "N sources ▾"; the story page has the full list. An attached community post is one more neutral chip |
| Topic · place | A neutral tag, `Civic · Citywide`. It used to be the kicker above the headline. **Short topic labels** (Civic, Outdoors, Schools, Growth, Helene) keep it compact at 375px |
| Status tags | `Updated` if the row was re-filed by a development you haven't seen, and `Only in AVL`. Both neutral, in the same row. **No "Developing" tag** (09-27) |
| Time | "5h", "1d", at the right. A warm 6px dot sits beside it if the story is new or has a development since `newsLastVisitAt` |
| Share | Icon button at the far right (§3b) |
| ⋮ menu | Hide this story · Hide [outlet] · Flag an error (not drawn in the mockup) |

#### Special rows

- **The short version.** It heads any day with at least 3 stories, is labelled ✦, and shows an "as of" time. Each clause links to its story and every claim carries a citation chip. **Reporting and official sources only; never community.**
- **Only in AVL.** At most one a day, near the end of the day: the delightful or weird. It's an ordinary row carrying an "Only in AVL" tag. Today it's Dolly Parton Day, with two real tribute shows.
- **Public safety.** One collapsed row: `PUBLIC SAFETY · 2 reports ▾`. Expanded, it shows one-line paraphrases, each with an outlet link: "Firefighters respond to a fire at the former Smoky Park Supper Club in the River Arts District · WLOS ↗". No names, mugshots or images. A single incident leads the feed only when it has a civic angle.
- **Briefs.** One row for promotions, tips and routine announcements, using the official titles as link labels. County: free OTC medicine; elections staff certified. City: build an emergency kit.
- **Community-only stories aren't a special row.** They use the ordinary row (§5).
- **Caught-up marker.** Posters' Today-marker style. It advances only after about 10 seconds on the page, or when you leave it.
- **Quiet day:** "Quiet day. Nothing new since this morning." Never pad.
- **Filtered to nothing:** the Top 30 empty-state copy.

### Top stories and All news (owner requirement 6)

Most people want the greatest hits, so **Top stories is the default view**. **All news** is one tap away.

```
┌────────────────────────────────────────────┐
│ Asheville news          [Top|All]   [✉]    │ ← segmented control, same look as Top 30's
│ …subtitle, sources line, search…           │   Score/Date and the posters' Upcoming/All
│┌──────────────────────────────────────────┐│
││ Today, Sep 24            6 of 12 stories ││ ← the count says what Top is hiding
│├──────────────────────────────────────────┤│
││ ✦ THE SHORT VERSION (summarizes Top)     ││
││ ‹5 top stories, by importance›           ││
││ ‹Only in AVL: its own slot›              ││
│├──────────────────────────────────────────┤│
││ ⌄ +6 more stories · public safety (2) ·  ││ ← expands this day in place
││   briefs (3)                   All news ›││ ← or switches the whole feed to All
│└──────────────────────────────────────────┘│
│┌──────────────────────────────────────────┐│
││ Wednesday, Sep 23         2 of 4 stories ││
││ ‹2 rows›  ⌄ +2 more stories · …          ││
```

**What qualifies as Top, in UI terms:**
- **Score.** Each story's `news_score` uses the same 0–30 scale as event scores; the ranking itself is design-ai's (02 §8.3–8.5). Top is a score of **≥ 15**, the events "quality" tier.
- **Stored, not computed at render time.** About 1 in 5 stories sits right at 15, so a live threshold would make rows flicker in and out of Top between scrapes. The pipeline stores Top membership per filing day (`top_day`, `top_rank`, `top_since`, `top_reason`) and damps it:
  - a story leaves Top only when it falls below 13;
  - a newcomer needs a 2-point margin to displace a story already in Top;
  - importance moves at most ±1 per update;
  - past days are frozen.
  - The UI reads `WHERE top_day = D ORDER BY top_rank`, and adds the Only in AVL slot itself.
  - Calibration on real Sep 18–24 data: typical days have 3–4 stories at 15 or above (38–50%). The busiest day (Sep 24) has 8, capped to 5.
- **Per-day cap of 5,** by importance. A busy day never bloats.
- **Quiet-day floor of 2.** If fewer than 2 stories reach 15, top up to 2 with the day's best stories scoring ≥ 8, so a quiet day still shows something. Tuesday in the mockup has one story in total, and it shows.
- **Always in Top:** the day's one **Only in AVL** story, which has its own slot outside the 5.
- **Never in Top:**
  - the Public safety and Briefs rows. They appear only as counts on the "+N more" line.
  - community-only stories (§5). Their importance is capped at 14, so they show in All news and behind "+N more" (D25c).
- **Mockup, with real Sep 24 data:**
  - Thursday has 12 stories; Top shows 5 plus Only in AVL, with "+6 more".
  - Wednesday has 4; Top shows 2, with "+2 more".
  - Tuesday has 1; Top shows 1.
- **The short version** summarizes Top stories, and the email digest uses the same set.

**Showing what Top hides:**
- Every day with hidden items ends in a "+N more" line: `⌄ +6 more stories · public safety (2) · briefs (3)`.
- Tapping it expands **that day in place**. Your scroll position stays put, and a "Show only top stories" link folds it back. The "All news ›" link on the same line switches the whole feed.
- The day header always shows "6 of 12 stories" in Top.
- New hidden stories are counted in the line ("+6 more stories · 4 new"), so nothing new is silently buried.

**Topic filters and search always cover All.** Top is only the default *browse* view.
- A topic, place, outlet or source-type filter, or any search, runs against all news.
- While one is active, the switch shows **All** selected and Top greyed out, with the note "Topic and place filters always cover all news, not just Top stories."
- Clearing them returns you to your saved view.
- Search results can carry a small "Top" marker on stories that made Top that day.

**How it fits the rest:**
- **Rundown by day:** Top/All applies within each day. The day headers, caught-up marker, "since last visit" dots and "Load earlier days" all work the same in both views.
- **Story pages and related stories** aren't affected.

**Remembered per visitor, like the event filters:**
- localStorage `newsView` (`top` by default), synced to `user_preferences.filterSettings.newsView` when signed in.
- `?view=all` in the URL overrides it for saved or shared links, the same way `/posters?view=all` works.
- Expanded days last only for the session.


---

## 3. The story page (`/news/[slug]`)

**The order is the design.** Our short summary comes first, then *immediately* the reporting, led by one featured card with the biggest button on the page. Everything else we add comes after the outlets.

```
┌────────────────────────────────────────────┐
│ ← News              CIVIC · NORTH ASHEVILLE│
│ Updated Wed 1:23 PM                        │
│ Residents press City Council to act on     │ ← OUR headline, Fraunces 28–36px
│ bears                                      │
│ 4 reports from 3 newsrooms · 4 official    │
│ documents · 1 community post               │
│ [⇪ Share] [⚑]                              │
│┌──────────────────────────────────────────┐│
││ ✦ SUMMARY BY AVL GO                      ││ ← tinted box, ≤80 words
││ Three North Asheville residents asked    ││
││ Council on Tuesday to do more about      ││
││ bears… [BPR][⌂City] It follows a bear…   ││
││ Where · Who · Numbers · Next [Add]       ││
││ ✦ Written by AI from 8 sources. It's a   ││
││ summary, not the story.   v2 · Wed 4:10PM││
│└──────────────────────────────────────────┘│
│ READ THE FULL STORY                        │
│ ┌────────────────────────────────────────┐ │ ← featured lead card
│ │ BPR  Blue Ridge Public Radio  Wed 1:23PM│ │
│ │ Asheville residents tell City Council  │ │ ← THEIR headline, as the link label
│ │ to do more about bear issues           │ │
│ │ Mark Barrett                           │ │
│ │ 📖 In the full story: what each resident│ │ ← OURS: what it covers, not the facts
│ │ proposed, the state's count of homes   │ │
│ │ Dolly entered, and a separate cliff    │ │
│ │ item on Azalea Road.                   │ │
│ │ [   Read the full story at BPR ↗    ]  │ │ ← filled, full width
│ └────────────────────────────────────────┘ │
│ MORE REPORTING                             │
│  828 News Now · Thu · ‹their headline›  ↗  │
│  Citizen Times [$] · Tue · ‹headline›   ↗  │
│  BPR · Sep 16 · ‹headline›              ↗  │
│ OFFICIAL SOURCES (green)                   │
│  ⌂ City recap · ⌂ NCWRC release · ⌂ County │
│  attachment · ⌂ Council video           ↗  │
│ HOW IT DEVELOPED  ● Aug 18 ● Sep 15 ● Sep 22│
│                   ○ Oct 13 (upcoming) [Add]│
│ GO IN PERSON  ‹civic event rows›           │
│ WHAT LOCALS ARE SAYING (neutral box)       │
│  ✦ Summary of community posts, unverified: │
│  A resident reports an injured bear cub    │
│  near lower Town Mountain. r/asheville ↗   │
│ RELATED STORIES · PEOPLE, PLACES, GROUPS   │
│ How this page was made · Support BPR ↗ …   │
└────────────────────────────────────────────┘
```

**Rules:**

- **Summary.**
  - At most 80 words, and at most 45 for a single-article story (D13). Facts only, no quotes. Every sentence carries citation chips.
  - At most about 3 facts from any single article, and we never mirror an article's structure.
  - It answers *what happened*. The **why and how** stay in the articles.
  - Label: "✦ Summary by AVL GO". Footer: "Written by AI from N sources. It's a summary, not the story."
- **Lead card ("Read the full story").**
  - One featured article with **its headline as the link label**, byline and date.
  - An **"In the full story:" line**: at most 25 words describing *what the article contains* that the summary doesn't (reactions, background, a document, a second item) without stating those facts.
  - A full-width filled button: "Read the full story at BPR ↗".
  - This line is only possible because we read the full text internally. For **paywalled** articles we only have the public dek, so the line becomes "Subscriber story: we've only seen its public summary."
- **More reporting.** A compact list: outlet, date, their headline as the link label, a lock if paywalled, and a smaller "In the full story" line when we have one.
- **Official sources.** A green list of documents (agendas, releases, PDFs, video). Summaries attribute them ("the City says").
- **How it developed.** Timeline nodes cite their sources. Future nodes (from agendas) get the Calendar menu reused from `EventContent`. Outlet corrections appear as nodes.
- **Go in person.** 2–4 events in EventCard's minimized-row format. Civic meetings come first. **Match by embedding with a threshold, never by keyword**:
  - "Bear" in today's export matches five Bear's Smokehouse BBQ events.
  - "Flock" matches Flocktoberfest, a Pisgah Brewing concert.
- **What locals are saying** (§5). Only when community posts are attached. A neutral box, labelled "Community posts · not verified", *below* the reporting, official sources, timeline and events.
- **Related stories, then entity chips.** Each chip runs a search.
- **Single-source story** (e.g. the Asheville Watchdog housing story, `#/s/housing` in the mockup):
  - Same layout. The summary box says "✦ Summary by AVL GO of Asheville Watchdog's reporting", and the lead card is the only card.
  - The meta line puts the outlet and byline right under the H1: "Asheville Watchdog · Dan DeWitt · Thu 3:58 PM". Credit is visible before the reader scrolls.
- **Community-only story** (an r/asheville post that cleared the bar, §5):
  - Same layout. The summary box says "✦ Summary by AVL GO of an r/asheville post · not verified", and every sentence is attributive ("Locals ask…").
  - The lead card links the thread: "Read the thread on r/asheville ↗". There's no "In the full story" line, and never the post's title, body or username.
  - "Go in person" still applies: the Flock-camera thread links to the candidate forum.
- **"How this page was made":** "AVL GO doesn't do original reporting. We read the full text of free articles so our summaries are accurate, and we never republish it. Paywalled articles contribute only their public summary." Then "Flag an error", and a **Support [outlet] ↗** button for every newsroom cited.
- **SEO:** index the page, emit `NewsArticle` JSON-LD with `isBasedOn` pointing at each source URL, and set a canonical URL.

---

## 3b. Sharing (owner requirement 7)

People share local news with friends constantly. A shared link should open **the same page the sender was looking at**, scrolled to the story and briefly highlighted.

### Buttons, and which link each one produces

| Where | Button | Link it produces |
|---|---|---|
| Feed row | **Share** (icon + label on sm+, icon only on phones), at the end of the source line | **Feed deep link:** `https://avlgo.com/news?s=<storyId>`. It opens the feed at that story's day, scrolled and highlighted. This is Matt's "same page + scroll + highlight" |
| Story page | Share icon in the action row (next to Flag an error) | **Canonical permalink:** `https://avlgo.com/news/<slug>-<shortId>` |

- **Community posts have no share link of their own.** A post attached to a story is shared through its story; a post that cleared the bar on its own *is* a story, so it gets the row's Share button like any other. There's no `?c=` parameter.

- **Behavior:**
  - On touch devices with `navigator.share` (`(pointer: coarse)`), the button opens the **native share sheet** with `{title: our headline, text: our dek, url}`.
  - Everywhere else it **copies the link** and shows the "Link copied" toast. A small panel shows the link, a "Copy the story-page link instead" (or feed link) option, and a preview of how it will unfurl.
  - The site already does copy-link with a "Copied!" tooltip on events (`EventCard`, `EventContent`), so this follows the same idea.
- **Links stay clean.** No tracking parameters in what people paste. Count shares with a client-side analytics event if needed.

### Arriving on `?s=`: reusing the poster deep-link pattern

`/posters?p={extractionId}` already works this way (`app/posters/page.tsx`, `components/posters/PosterWall.tsx`), and `?s=` copies it:
- **One query parameter** identifies the target. The server reads it, and if the target is outside the loaded window it **pulls it into the page** (posters: "pulled in on top of the newest 30").
- **The deep link owns the landing position.** The "caught up" marker and any scroll restoration are skipped for that load (posters: the `deepLinked` ref suppresses the today-marker scroll). News rows are text-only with no images to decode, so the target doesn't move after landing. The poster wall reserves image dimensions for the same reason.
- **History:**
  - The `?s=` stays in the URL, so a reload lands again.
  - As soon as the reader changes the view, a filter or the search, or navigates within News, it's removed with `history.replaceState`. That edits the entry in place, the same way the poster dialog's close does, so Back never bounces the reader back onto the highlight.
- **Links that differ only by search params** are plain `<a>` tags, not `<Link>`. That's the posters page's documented reason: a soft navigation would reuse the cached payload.
- **Story pages link back into the feed** with `/news?s=<id>` ("See it in the feed"), the same way poster events link back with `?p=`.

**The highlight:**
- The row scrolls to the vertical center.
- An overlay adds a 2px warm (`#e8825f`) outline and a 12% warm tint, holds for about 1.2s, then fades by about 4s.
- A **"Shared with you"** pill stays on the row for the session.
- With `prefers-reduced-motion` there's no animation: the outline stays still and clears on the first tap, key press or scroll.
- It's an overlay, so it doesn't depend on the row's background.

```
│┌──────────────────────────────────────────┐│
││ Wednesday, Sep 23          3 of 4 stories ││
│├──────────────────────────────────────────┤│
││ ‹Top story›                              ││
│┢━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┪│ ← warm outline + tint, fades after ~3s
│┃ (↗ SHARED WITH YOU)                      ┃│
│┃ Asheville-area gas averages $4.10 a     ┃│
│┃ gallon, GasBuddy says                   ┃│
│┃ ‹our dek›                                ┃│
│┃ [Read at WLOS ↗] Business · Countywide  ┃│
│┃                            1d  [↗ Share]┃│
│┃ It isn't in Top stories, so it's shown  ┃│ ← why it's visible, in plain words
│┃ here because it was shared with you.    ┃│
│┡━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┩│
││ ⌄ +1 more story · public safety (2) …    ││
```

### Edge cases (the deep link always shows its target, and never changes saved settings)

| Case | What the recipient sees |
|---|---|
| Their view is **Top** and the story isn't Top | The story appears in its day at its importance position, with the note "It isn't in Top stories, so it's shown here because it was shared with you." The day's "+N more" count leaves it out. Their Top preference is untouched |
| It's **hidden by their saved filters** (topic, place, outlet, source type, a hidden story or a blocked outlet) | It's shown anyway, with "Your filters hide it, so it's shown here because it was shared with you" and a **Clear filters** button. Their filters stay saved |
| It's a **community-only story** and they've turned Community off | Same as any filtered-out story: shown, with the note and **Clear filters** |
| It's **older than the loaded days** | The server pulls it in on top in a "Shared with you" section (the posters pattern). "Load earlier days" still works below it |
| The story was **merged** into another | Old ids are kept in a `story_redirects (old_id → new_id)` table, and `/news?s=<old>` 308-redirects to `?s=<new>`. The row notes that it was combined. **The pipeline must record this**: the pipeline brief found events dedup keeps no link from a removed row to its winner |
| The story was **removed** (takedown, hidden) | The feed opens normally, with the toast "That story isn't available anymore". Its story page returns **410** with a short "no longer available" page (`state='hidden'` + reason) |
| The **headline changed** since it was shared | The link uses the id, so it still lands, and the row shows the current headline. The unfurl the recipient saw may show the old one, because platforms cache it; the image URL includes the summary version, so new shares refresh it |
| **Story-page link with a stale slug** | 308 to the canonical slug (§1) |
| **No JavaScript, or a crawler** | The server renders the target's day with the row marked. The scroll and highlight are progressive enhancement |

### Link previews (iMessage, WhatsApp, Slack)

```
┌──────────────────────────────────────────┐  og:image, 1200×630 PNG, generated
│▌ AVL GO · NEWS                           │  ▌ warm accent bar, the same for every story
│▌ HELENE · COUNTYWIDE                     │
│▌ Buncombe challenges its share of        │  Fraunces, up to 3 lines, on #faf9f7
│▌ Helene housing money                    │
│▌                                         │
│▌ Watchdog · Thu, Sep 24                  │  outlets + date, Inter
└──────────────────────────────────────────┘
Buncombe challenges its share of Helene housing money            ← og:title (our headline)
The county lost the most homes to Helene but got the smallest…   ← og:description
· Asheville Watchdog · Sep 24
avlgo.com
```

**The card:**
- `og:title` is our headline, 70 characters at most.
- `og:description` is our one-line dek, then " · outlets · date", 160 characters at most.
- `og:image` is `/news/og/<shortId>.png?v=<summaryVersion>`, generated with `next/og` `ImageResponse` (Fraunces + Inter). Its `og:image:alt` is the headline.
  - The design is AVL GO-branded. **No outlet photos**, in line with the no-images default.
  - Keep it under 300 KB so WhatsApp shows it.
- `og:type=article`, `article:published_time` and `article:modified_time`, `og:site_name=AVL GO`.
- `twitter:card=summary_large_image` and `twitter:creator=@mattbrooksxyz`, as `app/layout.tsx` already sets.

**Where the tags come from:**
- For `/news?s=` URLs, `generateMetadata` reads `s` and emits **the story's** tags, not the generic feed tags. `<link rel="canonical">` points at the story permalink, so search engines index one URL.
- A community-only story uses the same card. Its description ends "· r/asheville · not verified" in place of the outlets.
- The **mockup's share panel** renders this card so it can be reviewed.


---

## 4. Search and filter

### Filters (FilterBar + a FilterModal-style sheet + ActiveFilters chips)

| Filter | Values | Notes |
|---|---|---|
| **Topics** (include/exclude) | Civic · Housing & Growth · Helene Recovery · Environment & Outdoors · Schools & Kids · Business & Food · Arts & Culture · Public Safety · Health · Getting Around · Weather · Only in AVL | **Only in the filter sheet.** No chip row on the feed (09-27). An active topic shows as an ActiveFilters chip |
| **Places** (decision 2) | **Asheville:** Downtown · West Asheville · North Asheville · East Asheville · South Asheville · Montford · River Arts District · Biltmore Village · Haw Creek · Kenilworth · Oakley · Shiloh · Beaverdam. **Buncombe:** Black Mountain · Montreat · Weaverville · Woodfin · Biltmore Forest · Swannanoa · Candler · Enka · Leicester · Fairview · Arden · Barnardsville. Plus **Countywide** | Built from `zipNames.ts`, **minus its Henderson County entries** (Fletcher, Hendersonville, Mills River, Flat Rock), plus named neighborhoods the AI extracts. Events keep their own list |
| **Source types** | Reporting ✓ · Official ✓ · Community ✓ | One switch per kind. Turning Community off hides community-only stories, the `r/asheville` chips and the story pages' "What locals are saying" |
| **Outlets** (include/exclude) | Every source | "Hide [outlet]" from the ⋮ menu, synced like `blockedHosts` |
| **Date** | Today · Last 3 days (default) · Week · Month · Custom | |
| **More** | Hide paywalled · Public safety: collapsed / hidden | |
| **Sort** | Top · Latest | Both stay grouped by day |

### Search: the site's first semantic surface

**Search, like the topic and place filters, always runs against All news, never just Top stories.** Top is only the default browse view.

Today every search on the site is a substring match (`ILIKE`), and people have learned that the words they type are the words they get. So meaning-based results have to *explain themselves*, or they'll read as bugs.

```
[⌕ wildlife                                ×]
 Did you mean a place or topic?  [Topic: Environment & Outdoors +]
┌──────────────────────────────────────────┐
│ MENTIONS "WILDLIFE"                    1 │
│ Residents press City Council to act on   │
│ bears                                    │
│ ⌕ "wildlife" in NCWRC's release title    │
├──────────────────────────────────────────┤
│ RELATED BY MEANING                     1 │
│ ‹story›                                  │
│ ≈ related: animals, bears                │
└──────────────────────────────────────────┘
 Searching stories · [Articles]
```

1. **Two labelled groups, text first.**
   - **"Mentions ‘x’"** holds exact and stemmed text matches, with the term highlighted.
   - **"Related by meaning"** holds embedding matches above a similarity threshold, capped at about 8 results.
   - Never interleave them. The label is what makes meaning results legible.
2. **Every result says why it matched,** in one gray line:
   - `⌕ "costco" in headline` or `⌕ "wildlife" in NCWRC's release title`.
   - `≈ related: animals, bears`, built from the overlap between the query's nearest concepts and the story's topics and entities, **not** from raw vector scores.
3. **Query → filters.** A place or topic in the query becomes a one-tap chip that applies the real filter and removes the words from the text query. "montford traffic" offers [Place: Montford] [Topic: Getting Around]. This mirrors the events filter vocabulary, so the skill transfers.
4. **Disambiguation.** When the query's nearest entities belong to different stories, show "Did you mean" chips. **"dolly"** returns *Dolly (the bear)* on the bear story and *Dolly Parton Day* on Friday's story. A plain text match would mix them without comment.
5. **Keyword traps, ranked away.** Entity-typed ranking puts the Flock-camera thread above "Flocktoberfest", and Dolly the bear apart from Dolly Parton.
6. **Questions go to Ask AI.** If the query looks like a question (it starts with who, what, why, how or when, or ends with "?"), show a card: "Ask AI: answer from story summaries, with citations →". Search returns stories; Ask AI answers. The two stay separate.
7. **Scope toggle:** Stories (default) · Articles. Community-only stories come back as ordinary story results, and an attached post is found through its story. There's no separate community group.
8. **Honest fallbacks.** If the embedding call fails, show text matches with the note "Showing exact matches only". Empty state: "No stories mention ‘x’, and nothing is close in meaning." Suggested searches come from active storylines.
9. **Mechanics** (for the pipeline):
   - Embed the query with `taskType: RETRIEVAL_QUERY`, the same model as the articles (`lib/ai/embedding.ts`), with debounce and cache.
   - Search stories (the centroid or summary embedding), not raw articles.
   - Live rows only (filter `hidden`, `deduped_at` and `dead_at`; the pipeline brief found these filters missing in `similaritySearch.ts`).
10. **A pilot for events.** If "Mentions / Related by meaning" works on news, the same pattern can replace the events feed's `ILIKE` search later.

---

## 5. Community posts (decision 4): attach first, then a row only above the bar

### What we're working with

- **Reddit:** r/asheville plus r/BlackMountain and r/wnc (Buncombe places only) through RSS. The prototype is in `lib/news/sources/reddit.ts`. About 46% of posts survive its filters, roughly 17 a day. Most of those won't clear the bar below.
- **Useful posts:** first-hand reports (an injured bear cub on lower Town Mountain, rats downtown) and civic questions (where council candidates stand on Flock cameras). Some posts are links to local outlets (the WLOS police-chief story).
- **Noise:** complaints, asks and personal posts.
- **Engagement.** RSS carries no scores or comment counts. `ScrapedArticle.engagement` (in `types.ts`) fills that in once Scry or the Reddit API supplies it (D8). It's a buzz signal, never a trust signal: it's half of the inclusion bar, and it never ranks stories or implies a post is credible.
- **Takedown path:** anyone, outlet or poster, can ask for removal from the Sources page. A per-source kill switch also purges stored text.

### Options

| Option | Verdict |
|---|---|
| A separate "Community" tab | Dropped: News is one page (Matt, 09-27) |
| An "Around town" strand at the end of each day, in its own violet design (v3) | Dropped: a second design and a second color in the same feed, and most of what it held was low-signal (Matt, 09-27) |
| Discussion attached to stories only | Good for context, but drops the moments when locals notice something before the newsrooms do |
| **Attach first; otherwise an ordinary row, only above the bar** | **V1 (Matt, 09-27).** One design for every row. The bar keeps the volume low, and the words (attributive framing, "not verified") carry the trust difference that color used to |

### The rule

1. **If a post is about an existing story, attach it.** It shows as one more neutral `r/asheville` chip on the row and in the **"What locals are saying"** section on the story page, placed *below* the reporting, official sources, timeline and events.
2. **Otherwise, it gets in only if it clears the bar.** Either:
   - **engagement:** a score of at least 25, or at least 15 comments (D25b, a starting point to retune); or
   - **the AI rates it important:** civic matters, public safety, public health, or a big local change (a road or business closing, a new development). Ordinary complaints, asks and chatter don't qualify however popular they are.
   - Everything else is **dropped**. There's no strand and no overflow page for it.
3. **A post that clears the bar becomes a community-only story,** shown as an ordinary row: our attributive headline and dek ("Locals ask where council candidates stand on Flock cameras"), a `Read on r/asheville ↗` button, and its topic · place tag. At most 3 a day (D25b).
4. **Community posts never:**
   - enter a reported story's headline, summary, key facts or timeline
   - appear in the short version, Top or the email (community-only stories are capped at importance 14, D25c)
   - count as a development or move a story to a new day
5. **Talk becomes reporting.** When a newsroom later covers a community-only story's topic, the community story merges into the reported one (its id redirects, §3b) and the post becomes that story's "What locals are saying". That shows the trust ladder in action.

### What it looks like

```
FEED ROW (reporting, with an attached post)
┌────────────────────────────────────────┐
│ Residents press City Council to act on │ ← Fraunces, our headline
│ bears                                  │
│ ‹our dek›                              │
│ [Read at BPR ↗] 828 ACT[$] +4          │ ← two chips, then +4: the City, NCWRC and
│ Civic · North Asheville    • 1d  [⇪]   │   County documents and the r/asheville post
└────────────────────────────────────────┘

COMMUNITY-ONLY STORY (cleared the bar, matches no story): the same row
┌────────────────────────────────────────┐
│ Locals ask where City Council          │ ← OUR attributive headline, never the post title
│ candidates stand on Flock cameras      │
│ ‹our dek: what the thread is asking,   │
│  no names, no claims about candidates› │
│ [Read on r/asheville ↗] Civic ·        │ ← no username, no quote, no image
│ Citywide                   11h  [⇪]    │
└────────────────────────────────────────┘

STORY PAGE (below reporting, official sources, timeline and events; never above)
  WHAT LOCALS ARE SAYING
┌──────────────────────────────────────────┐
│ COMMUNITY POSTS · NOT VERIFIED           │ ← neutral box, the label does the work
│ ✦ Summary of the posts (only if 2+)      │ ← attributive: "Several locals ask…"
│ A resident reports an injured bear cub   │
│ near lower Town Mountain.                │
│ r/asheville · 11:04 AM · Read thread ↗   │
│ [Unverified] ⌂ Report to NC Wildlife ↗   │
│ Summarized by AI. Community posts never  │
│ change this story's summary or timeline. │
└──────────────────────────────────────────┘
```

**How the three kinds stay apart without their own look:**

| Signal | Reporting | Official | Community |
|---|---|---|---|
| Chip | neutral gray, outlet short name | green ⌂ | neutral gray, `r/asheville` |
| Row design | the standard row | the standard row | the standard row |
| Words | our neutral summary | attributed ("the City says") | attributive ("Locals ask…", "A resident reports…"), and "not verified" in the summary label and the story page's section header |
| Where | the story list | the story list and inside stories (Official sources) | attached to a story, or a community-only row above the bar |

**Misinformation and privacy mitigations** (built into the design):
- **Link only.** We show our own words and a link to the thread. Never usernames, the post's own title or body, quotes, or images from the post.
- **Never cited.** Community posts never appear in a reported story's summary, the short version, key facts or a timeline. They can't re-file a story.
- **Neutral, attributive framing:** "Locals ask…", "A resident reports…". It never repeats claims about named people or unverified figures.
- **The bar** (rule 2) and **a per-day cap of 3** community-only stories.
- **Hazard reports** (outages, fires, wildlife, pests) carry an Unverified chip and a green link to the official channel.
- **Excluded categories** (listed below). Every community-only story has "Flag an error" like any story, and posters can ask for removal through the Sources page.
- **One switch.** "Community" in the filter sheet hides community-only stories, the `r/asheville` chips and the story-page sections everywhere.

### How a community post is shown

The design shows only our words and a link, the same principle as decision 3. It also protects private people.

- **Our own attributive words** ("Locals ask…", "A resident reports…", "A thread on…"). Never the post's title or body, no usernames, no images from the post, and no quotes.
  - The post "Injured Bear Cub Lower Town Mountain" becomes: *"A resident reports an injured bear cub near lower Town Mountain."*
- **No claims about named people.**
  - The real Flock thread guesses at named candidates' positions. We write *"Locals ask where City Council candidates stand on Flock surveillance cameras,"* and the story page's "Go in person" links to the real candidate forum (Sat, Oct 3).
- **Unverified numbers aren't repeated.** If the mortgage-rate thread cleared the bar, we'd write "a thread on 7% mortgage rates and homes sitting longer", not the poster's figures.
- **Bottom row** of a community-only story: `[Read on r/asheville ↗] Civic · Citywide · 11h · Share`. An attached post on a story page: `r/asheville · 11:04 AM · Read thread ↗`.
- **First-hand reports of hazards** (outages, fires, wildlife) get an **Unverified** chip and a link to the official channel. Rats downtown link to the City's Asheville App for service requests.
- **On a story page,** the section starts with a ✦ one-to-two-sentence summary of the attached discussion when there are 2 or more posts, then the per-post lines.
- **Default visibility:** Community is on. The switch turns it off.
- **Excluded entirely:**
  - posts about private individuals ("Who is the USPS guy with the downtown route?")
  - crime pleas and accusations ("HIT AND RUN TUNNEL RD, PLEASE SHARE")
  - posts that stigmatize groups ("Unhoused taking over…")
  - classifieds, recommendation asks, and anything outside Buncombe (the r/WNC thread about "the local papers" in the far west)

### Three kinds of source, one row design

| | **Reporting** | **Official** | **Community** |
|---|---|---|---|
| Who | Newsrooms (BPR, Asheville Watchdog, WLOS, Citizen Times, Black Mountain News, 828 News Now…) | City, County, state agencies, agendas, courts | r/asheville (later maybe Facebook groups) |
| Chip | Neutral gray, outlet short name | Green, landmark icon ⌂ | Neutral gray, `r/asheville` |
| In our summary | As fact, cited | As attributed fact ("the City says"), cited | **Never** in a reported story. A separate "What locals are saying" paraphrase |
| Can start a story | Yes | Yes | Only above the bar, as a community-only story labelled not verified |
| Moves a story to a new day | Yes (new development) | Yes (new development) | Never |
| In Top, the short version, the email | Yes | Yes | No |
| Link label | The outlet's headline | The document title | "Read on r/asheville ↗" or "Read thread ↗" |

**There's no legend.** The feed header's "Headlines and summaries by us, reporting from **these sources**" opens the sources modal (§2), which lists every source by kind with links, and the `/news/sources` page says the same with the removal contact.

---

## 6. Trust and tone

**Our words, their link** (decision 3):

1. **Every headline and summary we display is ours, and labelled.** An outlet's headline appears only as the label of a link to that outlet, with the outlet name beside it. Official document titles and Briefs follow the same rule.
2. **Summaries inform without replacing the article.** At most 80 words (30 for a feed dek), no quotes, about 3 facts per source at most, never the article's structure, and never past the public dek of a paywalled piece. The "In the full story:" line names what only the article has.
3. **The link out is the primary action.** Every row leads its bottom row with an outlined "Read at X" button, and every story page has a featured card with a full-width button. Outbound links carry `utm_source=avlgo` so outlets can see the traffic we send.
4. **Paywalled outlets are shown, not hidden,** with a `[$] Subscriber` chip and a "Hide paywalled" filter. Internal full text is never paywall-bypassed (`lib/news/types.ts` already says so).
5. **Official ≠ neutral.** Releases are a government's own framing, so summaries attribute them ("the City says"). The sources modal and the Sources page say "in their own words".
6. **Community is never fact** (§5).
7. **Corrections.**
   - An outlet's correction becomes a timeline node.
   - Our summaries are versioned with change notes.
   - "Flag an error" feeds the same review flow as event reports.
   - A retracted source is struck through, not silently removed.
8. **Ranking is explained in one line:** "Ranked by how many local newsrooms cover it and how much it affects Asheville and Buncombe. Never by clicks."
9. **Local-relevance gate:** Asheville and Buncombe only (decision 2). A WNC or statewide story appears only when its subject is Buncombe itself: FEMA money *for Buncombe*, not for WNC generally. Syndicated national and Upstate SC items go.
10. **Crime is collapsed, not deleted.** Single incidents go in the daily Public safety row, without names, mugshots or images. We strip "FIRST ALERT" and "BREAKING" from anything we display. Paired with the daily Only in AVL slot.
11. **No fake immediacy.** The page says when we last checked. For emergencies, point to official channels.
12. **Opinion is labelled** (Asheville Watchdog runs opinion pieces) and never becomes fact in a summary.
13. **A finite feed:** 3 days by default, a caught-up marker, and a real ending that hands off to events.

---

## 7. Personalization and retention

| Feature | Storage | Notes |
|---|---|---|
| Since last visit | localStorage `newsLastVisitAt` + `newsSeen{storyId: summaryVersion}`, synced when signed in | Drives the new dots, the "Updated" tag, the caught-up marker, and the News dot in the section switch |
| Hide an outlet or story | `newsBlockedOutlets`, `newsHiddenStoryIds` | Mirrors `blockedHosts` / `hiddenEvents` |

No following or bookmarks in V1 (S12).

**Email (a later phase, D30): one digest, with sections the reader chooses** (Events / News / Both) in `newsletter_settings`, using the existing 7 AM cron.
- **News section:** the short version plus up to 5 stories. Each shows our headline and a "Read at X" link.
- **No community content in the email.** Community-only stories never make Top, and the email uses the Top set.
- **Existing subscribers** stay on events-only and are invited once.
- **Top 30 stays pure.**

---

## 8. What makes this AVL GO and not Google News

1. **"What's next" you can act on.** Agenda dates become event rows with the Calendar button.
2. **Go in person.** Every story looks for related events. Real pairs today:
   - Dolly Parton Day → Grey Eagle and Jack of the Wood tributes
   - River corridors → the City's riverfront drop-in session
   - Council stories → the Oct 3 candidate forum
3. **Ask them in person.** Community-only stories about civic questions link to the forum or meeting where they can be asked.
4. **"That's the news. Now go do something."** The feed ends by handing off to the week's Top 30 events, in the Top 30's own cards.
5. **Curators on the news.** Verified curators can add a 280-character note under a story's summary, linked to their `/u/[slug]` page. Human local voices sit on top of the AI layer.
6. **Only in AVL** each day.
7. **One place vocabulary** for events and news. The West Asheville lens works on both, within Buncombe.
8. **Storylines and a Helene tracker** (phase 3). Helene's two-year anniversary is this weekend, and the export has 7 anniversary events in and around Asheville. Recovery money is the story Buncombe will be following for years.
9. **The promises are already on the home page:** no ads, open data, open source.

---

## 9. What the UI needs from the AI layer

This goes beyond the earlier note I sent design-ai.

- `story.headline` (ours, always) and `story.dek` (at most 30 words, describing the latest development)
- `summary: {text, sourceIds[]}[]` (at most 80 words), plus `summaryVersion`, `changedAt` and `changeNote`
- `keyFacts: {label, value}[]` and `whatsNext: {date, label, sourceId, eventId?}[]`
- `developments: {at, text, sourceIds[]}[]` and `lastDevelopmentAt`. **Only reporting and official sources can create a development**
- `leadArticleId`: the most complete original reporting; ties go to the free outlet
- Per article:
  - `fullStoryHas`: at most 25 words describing what the article covers *beyond* the summary, from the full text. **Null when paywalled**
  - `kind`: reporting / official / community, plus `isPrimarySource`, `paywalled`, `isOpinion`, `author`, `publishedAt`, `updatedAt`, and a correction note
- Per community post:
  - `paraphrase`: at most 20 words, neutral and attributive, with no names of private people and no unverified figures
  - `attachedStoryId?`: the story it attaches to. Null means it becomes a community-only story if it clears the bar, and is dropped otherwise
  - the bar's inputs: `engagement {score, comments}` when we have it, and `aiImportant` (civic, public safety, public health, or a big local change)
  - flags: `isHazardReport`, `excludeReason` (private individual, accusation, stigmatizing, classified, out of area)
- Per story: `communitySummary?` (1–2 sentences, attributive), and for a community-only story, an attributive headline and dek plus `relatedEventIds[]` like any story
- **Top vs All:** `importance` (0–30, the same scale as event scores) computed per story. Top membership is stored per filing day with hysteresis (`top_day`, `top_rank`, `top_since`, `top_reason`; design-ai 02 §8.3). Rule: ≥ 15, at most 5 a day, at least 2 topped up from ≥ 8. Community-only stories are capped at 14. Only in AVL is added UI-side. **Status: agreed with design-ai.**
- **Sharing:**
  - An 8-character `short_id`, never reused, on stories (and articles). **Status: agreed with design-ai.**
  - `news_story_redirects (old_id, old_short_id → new_id)`, written on every merge and path-compressed, so old links 308 straight to the survivor.
  - `state='hidden'` plus a reason, so a dead link returns 410 "no longer available".
  - `og` fields: headline, dek, outlets, first-published and last-development times, and `summaryVersion` for the image URL.
- Flags: `isIncident` (Public safety row), `isBrief` (Briefs row), `isOnlyInAvl` candidate, `localRelevance` (Buncombe gate)
- `topics[]` (the fixed 12), `places[]` (the Buncombe vocabulary in §4) and typed `entities[]` (person / org / place / animal / event), used for disambiguation chips
- Search: story embeddings, plus concept labels for the "≈ related:" explanation line
- `relatedEventIds[]` with similarity scores and a threshold

---

## 10. Build order

| Phase | Scope |
|---|---|
| **1. MVP** | The Events · News section switch (News is one page, no sub-tabs). `/news` Rundown-by-day with Read buttons, the short version, Public safety, Briefs, community-only stories above the bar, the caught-up marker, and the Top 30 end cap. The feed header's sources modal. Story page with summary, lead card and "In the full story", more reporting, official sources, related events, and What locals are saying. Search with Mentions and Related by meaning. Topic and place filters in the filter sheet. **Top/All switch with "+N more"**. **Share buttons, `?s=` deep links with highlight, and OG cards.** `/news/sources`. JSON export |
| **2. Retention** | Outlet and source-type filters. "What's next" and the calendar, with civic meetings from agendas as events. News section in the digest. Timeline with corrections. Ask AI over news. "Now reported": merging a community-only story into the reported story that follows it |
| **3. Distinctive** | Home "Today in Asheville" module. Curator notes. Storylines and the Helene tracker. "In the news" on event pages. Weekly "5 stories that mattered". Entity pages. Hybrid search on events |

---

## Decisions for Matt

**Settled by Matt (recorded, not open):**
- News is its own section.
- Asheville + Buncombe only: a WNC or statewide story appears only when its subject is Buncombe itself.
- We show only our AI summaries and link out.
- Reddit and community posts are in scope. The treatment is in §5: attach first, then an ordinary row only above the bar, in the same design as everything else (09-27).
- robots.txt and terms aren't blockers. Takedown goes through the public Sources page.
- No outreach to outlets before launch; they'll reach out if needed (D29).
- Top vs All (S9) and first-class sharing (S10). Designed in §2 and §3b.
- From the v3 mockup review (09-27, S12–S18): no following or bookmarks in V1; one news page; no "Developing" tag; no legend, with a "these sources" modal instead; topics only in the filter sheet; the simpler row with an outlined Read button; the Top 30 end cap.

**Still open:**

**1. How do people move between Events and News?**
- Options:
  - (a) News as a fifth pill.
  - (b) An **Events · News section switch**.
  - (c) A mobile bottom tab bar.
- **Recommend (b).**
- Why: the other four pills are all views of events, and News is a different kind of content. News is one page, so it needs no tabs of its own. The switch fits the existing two-row mobile header without adding height, and gives a quiet "new" dot.

**2. Which feed format?**
- Options: Rundown · Brief cards · Edition · Storylines · the hybrid **Rundown by day**.
- **Recommend the hybrid.**
- Why: it answers "since I last looked", it ends, it keeps our prose to one line per story, and it reuses the sticky day headers. Brief cards are the riskiest option under decision 3, because they read like a replacement for the article.

**3. What does a row tap do?**
- **Recommend:** the headline opens our story page, and an outlined **"Read at X ↗" button on every row** (Matt, 09-27) goes straight to the outlet.
- Why: the story page carries the sources, related events and the community section. The button keeps the link out one tap away. **Measure outbound clicks from day one.**

**4. Outlet headlines as link labels?**
- Options:
  - (a) Show the outlet's own headline, attributed, as the link text in source lists.
  - (b) Paraphrase them too.
- **Recommend (a).**
- Why: it's standard citation practice, it tells readers exactly what they'll open, and outlets want their headline to be the thing people click. Everything *else* we display is ours. Confirm this reading of decision 3.

**5. Search results layout?**
- **Recommend: two labelled groups, "Mentions ‘x’" and "Related by meaning"**, each result with a "why" line, plus query-to-filter chips and "did you mean" disambiguation.
- Why: this is the site's first semantic search, and unexplained meaning matches look like bugs.

**6. Images in the feed?**
- **Recommend: none at launch, on design merit.**
  - Text-only rows fit 5–6 stories on a phone screen; with thumbnails it's about 2.
  - Text-first tells news apart from the image-led events feed at a glance.
  - Most local-news art is generic (City Hall exteriors, police tape, stock photos) and adds weight, not information.
- Revisit a single lead image on story pages later.

**7. Crime and incidents?**
- **Recommend: a collapsed daily "Public safety" row,** with a filter to hide it. Honest without becoming a doomscroll.

**8. Email?**
- **Recommend: one digest with sections the reader chooses (Events / News / Both).** Existing subscribers are invited, not switched.

**9. Paywalled outlets?**
- **Recommend: include them with a lock and a filter.** Their summaries use only the public dek. We never circumvent paywalls.

**10. Freshness?**
- **Recommend: say "checked every 3 hours" honestly** (D28). Optionally poll the City and County alert feeds hourly.

**11. Top thresholds?**
- **Recommend:** importance **≥ 15** of 30, **at most 5** a day, **at least 2**, with Only in AVL always included and community-only stories kept out.
- Why: 15 is the events "quality" tier. With the real Sep 24 items this gives 6 of 12 on a busy Thursday (5 plus Only in AVL) and every story on a thin Tuesday.
- Retune after two weeks of scores. **Target: Top holds about 40–60% of a typical day's stories.**
