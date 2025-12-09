---
name: event-scraper
description: Create new event scraping scripts for websites. Use when adding a new event source to the Asheville Event Feed. ALWAYS start by exhaustively analyzing network requests to find the site's internal API - browser scraping is NOT supported (Vercel limitation). Handles API-based, HTML/JSON-LD, and hybrid patterns with comprehensive testing workflows.
---

# Event Scraper Skill

Create new event scrapers that integrate with the Asheville Event Feed codebase. This skill provides patterns and guidance for the full lifecycle: exploration, development, testing, and production integration.

---

## ⚠️ CRITICAL: API-First Approach

**Scrapers run automatically on Vercel which does NOT support browser automation.**

You MUST exhaustively explore the site's internal API before considering any other approach. Modern websites almost always fetch their event data from a backend API - your job is to find and use that same API.

### Priority Order (STRICTLY follow this order):

1. **🥇 Internal JSON API** - Best option. Site's own API endpoints (found via Network tab)
2. **🥈 Public API** - Official documented API (Ticketmaster Discovery, Eventbrite API, etc.)
3. **🥉 HTML with JSON-LD** - Structured data embedded in HTML pages
4. **❌ Browser scraping** - LAST RESORT ONLY - Will NOT work on Vercel!

### Why API-First?

- **Reliability**: APIs are stable; HTML changes break scrapers
- **Performance**: Single request vs. parsing entire page
- **Vercel compatible**: No browser/Puppeteer needed
- **Rate limiting**: APIs handle pagination cleanly
- **Data quality**: Structured JSON vs. regex HTML parsing

---

## Quick Reference

| Scraper Type | When to Use | Example |
|-------------|-------------|---------|
| Internal API | Site loads events via XHR/fetch (ALWAYS check first!) | Explore Asheville, AVL Today |
| Public API | Official API available | Meetup GraphQL, Ticketmaster |
| HTML/JSON-LD | No API, but has structured data | Grey Eagle |
| Hybrid | Combine API + enrichment from pages | Eventbrite, Orange Peel |

## Required Output Format

Every scraper MUST return `ScrapedEvent[]`:

```typescript
interface ScrapedEvent {
  sourceId: string;      // Unique ID from source platform
  source: EventSource;   // Add to types.ts if new source
  title: string;
  description?: string;
  startDate: Date;       // UTC Date object
  location?: string;
  organizer?: string;
  price?: string;        // "Free", "$20", "$15 - $30", "Unknown"
  url: string;           // Unique event URL (used for deduplication)
  imageUrl?: string;
  interestedCount?: number;
  goingCount?: number;
  timeUnknown?: boolean;
}
```

---

# PHASE 1: EXPLORATION (CRITICAL - DO NOT SKIP)

**STOP! Before writing ANY code, you MUST exhaustively explore the target site's network requests.**

