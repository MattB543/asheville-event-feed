# CLAUDE.md - Asheville Event Feed

## Project Overview

Asheville Event Feed is a Next.js web application that aggregates local events from multiple sources (AVL Today, Eventbrite, and Meetup) for the Asheville, NC area. It features AI-powered event tagging and image generation using Google Gemini, client-side filtering, and user preferences for blocking unwanted content.

### Core Functionality

- **Event Aggregation**: Scrapes events from 3 sources (AVL Today/CitySpark API, Eventbrite, Meetup GraphQL)
- **AI Enhancement**: Auto-generates tags and images for events using Google Gemini
- **User Filtering**: Client-side search, price filters, blocked hosts/keywords, hidden events
- **Data Management**: PostgreSQL database with automatic deduplication and cleanup

---

Reminders for Claude:

- Only make changes that are directly requested or very obvious next steps. Keep solutions simple and focused.
- Always read and understand relevant files before proposing edits. Do not speculate about code you have not inspected.

---

## Tech Stack

| Layer            | Technology                                                                        |
| ---------------- | --------------------------------------------------------------------------------- |
| Framework        | Next.js 16 (App Router)                                                           |
| Language         | TypeScript                                                                        |
| Database         | PostgreSQL (Neon serverless)                                                      |
| ORM              | Drizzle ORM                                                                       |
| AI               | Google Gemini (gemini-2.5-flash-lite for tags, gemini-2.5-flash-image for images) |
| Styling          | Tailwind CSS v4                                                                   |
| Deployment       | Vercel (with cron jobs)                                                           |
| Image Processing | Sharp (compression)                                                               |

---

## Directory Structure

```
asheville-event-feed/
├── app/                      # Next.js App Router
│   ├── api/
│   │   ├── cron/
│   │   │   ├── route.ts      # Main scraping cron (runs every 6h)
│   │   │   └── cleanup/
│   │   │       └── route.ts  # Dead event cleanup (runs every 3h)
│   │   └── health/
│   │       └── route.ts      # Health check endpoint
│   ├── globals.css           # Tailwind imports
│   ├── layout.tsx            # Root layout with Inter font
│   └── page.tsx              # Main page (SSR event fetch)
├── components/
│   ├── ErrorBoundary.tsx     # React error boundary
│   ├── EventCard.tsx         # Individual event display
│   ├── EventFeed.tsx         # Main feed with filtering logic
│   ├── FilterBar.tsx         # Search/price filter UI
│   └── SettingsModal.tsx     # Block hosts/keywords settings
├── lib/
│   ├── ai/
│   │   ├── client.ts         # Gemini client (lazy initialization)
│   │   ├── imageGeneration.ts # AI image generation + compression
│   │   └── tagging.ts        # AI tag generation
│   ├── config/
│   │   ├── defaultFilters.ts # Default spam filter keywords
│   │   └── env.ts            # Environment variable handling
│   ├── db/
│   │   ├── index.ts          # Database connection (lazy proxy)
│   │   └── schema.ts         # Drizzle schema definition
│   ├── hooks/
│   │   └── useDebounce.ts    # Debounce hook for search
│   ├── scrapers/
│   │   ├── avltoday.ts       # AVL Today/CitySpark scraper
│   │   ├── eventbrite.ts     # Eventbrite scraper
│   │   ├── meetup.ts         # Meetup GraphQL scraper
│   │   └── types.ts          # Shared scraper types
│   └── utils/
│       ├── deduplication.ts  # Event deduplication logic
│       ├── formatPrice.ts    # Price string formatting
│       ├── locationFilter.ts # NC location filtering
│       └── retry.ts          # Fetch retry utility
├── scripts/                  # CLI utility scripts
└── drizzle.config.ts         # Drizzle Kit configuration
```

---

## Database Schema

Single table `events` in PostgreSQL:

```typescript
{
  id: uuid (primary key, auto-generated),
  sourceId: text (ID from source platform),
  source: text ('AVL_TODAY' | 'EVENTBRITE' | 'MEETUP'),
  title: text,
  description: text (nullable),
  startDate: timestamp with timezone,
  location: text (nullable),
  organizer: text (nullable),
  price: text (nullable, e.g., "$20", "Free", "Unknown"),
  url: text (unique constraint - prevents duplicates),
  imageUrl: text (nullable, stores data URLs for AI-generated images),
  tags: text[] (array of tag strings),
  createdAt: timestamp (default now),
  hidden: boolean (default false, for admin moderation)
}
```

**Key constraint**: `url` is unique, enabling upsert logic (insert or update on conflict).

---

## API Routes

### `GET /api/cron`

**Purpose**: Main scraping job  
**Auth**: Requires `Authorization: Bearer {CRON_SECRET}` header  
**Schedule**: Every 6 hours via Vercel cron  
**Behavior**:

1. Scrapes AVL Today, Eventbrite (3 pages), Meetup (3 pages), and Harrah's in parallel
2. Identifies NEW events (not in database) by URL
3. Generates AI tags for new events only (batches of 5)
4. Generates AI images for events without images or with placeholders (batches of 3)
5. Upserts all events to database
6. Runs deduplication to remove duplicate events

