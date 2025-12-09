# Existing Event Sources

Quick reference for how each current source works.

> **⚠️ NOTE**: All new scrapers should use API-based approaches. Browser automation (like Facebook) is NOT supported for new scrapers - it runs separately and requires special infrastructure.

## AVL Today (CitySpark API)

**File**: `lib/scrapers/avltoday.ts`
**Type**: API-based (POST requests)
**Source ID**: `AVL_TODAY`

```
API: https://portal.cityspark.com/v1/events/AVLT
Method: POST
Payload: { ppid, start, end, skip, sort, defFilter, labels, pick, tps, sparks, distance, lat, lng, search }
Pagination: skip parameter (25 per page)
Rate limit: 200ms between pages
```

Key patterns:
- Uses `PId` or `Id` as sourceId
- Detects "time unknown" events by checking for midnight UTC
- Defaults to 9 AM Eastern when time unknown

---

## Eventbrite

**File**: `lib/scrapers/eventbrite.ts`
**Type**: Hybrid (HTML scraping + API)
**Source ID**: `EVENTBRITE`

```
Step 1: Scrape browse pages for event IDs
  URL: https://www.eventbrite.com/d/nc--asheville/all-events/?page=N
  Extract: Event IDs from URLs via regex

Step 2: Fetch details via API
  URL: https://www.eventbrite.com/api/v3/destination/events/?event_ids=...
  Batching: 15 events per request

Rate limits: 2s between browse pages, 1.5s between API batches
```

Key patterns:
- Uses `parseLocalDateInTimezone()` for proper timezone handling
- Extracts organizer from `primary_organizer` or `primary_venue`
- Location format: `{city} @ {venue}` when venue differs from city

---

## Meetup

**File**: `lib/scrapers/meetup.ts`
**Type**: API-based (GraphQL)
**Source ID**: `MEETUP`

```
API: https://www.meetup.com/gql2
Method: POST (persisted query)
Query: recommendedEventsWithSeries
Filter: PHYSICAL events only (no virtual)
```

Key patterns:
- Uses date-range approach (day-by-day) to bypass 380 event limit
- Filters to Asheville-area using city/group name patterns
- Fetches og:image from event pages when GraphQL has no photo
- Uses Eastern timezone offsets from `getEasternOffset()`

---

## Harrah's Cherokee Center

**File**: `lib/scrapers/harrahs.ts`
**Type**: Hybrid (Ticketmaster API + HTML)
**Source ID**: `HARRAHS`

```
Primary: Ticketmaster Discovery API (venueId: KovZpZAJvnIA)
Secondary: Website HTML scraping for non-TM events
  Calendar URL: https://www.harrahscherokeecenterasheville.com/events-tickets/
  Event pages: Extract from Google Calendar links for dates
```

Key patterns:
- Deduplicates TM vs HTML events by date + normalized title
- Enriches TM events with HTML descriptions
- Uses `parseAsEastern()` for date parsing

---

## Orange Peel

**File**: `lib/scrapers/orangepeel.ts`
**Type**: Hybrid (Ticketmaster API + JSON-LD)
**Source ID**: `ORANGE_PEEL`

```
Primary: Ticketmaster Discovery API (venueId: KovZpa3hYe)
Secondary: Website JSON-LD scraping
  Calendar URL: https://theorangepeel.net/events/
  Event pages: JSON-LD structured data
```

Key patterns:
- Cleans title by removing age restrictions
- Handles both main venue and "Pulp" sub-venue
- Deduplicates across TM and website sources

---

## Grey Eagle

**File**: `lib/scrapers/greyeagle.ts`
**Type**: HTML/JSON-LD
**Source ID**: `GREY_EAGLE`

```
Calendar URL: https://www.thegreyeagle.com/calendar/
Event pages: JSON-LD structured data
Price: Extracted from HTML (JSON-LD price always 0)
```

Key patterns:
- Pure website scraping (no TM)
- Extracts price from contextual patterns in HTML
- Uses `decodeHtmlEntities()` for title cleaning

---

## Live Music Asheville

**File**: `lib/scrapers/livemusicavl.ts`
**Type**: API-based (WordPress Tribe Events REST API)
**Source ID**: `LIVE_MUSIC_AVL`

```
API: https://livemusicasheville.com/wp-json/tribe/events/v1/events
Pagination: page + per_page parameters
Filter: Specific target venues only
```

Key patterns:
- Filters to specific venues (Pisgah Brewing, Jack of the Wood, etc.)
- Has venue fallback images for events without images
- Uses `utc_start_date` field (append 'Z' for proper UTC parsing)

---

## Facebook (⚠️ SPECIAL CASE - DO NOT COPY)

**File**: `lib/scrapers/facebook.ts` (and variants)
**Type**: Browser automation (Patchright/Playwright)
**Source ID**: `FACEBOOK`

```
Requires: Browser automation due to Facebook's anti-scraping
Filters: Events with >1 going OR >3 interested
Fields: interestedCount, goingCount
```

> **⛔ DO NOT USE THIS AS A MODEL FOR NEW SCRAPERS!**
>
> Facebook scraping requires browser automation because Facebook has no public API and aggressive anti-scraping measures. This scraper:
> - Runs separately from the main cron job
> - Requires special infrastructure (not Vercel)
> - Is resource-intensive and fragile
>
> For new sources, ALWAYS find an API endpoint first. If you can't find one after exhaustive network analysis, ask the user before resorting to browser automation.

---

## Example: Internal API Discovery

### Explore Asheville (discovered via Network tab)

When exploring `exploreasheville.com`, watching network requests revealed:

```
GET /api/getListingGridData?type=event&page=0&sortValue=next_date&sortOrder=ASC&startDate=...
Host: www.exploreasheville.com
```

This internal API returns JSON with all events - much better than any HTML scraping approach. This is the ideal outcome for any new source.
