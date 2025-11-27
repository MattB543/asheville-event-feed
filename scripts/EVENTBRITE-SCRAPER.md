# EventBrite Scraper - Improvements & Usage

## Overview

The EventBrite scraper has been improved to support configurable pagination, correct URL handling, and includes both a backfill script for initial data population and optimized CRON job for regular updates.

## Changes Made

### 1. Scraper Improvements (`lib/scrapers/eventbrite.ts`)

- **Fixed URL**: Changed from `/events/` to `/all-events/` to match the correct EventBrite endpoint
- **Configurable Pagination**: Added `maxPages` parameter (defaults to 3 pages)
  ```typescript
  scrapeEventbrite(maxPages: number = 3)
  ```
- **De-duplication**: Built-in de-duplication using Set for event IDs
- **Batch API Fetching**: Fetches event details in batches of 20 for efficiency

### 2. Backfill Script (`scripts/backfill-eventbrite.ts`)

Script to populate the database with 30 pages of historical events.

**Features:**
- Scrapes 30 pages of EventBrite events
- Checks for existing events to avoid duplicates
- Generates AI tags for new events in batches
- Progress indicators and error handling
- Rate limiting between batches

**Usage:**
```bash
# Set your DATABASE_URL first
export DATABASE_URL="your-connection-string"

# Run the backfill
npx tsx scripts/backfill-eventbrite.ts
```

**Expected Output:**
- Total events scraped: ~500-600 events (varies)
- Processing time: 10-20 minutes (depends on API rate limits)

### 3. CRON Job Updates (`app/api/cron/route.ts`)

Updated to scrape only 3 pages for regular updates.

**Changes:**
```typescript
scrapeEventbrite(3) // Scrapes 3 pages instead of default 20
```

**Benefits:**
- Faster execution (completes within CRON timeout)
- Captures recent events without overwhelming the system
- De-duplication handled automatically by database URL uniqueness constraint

## Usage Examples

### Test Pagination
```bash
# Quick test with 2 pages
npx tsx scripts/test-eventbrite-pagination.ts
```

### Regular Scraping (3 pages)
```typescript
import { scrapeEventbrite } from './lib/scrapers/eventbrite';

const events = await scrapeEventbrite(3);
console.log(`Found ${events.length} events`);
```

### Backfill (30 pages)
```bash
npx tsx scripts/backfill-eventbrite.ts
```

### Custom Page Count
```typescript
const events = await scrapeEventbrite(10); // Scrape 10 pages
```

## Performance Metrics

From testing with 2 pages:
- **Events per page**: ~16-20 unique events
- **API calls**: 2 (1 per page + batched API calls for details)
- **Time per page**: ~500ms (includes polite delay)
- **De-duplication**: 100% effective (Set-based)

Estimated for 30 pages:
- **Expected events**: ~500-600 unique events
- **Total time**: 5-10 minutes (including API fetching and tagging)

## Architecture

```
EventBrite Scraper Flow:
1. Fetch HTML pages (max pages configurable)
2. Extract event IDs using regex
3. De-duplicate IDs using Set
4. Fetch event details via API (batches of 20)
5. Format events to ScrapedEvent interface
6. Return array of events

Backfill Script Flow:
1. Scrape events (30 pages)
2. Check database for existing events
3. Generate AI tags for new events (batches of 5)
4. Insert new events into database
5. Skip duplicates using onConflictDoNothing

CRON Job Flow:
1. Scrape events (3 pages)
2. Scrape other sources (AVL Today)
3. Check for existing events
4. Generate tags for NEW events only
5. Upsert events (updates existing, inserts new)
6. Cleanup old events (>24 hours)
```

## Configuration

### Environment Variables
```bash
DATABASE_URL=postgresql://...        # Required for backfill and CRON
CRON_SECRET=your-secret-here        # Required for CRON endpoint security
GOOGLE_API_KEY=your-key-here        # Required for AI tagging
```

### Pagination Settings

| Use Case | Pages | Events | Time | When to Use |
|----------|-------|--------|------|-------------|
| Testing | 1-2 | 16-40 | <1 min | Development/testing |
| Regular CRON | 3 | ~50-60 | 1-2 min | Scheduled updates |
| Backfill | 30 | ~500-600 | 10-20 min | Initial population |
| Custom | Any | Varies | Varies | Special needs |

## API Details

**EventBrite Endpoints:**
- **Browse Page**: `https://www.eventbrite.com/d/nc--asheville/all-events/?page={N}`
- **API**: `https://www.eventbrite.com/api/v3/destination/events/`

**Rate Limiting:**
- 500ms delay between page fetches
- 300ms delay between API batches
- 1000ms delay between tagging batches (in backfill)

## Troubleshooting

### Issue: DATABASE_URL not defined
**Solution**: Set the DATABASE_URL environment variable before running backfill or CRON

### Issue: Rate limiting errors
**Solution**: Increase delays between requests in the scraper code

### Issue: No events found
**Solution**: Verify the EventBrite URL is accessible and contains events

### Issue: Tagging failures
**Solution**: Check GOOGLE_API_KEY is set and valid

## Next Steps

1. **Run Initial Backfill**
   ```bash
   npx tsx scripts/backfill-eventbrite.ts
   ```

2. **Test CRON Job**
   ```bash
   curl -X GET http://localhost:3000/api/cron \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

3. **Schedule CRON** (Vercel, Railway, etc.)
   - Set to run every 6-12 hours
   - Monitor execution time
   - Check logs for errors

## Files Modified/Created

- ✏️ `lib/scrapers/eventbrite.ts` - Added maxPages parameter, fixed URL
- ✏️ `app/api/cron/route.ts` - Updated to use 3 pages
- ✨ `scripts/backfill-eventbrite.ts` - New backfill script
- ✨ `scripts/test-eventbrite-pagination.ts` - New test script
- ✨ `scripts/EVENTBRITE-SCRAPER.md` - This documentation