### `GET /api/cron/cleanup`

**Purpose**: Remove dead/invalid events  
**Auth**: Requires `Authorization: Bearer {CRON_SECRET}` header  
**Schedule**: Every 3 hours via Vercel cron  
**Behavior**:

1. Checks all Eventbrite event URLs for 404/410 status
2. Removes non-NC events using location filter
3. Removes duplicate events using deduplication logic

### `GET /api/health`

**Purpose**: Health check  
**Auth**: None  
**Returns**: Database connection status, event count, response time

---

## Scrapers

### AVL Today (`lib/scrapers/avltoday.ts`)

- **API**: `https://portal.cityspark.com/v1/events/AVLT` (POST)
- **Pagination**: Uses `skip` parameter, fetches up to 300 events
- **Rate limiting**: 200ms delay between pages
- **Key fields**: `PId` or `Id` as sourceId, `StartUTC` or `DateStart` for time

### Eventbrite (`lib/scrapers/eventbrite.ts`)

- **Step 1**: Scrape browse page HTML (`/d/nc--asheville/all-events/?page=N`)
- **Step 2**: Extract event IDs via regex from URLs
- **Step 3**: Fetch details via API (`/api/v3/destination/events/`)
- **Rate limiting**: 500ms between pages, 300ms between API batches
- **De-duplication**: Uses Set for unique IDs

### Meetup (`lib/scrapers/meetup.ts`)

- **API**: GraphQL endpoint at `https://api.meetup.com/gql-ext`
- **No authentication required** (public API)
- **Location-based**: Uses Asheville coordinates (35.5951, -82.5515)
- **Filtering**: Checks group city, group name, and event title for Asheville-area patterns
- **Image fallback**: Fetches `og:image` from event pages if GraphQL doesn't return photo

---

## AI Integration

### Tagging (`lib/ai/tagging.ts`)

- **Model**: `gemini-2.5-flash-lite`
- **Input**: Event title, description, location, organizer, date
- **Output**: JSON array of tag strings
- **Categories**: Entertainment, Food & Drink, Activities, Audience/Social, Other
- **Error handling**: Returns empty array on failure

### Image Generation (`lib/ai/imageGeneration.ts`)

- **Model**: `gemini-2.5-flash-image` (configurable via `GEMINI_IMAGE_MODEL` env var)
- **Output**: Base64 data URL (JPEG)
- **Compression**: Uses Sharp to resize to 512px width, 80% JPEG quality
- **Prompt**: Generates promotional event graphics with Asheville mountain vibe

### Client Setup (`lib/ai/client.ts`)

- **Lazy initialization**: Model created on first use (allows dotenv to load in scripts)
- **Singleton pattern**: Reuses client instance

---

## Utility Functions

### Location Filter (`lib/utils/locationFilter.ts`)

- `isNonNCEvent(title, location)`: Returns true if event should be REMOVED
- Checks for NC cities (Asheville, Black Mountain, etc.)
- Filters out SC, GA, TN, VA locations
- Used during scraping and cleanup

### Deduplication (`lib/utils/deduplication.ts`)

- **Criteria**: Same organizer + same start time + share ≥1 significant word in title
- **Keep preference**: Known price > longer description > newer createdAt
- `findDuplicates(events)`: Returns groups of duplicates
- `getIdsToRemove(groups)`: Returns IDs to delete

### Price Formatting (`lib/utils/formatPrice.ts`)

- Converts numeric/string prices to display format
- 0 → "Free", null → "Unknown", number → "$X" (rounded)

### Retry (`lib/utils/retry.ts`)

- `withRetry(fn, options)`: Generic retry wrapper with exponential backoff
- `fetchWithRetry(url, options, retryOptions)`: Fetch with automatic retries

---

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://...      # Neon PostgreSQL connection string
CRON_SECRET=your-secret-here       # Min 16 chars, for API auth

