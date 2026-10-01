# News sources: robots, terms and takedown contacts

Reference only. Per decision S5, robots.txt and terms of use are not blockers: we ingest, summarize with attribution and a link out, and take down any outlet that asks. The full per-source record (endpoints, verbatim quotes, risk tier, contact) is in `data/news/source-policy.json`. It was gathered on 2026-09-25 and reflects the modules as of 00:45 that day.

"AI blocks" means robots.txt disallows named AI crawlers such as ClaudeBot or GPTBot. None of those rules matches our fetcher. The risk tier is my assessment from before S5 (A low, B medium, C high) and is kept only as context in case an outlet complains.

| Source | Terms on automated / AI use | AI blocks | Risk | Takedown contact |
|---|---|---|---|---|
| FOX Carolina (Gray) | Explicit ban on crawlers, storing and AI (§8(j), Jul 2026) | yes | C | legal-notices@graymedia.com · foxcarolina.com/about-us/contact-us |
| Black Mountain News (Gannett) | Explicit ban on crawling, caching and AI; robots.txt "not our authorization" | yes | C | legalnotices@gannett.com |
| Mountain Xpress | Explicit ban on automated access | yes (about 45) | C | not captured |
| Google News | Google ToS makes robots.txt binding; `/rss/` disallowed; feed for personal use only | yes | C | n/a (the publishers) |
| Reddit | Scraping needs written consent; robots `Disallow: /` | n/a | C | copyright@reddit.com |
| WLOS (Sinclair) | Personal use only; "mining, scraping" listed as prohibited | yes | B | wlos.com/station/contact |
| 828newsNOW (Saga) | Personal use only; no copies or deep links | CCBot only | B | copyrightclaim@sagacom.com · 828newsnow.com/contact-us |
| Mission Health (HCA) | No robot harvesting except search engines | no | B | copyright@hcahealthcare.com · missionhealth.org/contact-us |
| The Urban News | No copying or storing | no | B | theurbannews.com/contact-us · 828-253-5585 |
| Beacon Tribune | Personal use only; no reproduction | yes (about 40) | B | editor@thebeacontribune.com |
| WNC Business (Locable) | 2012 platform terms ban scrapers | no | B | wncbusiness.com/pages/contact |
| Asheville Watchdog | Free republishing with credit | yes (incl. Claude-User) | A | editor@avlwatchdog.org · kcampbell@avlwatchdog.org |
| Carolina Public Press | CC BY-ND 4.0; linking welcomed | no | A | (919) 590-5891 · carolinapublicpress.org/share-our-content-2 |
| BPR | No terms found | no | A | tech@bpr.org (DMCA) · bpr.org/contact-us-blue-ridge-public-radio |
| Blue Banner | No terms found | no | A | thebluebanner.net/contact |
| Wake Up, Asheville! | Podcast feed, © Wake Up the News | none | A | matt@podavl.com |
| Buncombe County | Public record; CivicPlus vendor terms claim AI limits | no | A | buncombenc.gov/142/Contact |
| Buncombe Commission | Public record; same CivicPlus terms | none | A | buncombenc.gov/142/Contact |
| Town of Black Mountain | Public record; same CivicPlus terms | no | A | 828-419-9300 |
| Buncombe County Schools | Public record; Apptegy vendor terms bar bots | none | A | not captured (vendor: legal@apptegy.com) |
| City of Asheville + Council agendas | Public record; no terms | no | A | webmaster@ashevillenc.gov |
| Montreat / Weaverville / Biltmore Forest | Public record; no terms | no | A | townofmontreat.org/contact · weavervillenc.org/contact · biltmoreforest.org staff contacts |
| UNC Asheville | Public record; no terms | no | A | unca.edu/contact-unca |
| Asheville Regional Airport | Public record; no terms | no | A | pr@flyavl.com |

Access notes for the record:
- MountainX's REST path passes a Cloudflare check with `fetchAsChrome`.
- Buncombe County goes through curl.
- Beacon Tribune falls back to scraping its HTML news page when the feed is rate-limited (429).
- 26 of 27 modules send a Chrome UA; only Reddit identifies itself.

These are covered by defaults D0, D0b and D3 in `docs/news/decisions.md`.