Modern websites load event data from APIs. Your first job is to find and document that API. Browser-based scraping is NOT an option for this project (Vercel doesn't support it).

## Step 1.1: Create Debug Directory

```bash
mkdir -p debug-scraper-SOURCENAME
```

## Step 1.2: Network Request Analysis (REQUIRED)

This is the most important step. Spend time here to find the site's internal API.

### How to Capture Internal API Requests:

1. **Open browser DevTools** (F12 or right-click → Inspect)
2. **Go to Network tab**
3. **Check "Preserve log"** (important for SPAs that navigate)
4. **Filter by "Fetch/XHR"** to see only API requests
5. **Navigate to the site's events/calendar page**
6. **Watch for requests that return JSON event data**
7. **Try interactions**:
   - Scroll down (infinite scroll often triggers API calls)
   - Click "Load More" or pagination buttons
   - Change filters or date ranges
   - These actions reveal API endpoints!

### What to Look For:

```
✅ GOOD - API endpoints typically look like:
   /api/events
   /api/getListingGridData?type=event
   /v1/events?page=1
   /graphql (with events query)
   /wp-json/tribe/events/v1/events
   /_next/data/xxx/events.json

❌ BAD - These are NOT the API:
   /events (returns HTML page)
   /calendar.html
   Static .js or .css files
```

### Capture the Full Request:

When you find a promising request:

1. **Right-click the request → Copy → Copy as cURL**
2. Save to debug folder for analysis
3. Note ALL of these details:

```markdown
# debug-scraper-SOURCENAME/api-discovery.md

## API Endpoint Found
- **URL**: https://www.example.com/api/getListingGridData
- **Method**: GET
- **Found by**: Scrolling events page / clicking Load More / etc.

## Query Parameters
| Parameter | Example Value | Purpose |
|-----------|---------------|---------|
| type | event | Filter type |
| page | 0 | Pagination |
| startDate | 1765256400 | Unix timestamp |
| sortValue | next_date | Sort field |

## Required Headers
- User-Agent: Mozilla/5.0 ...
- Accept: application/json
- Referer: https://www.example.com/events (may be required!)
- Cookie: (note if session cookies are needed)

## Response Structure
- Format: JSON array / object with events property
- Pagination: page number / cursor / offset
- Total count field: totalResults / total / etc.

## Sample cURL
```
curl 'https://www.example.com/api/events?page=0' \
  -H 'User-Agent: Mozilla/5.0...' \
  -H 'Accept: application/json' \
  -H 'Referer: https://www.example.com/events'
```
```

### Test the API Endpoint:

```bash
# Test with curl (adjust headers based on what you captured)
curl "https://example.com/api/events?page=0" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
  -H "Accept: application/json" \
  -H "Referer: https://example.com/events" \
  > debug-scraper-SOURCENAME/01-raw-api-test.json

# Check if it's valid JSON with events
cat debug-scraper-SOURCENAME/01-raw-api-test.json | head -100
```

### Real-World Example: Explore Asheville

The user found this API by watching network requests:

```
GET /api/getListingGridData?type=event&page=0&sortValue=next_date&sortOrder=ASC&startDate=...
Host: www.exploreasheville.com
```

This returns JSON with all events - much better than scraping HTML!

## Step 1.3: If No Internal API Found (Check These Next)

Only move to these if you've EXHAUSTIVELY checked network requests:

### Check for Ticketmaster Integration

Many venues use Ticketmaster. Search for the venue:

```bash
curl "https://app.ticketmaster.com/discovery/v2/venues.json?apikey=YOUR_KEY&keyword=Venue%20Name&stateCode=NC" \
  > debug-scraper-SOURCENAME/tm-venue-search.json
```

### Check for JSON-LD in Page Source

```bash
curl "https://example.com/events/sample-event" \
  -H "User-Agent: Mozilla/5.0" \
  | grep -o '<script type="application/ld+json">[^<]*</script>'
```

### Check for Common CMS APIs

- **WordPress Tribe Events**: `/wp-json/tribe/events/v1/events`
- **Squarespace**: `/?format=json` or `/events?format=json`
- **Wix**: Check for `wix-events` in network requests

## Step 1.4: Document Your Decision

Create a summary with your approach:

```markdown
# debug-scraper-SOURCENAME/exploration-notes.md

## Source: VENUE_NAME
## Date: YYYY-MM-DD
## Decision: [API / JSON-LD / Hybrid]

### Exploration Summary
- [x] Checked Network tab for XHR/Fetch requests
- [x] Tried scrolling/pagination to trigger API calls
- [x] Checked for Ticketmaster integration
- [x] Checked for JSON-LD structured data
- [ ] No API found - requires HTML parsing (explain why!)

### API Details
- Endpoint:
- Method: GET/POST
- Pagination: page=N / offset=N / cursor=xxx
- Auth: None / API key / Session cookie

### Field Mapping
| API Field | ScrapedEvent Field | Transform |
|-----------|-------------------|-----------|
| id | sourceId | prefix 'src-' |
| name | title | decodeHtmlEntities |
| startTime | startDate | parseAsEastern |

### Timezone Notes
- API returns: UTC / Local / ISO with TZ
- Transform: parseAsEastern() / new Date() / etc.
```

---

## ⛔ DO NOT USE BROWSER SCRAPING

If you cannot find an API endpoint after exhaustive network analysis:

1. **Ask the user** - They may have insights about the site
2. **Check if site is worth adding** - Some sites aren't scrapable without a browser
3. **Document why** - Explain what you tried and why API wasn't found

**Browser scraping (Puppeteer/Playwright) is NOT supported** because:
- Vercel serverless functions don't support browsers
- Increases complexity and failure points
- Much slower than API calls
- Often blocked by anti-bot measures

---

# PHASE 2: DEVELOPMENT

## Step 2.1: Add Source Type

Add to `lib/scrapers/types.ts`:

```typescript
export type EventSource = 'AVL_TODAY' | ... | 'YOUR_SOURCE';
```

## Step 2.2: Create Scraper with Debug Mode

Create the scraper file with built-in debug output. The scraper should save raw data to the debug folder when a `DEBUG_DIR` env var is set:

```typescript
// lib/scrapers/yoursource.ts

import { ScrapedEvent } from './types';
import { fetchWithRetry } from '@/lib/utils/retry';
import { formatPrice } from '@/lib/utils/formatPrice';
import { isNonNCEvent } from '@/lib/utils/locationFilter';
import { parseAsEastern } from '@/lib/utils/timezone';
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';
import * as fs from 'fs';
import * as path from 'path';

// Debug helper - saves data to debug folder if DEBUG_DIR is set
function debugSave(filename: string, data: unknown): void {
  const debugDir = process.env.DEBUG_DIR;
  if (!debugDir) return;

  const filepath = path.join(debugDir, filename);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content);
  console.log(`[DEBUG] Saved: ${filepath}`);
}

export async function scrapeYourSource(): Promise<ScrapedEvent[]> {
  console.log('[YourSource] Starting scrape...');

  // Fetch raw data
  const response = await fetchWithRetry(API_URL, { ... });
  const rawData = await response.json();

  // Save raw response for debugging
  debugSave('01-raw-api-response.json', rawData);

  // Transform to ScrapedEvent format
  const events = rawData.events.map(formatEvent);

  // Save transformed events
  debugSave('02-transformed-events.json', events);

  // Filter non-NC events
  const ncEvents = events.filter(ev => !isNonNCEvent(ev.title, ev.location));

  // Save final output
  debugSave('03-final-events.json', ncEvents);

  // Save validation report
  const report = generateValidationReport(ncEvents);
  debugSave('04-validation-report.txt', report);

  return ncEvents;
}

function generateValidationReport(events: ScrapedEvent[]): string {
  const lines: string[] = [
    `VALIDATION REPORT - ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    '=== DATE VALIDATION ===',
  ];

  // Check dates are valid and in reasonable range
  const now = new Date();
  const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  for (const event of events) {
    const date = event.startDate;
    const issues: string[] = [];

    if (isNaN(date.getTime())) {
      issues.push('INVALID DATE');
    } else if (date < now) {
      issues.push('IN PAST');
    } else if (date > oneYearFromNow) {
      issues.push('TOO FAR FUTURE');
    }

    // Check for midnight (might indicate missing time)
    const hours = date.getHours();
    const mins = date.getMinutes();
    if (hours === 0 && mins === 0) {
      issues.push('MIDNIGHT (missing time?)');
    }

    if (issues.length > 0) {
      lines.push(`  ${event.title.slice(0, 50)}`);
      lines.push(`    Date: ${date.toISOString()} -> ${date.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
      lines.push(`    Issues: ${issues.join(', ')}`);
    }
  }

  lines.push('', '=== FIELD COMPLETENESS ===');
  const withImages = events.filter(e => e.imageUrl).length;
  const withPrices = events.filter(e => e.price && e.price !== 'Unknown').length;
  const withDescriptions = events.filter(e => e.description).length;

  lines.push(`  With images: ${withImages}/${events.length} (${Math.round(withImages/events.length*100)}%)`);
  lines.push(`  With prices: ${withPrices}/${events.length} (${Math.round(withPrices/events.length*100)}%)`);
  lines.push(`  With descriptions: ${withDescriptions}/${events.length} (${Math.round(withDescriptions/events.length*100)}%)`);

  lines.push('', '=== SAMPLE EVENTS ===');
  for (const event of events.slice(0, 5)) {
    lines.push(`  Title: ${event.title}`);
    lines.push(`  Date (UTC): ${event.startDate.toISOString()}`);
    lines.push(`  Date (ET): ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    lines.push(`  Location: ${event.location || 'N/A'}`);
    lines.push(`  Price: ${event.price || 'N/A'}`);
    lines.push(`  URL: ${event.url}`);
    lines.push('');
  }

  return lines.join('\n');
}
```

## Step 2.3: Create Test Script

Create `scripts/test-yoursource.ts`:

```typescript
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Set debug directory BEFORE importing scraper
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-yoursource');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}
process.env.DEBUG_DIR = DEBUG_DIR;

import { scrapeYourSource } from '../lib/scrapers/yoursource';

async function main() {
  console.log('='.repeat(60));
  console.log('SCRAPER TEST - YourSource');
  console.log('='.repeat(60));
  console.log(`Debug output: ${DEBUG_DIR}`);
  console.log();

  const startTime = Date.now();
  const events = await scrapeYourSource();
  const duration = Date.now() - startTime;

  console.log();
  console.log(`Completed in ${(duration / 1000).toFixed(1)}s`);
  console.log(`Found ${events.length} events`);
  console.log();
  console.log('Debug files saved to:', DEBUG_DIR);
  console.log('  - 01-raw-api-response.json');
  console.log('  - 02-transformed-events.json');
  console.log('  - 03-final-events.json');
  console.log('  - 04-validation-report.txt');
  console.log();
  console.log('Next steps:');
  console.log('  1. Review validation report: cat ' + path.join(DEBUG_DIR, '04-validation-report.txt'));
  console.log('  2. Check timezone handling in sample events');
  console.log('  3. Verify field mapping in transformed events');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
```

---

# PHASE 3: VALIDATION

After running the test script, validate the output thoroughly.

## Step 3.1: Review Raw Data

```bash
# Check raw API response structure
cat debug-scraper-yoursource/01-raw-api-response.json | head -100

# Count events in raw response
grep -c '"id"' debug-scraper-yoursource/01-raw-api-response.json
```

## Step 3.2: Verify Timezone Handling

This is critical! Events must display at the correct local time.

```bash
# Check validation report
cat debug-scraper-yoursource/04-validation-report.txt

# Look for midnight times (often indicates timezone issues)
grep "MIDNIGHT" debug-scraper-yoursource/04-validation-report.txt

# Compare UTC vs Eastern times in sample events
grep -A1 "Date (UTC)" debug-scraper-yoursource/04-validation-report.txt
```

**Common timezone issues:**
- If Eastern time shows wrong hour: API might return UTC, use `new Date()` directly
- If dates are off by one day: midnight edge case, use `parseAsEastern()`
- If times are all midnight: source doesn't provide time, set `timeUnknown: true`

## Step 3.3: Verify Field Mapping

```bash
# Check transformed events have all required fields
cat debug-scraper-yoursource/02-transformed-events.json | \
  jq '.[0] | keys'

# Check for empty/null required fields
cat debug-scraper-yoursource/03-final-events.json | \
  jq '.[] | select(.title == null or .title == "")'

# Check URL uniqueness (critical for deduplication)
cat debug-scraper-yoursource/03-final-events.json | \
  jq -r '.[].url' | sort | uniq -d
```

## Step 3.4: Verify Data Quality

```bash
# Check price formatting
cat debug-scraper-yoursource/03-final-events.json | \
  jq -r '.[].price' | sort | uniq -c | sort -rn

# Check location values
cat debug-scraper-yoursource/03-final-events.json | \
  jq -r '.[].location' | sort | uniq -c | sort -rn

# Check for HTML entities in titles (should be decoded)
grep -E '&amp;|&quot;|&#' debug-scraper-yoursource/03-final-events.json
```

---

# PHASE 4: DATABASE TESTING

Test inserting events into the database and verify they display correctly.

## Step 4.1: Create Database Test Script

Create `scripts/test-yoursource-db.ts`:

```typescript
import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

// Load the final events from debug folder
const DEBUG_DIR = path.join(process.cwd(), 'debug-scraper-yoursource');
const finalEventsPath = path.join(DEBUG_DIR, '03-final-events.json');

async function main() {
  console.log('='.repeat(60));
  console.log('DATABASE TEST - YourSource');
  console.log('='.repeat(60));

  // Load scraped events
  const scrapedEvents = JSON.parse(fs.readFileSync(finalEventsPath, 'utf-8'));

  // Convert date strings back to Date objects
  for (const event of scrapedEvents) {
    event.startDate = new Date(event.startDate);
  }

  console.log(`Loaded ${scrapedEvents.length} events from debug folder`);

  // Insert only first 5 events for testing
  const testEvents = scrapedEvents.slice(0, 5);
  console.log(`\nInserting ${testEvents.length} test events...`);

  for (const event of testEvents) {
    try {
      await db.insert(events).values({
        sourceId: event.sourceId,
        source: event.source,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        location: event.location,
        organizer: event.organizer,
        price: event.price,
        url: event.url,
        imageUrl: event.imageUrl,
        tags: [],
        timeUnknown: event.timeUnknown || false,
      }).onConflictDoUpdate({
        target: events.url,
        set: {
          title: event.title,
          startDate: event.startDate,
        },
      });
      console.log(`  ✓ Inserted: ${event.title.slice(0, 50)}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${event.title.slice(0, 50)}`, err);
    }
  }

  // Query back and verify
  console.log('\n--- VERIFICATION ---\n');

  const inserted = await db.select()
    .from(events)
    .where(eq(events.source, 'YOUR_SOURCE'))
    .limit(10);

  console.log(`Found ${inserted.length} events with source='YOUR_SOURCE'\n`);

  for (const event of inserted) {
    console.log(`Title: ${event.title}`);
    console.log(`  DB startDate: ${event.startDate}`);
    console.log(`  As Eastern: ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`  Price: ${event.price}`);
    console.log(`  URL: ${event.url}`);
    console.log();
  }

  // Cleanup prompt
  console.log('---');
  console.log('To remove test events:');
  console.log(`  DELETE FROM events WHERE source = 'YOUR_SOURCE';`);
}

main().catch(err => {
  console.error('Database test failed:', err);
  process.exit(1);
});
```

## Step 4.2: Run Database Test

```bash
npx tsx scripts/test-yoursource-db.ts
```

## Step 4.3: Verify in UI

1. Start dev server: `npm run dev`
2. Open http://localhost:3000
3. Search for one of the test events
4. Verify:
   - Title displays correctly (no HTML entities)
   - Date/time shows correct Eastern time
   - Price displays correctly
   - Image loads (if applicable)
   - Link works

## Step 4.4: Clean Up Test Data

```sql
DELETE FROM events WHERE source = 'YOUR_SOURCE';
```

---

# PHASE 5: PRODUCTION INTEGRATION

Once validation passes, integrate with the cron job.

## Step 5.1: Update Cron Route

Edit `app/api/cron/route.ts`:

```typescript
// Add import
import { scrapeYourSource } from '@/lib/scrapers/yoursource';

// Add to Promise.allSettled array (around line 55)
const [
  avlResult,
  ebResult,
  // ... existing scrapers
  yourSourceResult,  // Add this
] = await Promise.allSettled([
  scrapeAvlToday(),
  scrapeEventbrite(25),
  // ... existing scrapers
  scrapeYourSource(),  // Add this
]);

// Extract results (around line 75)
const yourSourceEvents =
  yourSourceResult.status === 'fulfilled' ? yourSourceResult.value : [];

// Log failures (around line 90)
if (yourSourceResult.status === 'rejected')
  console.error('[Cron] YourSource scrape failed:', yourSourceResult.reason);

// Add to stats (around line 105)
stats.scraping.total =
  avlEvents.length +
  // ... existing sources
  yourSourceEvents.length;

// Transform to ScrapedEventWithTags (around line 160)
const yourSourceWithTags: ScrapedEventWithTags[] = yourSourceEvents.map(
  (e) => ({ ...e, tags: [] })
);

// Add to allEvents (around line 175)
const allEvents: ScrapedEventWithTags[] = [
  ...avlEvents,
  // ... existing sources
  ...yourSourceWithTags,
];

// Update logging (around line 115)
console.log(
  `[Cron] ... YourSource: ${yourSourceEvents.length} ...`
);
```

## Step 5.2: Test Full Cron Flow

```bash
# Set CRON_SECRET in .env, then:
curl http://localhost:3000/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Step 5.3: Verify Production Data

```bash
# Count events by source
npm run db:count

# Check specific source
npx tsx -e "
import { db } from './lib/db';
import { events } from './lib/db/schema';
import { eq } from 'drizzle-orm';

const results = await db.select().from(events).where(eq(events.source, 'YOUR_SOURCE'));
console.log('Total:', results.length);
for (const e of results.slice(0, 3)) {
  console.log(e.title, '-', e.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
"
```

---

# PHASE 6: CLEANUP

After successful integration:

```bash
# Remove debug folder (or keep for reference)
rm -rf debug-scraper-yoursource

# Remove DEBUG_DIR env var from scraper if no longer needed
# (or keep it for future debugging)
```

---

## Integration Checklist

- [ ] **Exploration**
  - [ ] Created debug folder
  - [ ] Identified data sources (API/JSON-LD/TM)
  - [ ] Documented field mapping
  - [ ] Noted timezone handling requirements

- [ ] **Development**
  - [ ] Added source to `types.ts`
  - [ ] Created scraper with debug output
  - [ ] Created test script

- [ ] **Validation**
  - [ ] Reviewed raw API response
  - [ ] Verified timezone handling (dates show correct Eastern time)
  - [ ] Verified field mapping (all required fields present)
  - [ ] Checked data quality (no HTML entities, valid URLs)

- [ ] **Database Testing**
  - [ ] Inserted test events successfully
  - [ ] Queried back and verified data integrity
  - [ ] Checked UI display
  - [ ] Cleaned up test data

- [ ] **Production**
  - [ ] Added to cron route
  - [ ] Tested full cron flow
  - [ ] Verified events in production database
  - [ ] Cleaned up debug files

---

## Common Utilities Reference

### Rate Limiting

```typescript
await new Promise(r => setTimeout(r, 500));  // Between pages
await new Promise(r => setTimeout(r, 150));  // Between requests
await new Promise(r => setTimeout(r, 3000)); // After errors
```

### Timezone Handling

```typescript
import { parseAsEastern, getEasternOffset } from '@/lib/utils/timezone';

// Parse local datetime as Eastern
const date = parseAsEastern('2025-12-25', '19:00:00');

// Get offset for date (handles DST)
const offset = getEasternOffset('2025-12-25'); // '-05:00' or '-04:00'
```

### Price Formatting

```typescript
import { formatPrice } from '@/lib/utils/formatPrice';

formatPrice(0);        // "Free"
formatPrice(25.50);    // "$26"
formatPrice(null);     // "Unknown"
```

### HTML Entity Decoding

```typescript
import { decodeHtmlEntities } from '@/lib/utils/htmlEntities';

decodeHtmlEntities('Rock &amp; Roll &#8211; Live');
// "Rock & Roll - Live"
```

### Location Filtering

```typescript
import { isNonNCEvent } from '@/lib/utils/locationFilter';

// Returns true if event should be REMOVED (not in NC)
if (isNonNCEvent(event.title, event.location)) {
  continue;
}
```

---

## Troubleshooting

### "Can't Find Events on Page" / "Content is JavaScript-Rendered"

**STOP!** This is a sign you haven't found the API yet. Do NOT jump to browser scraping.

1. **Re-check Network tab** with "Preserve log" enabled
2. **Try different interactions** - scroll, paginate, change filters
3. **Look for GraphQL** - check for `/graphql` endpoints
4. **Check for SSR data** - Next.js sites embed data in `<script id="__NEXT_DATA__">`
5. **Try URL patterns** - Add `?format=json` or `/api/` prefix
6. **Ask the user** - They may have domain knowledge about the site

If after ALL of this you still can't find an API, **ask the user before giving up**. Browser scraping is NOT an option.

### "403 Forbidden" / "429 Too Many Requests"

- Add realistic headers (User-Agent, Accept, Referer)
- Increase delays between requests
- Check if site requires cookies/sessions
- Some APIs require the `Referer` header to match the site

### Dates Off by Hours

- Check if API returns UTC vs local time
- Use `parseAsEastern()` for local times without timezone
- Verify timezone field in API response

### Missing Events

- Check pagination logic (off-by-one errors)
- Verify date range parameters
- API might filter by date - check if `startDate` param is needed

### Duplicate Events

- Ensure `url` is unique per event
- Add deduplication for multi-source scrapers

### API Returns HTML Instead of JSON

- Wrong endpoint - look for a different API path
- Missing `Accept: application/json` header
- Site may not have a public API - check for JSON-LD instead