# Optional
GEMINI_API_KEY=your-key-here       # Enables AI tagging and image generation
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image  # Image generation model
```

**Important**: `lib/config/env.ts` uses `dotenv.config({ override: true })` to prefer local `.env` over OS environment variables.

---

## Default Filters

Located in `lib/config/defaultFilters.ts`, automatically hides spam events:

- Certification training (Six Sigma, PMP, etc.)
- Self-guided tours and app-based experiences
- Generic online events marketed as local
- Low-signal events (vendors needed, cancelled, etc.)

Users can disable default filters in settings and add custom keywords.

---

## Client-Side State

`components/EventFeed.tsx` manages:

- `blockedHosts`: Array of organizer names to hide
- `blockedKeywords`: Array of title keywords to hide
- `hiddenIds`: Array of specific event IDs to hide
- `useDefaultFilters`: Boolean to enable/disable default spam filter

All persisted to `localStorage` and loaded on mount (with hydration handling).

---

## Scripts Reference

| Script                    | Purpose                                |
| ------------------------- | -------------------------------------- |
| `npm run test:avl`        | Test AVL Today scraper                 |
| `npm run test:eventbrite` | Test Eventbrite scraper                |
| `npm run test:meetup`     | Test Meetup scraper                    |
| `npm run test:tagging`    | Test AI tag generation                 |
| `npm run test:image-gen`  | Test AI image generation               |
| `npm run db:check`        | Check database connection              |
| `npm run db:count`        | Count events by source                 |
| `npm run db:tags`         | Check tag statistics                   |
| `npm run db:clear`        | Clear all events (destructive!)        |
| `npm run backfill`        | Backfill 30 pages of Eventbrite events |
| `npm run tag:events`      | Tag all untagged events                |

### Standalone scripts (run with `npx tsx scripts/...`):

- `check-dead-events.ts`: Find/delete 404 Eventbrite events
- `deduplicate-events.ts`: Find/remove duplicate events
- `delete-non-nc-events.ts`: Remove events outside NC
- `generate-missing-images.ts`: Generate images for events without them
- `fix-eventbrite-organizers.ts`: Re-fetch organizer names from API

---

## Important Patterns

### Lazy Database Connection

```typescript
// lib/db/index.ts uses a Proxy for lazy initialization
export const db: DbType = new Proxy({} as DbType, {
  get(_target, prop) {
    if (!_db) _db = createDb();
    return Reflect.get(_db, prop);
  },
});
```

This allows scripts to import the db module without immediately requiring `DATABASE_URL`.

### Upsert Pattern

```typescript
await db.insert(events)
  .values({ ... })
  .onConflictDoUpdate({
    target: events.url,  // Unique constraint
    set: { title, description, ... }  // Fields to update
  });
```

### Batch Processing

Most operations use chunked batches to avoid overwhelming APIs/database:

```typescript
const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
```

### Hydration Safety

```typescript
const [isLoaded, setIsLoaded] = useState(false);
useEffect(() => {
  setIsLoaded(true);
}, []);
if (!isLoaded) return null; // Prevent hydration mismatch
```

---

## Deployment

### Vercel Configuration (`vercel.json`)

```json
{
  "crons": [
    { "path": "/api/cron", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/cleanup", "schedule": "0 */3 * * *" }
  ]
}
```

### Max Duration

API routes set `export const maxDuration = 300;` (5 minutes) for long-running scrape jobs.

### Manual Cron Trigger

```bash
curl -X GET https://your-domain.vercel.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## Common Issues & Solutions

### "DATABASE_URL is not defined"

- Ensure `.env` file exists in project root
- Check that `lib/config/env.ts` is imported before database access

### AI not generating tags/images

- Verify `GEMINI_API_KEY` is set
- Check `isAIEnabled()` returns true
- Model may be unavailable; check Gemini API status

### Events not appearing

- Check if filtered by default spam filter (Settings → disable)
- Verify events are in NC (location filter may be removing them)
- Check database has events: `npm run db:count`

### Duplicate events appearing

- Run cleanup: `npx tsx scripts/deduplicate-events.ts`
- Deduplication relies on same organizer + same time + shared word

### Images not loading

- AI-generated images are stored as base64 data URLs
- Large images may fail; compression should keep under ~50KB
- External images (from scrapers) may have CORS issues

---

## Data Flow

```
[Scraper Sources]
    │
    ├── AVL Today API ─────┐
    ├── Eventbrite HTML ───┼──▶ [Scraped Events]
    └── Meetup GraphQL ────┘         │
                                     ▼
                            [Location Filter]
                            (remove non-NC)
                                     │
                                     ▼
                            [Check Existing URLs]
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
              [New Events]                    [Existing Events]
                     │                               │
                     ▼                               │
              [AI Tagging]                           │
                     │                               │
                     ▼                               │
            [AI Image Gen]                           │
            (if no image)                            │
                     │                               │
                     └───────────────┬───────────────┘
                                     ▼
                              [Upsert to DB]
                                     │
                                     ▼
                              [SSR Page Load]
                                     │
                                     ▼
                            [Client Filtering]
                            (search, price, blocked)
                                     │
                                     ▼
                              [EventFeed UI]
```

---

## Testing Locally

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL and optional GEMINI_API_KEY

# 3. Push database schema
npx drizzle-kit push

# 4. Test scrapers
npm run test:avl
npm run test:eventbrite
npm run test:meetup

# 5. Backfill data
npm run backfill

# 6. Start dev server
npm run dev

# 7. Trigger manual scrape (in another terminal)
curl http://localhost:3000/api/cron -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## Code Quality Notes

- **No explicit linting rules**: Uses Next.js defaults
- **TypeScript strict mode**: Enabled
- **No test framework**: Uses manual script-based testing
- **Component styling**: Inline Tailwind classes, no CSS modules
- **State management**: React hooks only, no external state library

---

## Future Enhancement Ideas

1. Add Supabase or Clerk for user accounts
2. Implement server-side filtering for better performance
3. Add email notifications for saved searches
4. Create admin dashboard for content moderation
5. Add more event sources (Facebook Events, local venue calendars)
6. Implement event favoriting/calendar export
