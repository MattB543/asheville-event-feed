# CLAUDE.md - Asheville Event Feed

## Project Overview

Asheville Event Feed (AVL GO) is a Next.js web application that aggregates local events from 10+ sources for the Asheville, NC area. It features AI-powered event tagging, image generation, semantic search, and user authentication with Supabase.

### Core Functionality

- **Event Aggregation**: Scrapes events from 10+ sources (AVL Today, Eventbrite, Meetup, Facebook, venue calendars, and more)
- **AI Enhancement**: Auto-generates tags, images, summaries, and embeddings using Google Gemini and Azure OpenAI
- **Semantic Search**: Vector similarity search via pgvector for intelligent event discovery
- **AI Chat**: Conversational event discovery powered by Azure OpenAI / OpenRouter
- **User Authentication**: Supabase Auth with Google OAuth
- **Curator Profiles**: Public curated event lists at `/u/[slug]`
- **User Preferences**: Server-synced filtering preferences
- **Data Management**: PostgreSQL with automatic deduplication (rule-based + AI-powered)

---

Reminders for Claude:

- Only make changes that are directly requested or very obvious next steps. Keep solutions simple and focused.
- Always read and understand relevant files before proposing edits. Do not speculate about code you have not inspected.

---

## Tech Stack

| Layer            | Technology                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| Framework        | Next.js 16 (App Router)                                                                 |
| Language         | TypeScript                                                                              |
| Database         | PostgreSQL (Supabase) with pgvector                                                     |
| ORM              | Drizzle ORM                                                                             |
| AI - Tagging     | Google Gemini (`gemini-2.5-flash`)                                                      |
| AI - Images      | Google Gemini (`gemini-2.5-flash-image`)                                                |
| AI - Embeddings  | Google Gemini (`gemini-embedding-001`, 1536 dimensions)                                 |
| AI - Summaries   | Azure OpenAI (`gpt-5-mini` or configurable)                                             |
| AI - Chat        | Azure OpenAI + OpenRouter fallback                                                      |
| Authentication   | Supabase Auth + Google OAuth                                                            |
| Image Storage    | Supabase Storage                                                                        |
| Styling          | Tailwind CSS v4                                                                         |
| Deployment       | Vercel (with Fluid Compute + cron jobs)                                                 |
| Image Processing | Sharp (compression)                                                                     |

---

## Directory Structure

```
asheville-event-feed/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── cron/
│   │   │   ├── scrape/route.ts   # Scraping cron (every 6h)
│   │   │   ├── ai/route.ts       # AI processing cron (every 6h, +10min)
│   │   │   ├── cleanup/route.ts  # Dead event cleanup (8x daily)
│   │   │   └── dedup/route.ts    # AI deduplication (daily 5AM ET)
│   │   ├── chat/route.ts         # AI conversational discovery
│   │   ├── preferences/route.ts  # User preferences sync
│   │   ├── events/
│   │   │   ├── [id]/favorite/    # Event favoriting
│   │   │   ├── submit/           # Event submission (form)
│   │   │   ├── submit-url/       # Event submission (URL)
│   │   │   └── report/           # Event reporting
│   │   ├── export/
│   │   │   ├── xml/              # RSS XML export
│   │   │   └── markdown/         # Markdown export
│   │   ├── curate/               # Curate events
│   │   ├── curator/
│   │   │   ├── settings/         # Curator profile settings
│   │   │   └── [slug]/           # Public curator data
│   │   └── health/route.ts       # Health check
│   ├── auth/
│   │   ├── callback/route.ts     # OAuth callback
│   │   ├── confirm/route.ts      # Email confirmation
│   │   └── signout/route.ts      # Sign out
│   ├── events/[slug]/page.tsx    # Individual event pages
│   ├── login/page.tsx            # Login page
│   ├── profile/page.tsx          # User profile
│   ├── u/[slug]/page.tsx         # Curator profiles
│   ├── globals.css               # Tailwind imports
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Main page (SSR event fetch)
├── components/
│   ├── AIChatModal.tsx           # AI chat interface
│   ├── AuthProvider.tsx          # Auth context provider
│   ├── CurateModal.tsx           # Curate event modal
│   ├── CuratedEventList.tsx      # Curated events display
│   ├── CuratorProfileCard.tsx    # Curator profile display
│   ├── CuratorProfileSettings.tsx # Curator settings form
│   ├── ErrorBoundary.tsx         # React error boundary
│   ├── EventCard.tsx             # Individual event display
│   ├── EventCardSkeleton.tsx     # Loading skeleton
│   ├── EventFeed.tsx             # Main feed with filtering
│   ├── FilterBar.tsx             # Search/filter UI
│   ├── GoogleSignInButton.tsx    # Google OAuth button
│   ├── SettingsModal.tsx         # Block hosts/keywords settings
│   ├── SubmitEventButton.tsx     # Submit event trigger
│   ├── SubmitEventModal.tsx      # Event submission form
│   ├── ThemeProvider.tsx         # Dark mode provider
│   ├── ThemeToggle.tsx           # Dark/light toggle
│   ├── UserMenu.tsx              # User account menu
│   └── Providers.tsx             # Combined providers
├── lib/
│   ├── ai/
│   │   ├── client.ts             # Gemini client (tagging + embeddings)
│   │   ├── azure-client.ts       # Azure OpenAI client
│   │   ├── tagging.ts            # AI tag generation
│   │   ├── imageGeneration.ts    # AI image generation + Supabase upload
│   │   ├── summary.ts            # AI summary generation
│   │   ├── embedding.ts          # Vector embedding generation
│   │   ├── aiDeduplication.ts    # AI-powered duplicate detection
│   │   └── dataEnrichment.ts     # Price/time extraction
│   ├── cache/
│   │   └── invalidation.ts       # Cache invalidation utilities
│   ├── config/
│   │   ├── defaultFilters.ts     # Default spam filter keywords
│   │   ├── env.ts                # Environment variable handling
│   │   ├── tagCategories.ts      # Tag categorization
│   │   └── zipNames.ts           # Zip code mappings
│   ├── db/
│   │   ├── index.ts              # Database connection (lazy proxy)
│   │   ├── schema.ts             # Drizzle schema definition
│   │   └── similaritySearch.ts   # Vector similarity queries
│   ├── hooks/
│   │   ├── useDebounce.ts        # Debounce hook for search
│   │   └── usePreferenceSync.ts  # Preference sync hook
│   ├── notifications/
│   │   └── slack.ts              # Slack webhook notifications
│   ├── scrapers/
│   │   ├── avltoday.ts           # AVL Today/CitySpark
│   │   ├── eventbrite.ts         # Eventbrite
│   │   ├── meetup.ts             # Meetup GraphQL
│   │   ├── facebook.ts           # Facebook (main)
│   │   ├── facebook-*.ts         # Facebook variants (4 files)
│   │   ├── harrahs.ts            # Harrah's Cherokee Center
│   │   ├── orangepeel.ts         # Orange Peel
│   │   ├── greyeagle.ts          # Grey Eagle
│   │   ├── livemusicavl.ts       # Live Music Asheville
│   │   ├── exploreasheville.ts   # Explore Asheville
│   │   ├── misfitimprov.ts       # Misfit Improv
│   │   ├── udharma.ts            # UDharma
│   │   ├── ncstage.ts            # NC Stage
│   │   ├── storyparlor.ts        # Story Parlor
│   │   └── types.ts              # Shared scraper types
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client
│   │   ├── server.ts             # Server Supabase client
│   │   ├── middleware.ts         # Auth middleware
│   │   ├── preferences.ts        # Preferences sync logic
│   │   ├── storage.ts            # Image storage utilities
│   │   └── curatorProfile.ts     # Curator profile queries
│   └── utils/
│       ├── auth.ts               # Auth token verification
│       ├── deduplication.ts      # Rule-based deduplication
│       ├── formatPrice.ts        # Price string formatting
│       ├── icsGenerator.ts       # ICS calendar export
│       ├── locationFilter.ts     # NC location filtering
│       ├── retry.ts              # Fetch retry utility
│       ├── slugify.ts            # URL slug generation
│       └── ...                   # Additional utilities
├── scripts/                      # CLI utility scripts
└── drizzle.config.ts             # Drizzle Kit configuration
```

---

## Database Schema

PostgreSQL database hosted on Supabase with pgvector extension.

### `events` Table

```typescript
{
  id: uuid (primary key, auto-generated),
  sourceId: text (ID from source platform),
  source: text ('AVL_TODAY' | 'EVENTBRITE' | 'MEETUP' | 'FACEBOOK' | ...),
  title: text,
  description: text (nullable),
  startDate: timestamp with timezone,
  location: text (nullable),
  zip: text (nullable),
  organizer: text (nullable),
  price: text (nullable, e.g., "$20", "Free", "Unknown"),
  url: text (unique constraint - prevents duplicates),
  imageUrl: text (nullable, Supabase Storage URL or external),
  tags: text[] (array of tag strings),
  createdAt: timestamp (default now),
  updatedAt: timestamp (when event data changes),
  lastSeenAt: timestamp (every time scraper sees event),
  hidden: boolean (default false, for admin moderation),
  // Facebook engagement
  interestedCount: integer (Facebook interested count),
  goingCount: integer (Facebook going count),
  // Recurring events
  timeUnknown: boolean (true if source only provided date),
  recurringType: text ('daily' | null),
  recurringEndDate: timestamp (when recurring event ends),
  // User engagement
  favoriteCount: integer (default 0),
  // AI-generated fields
  aiSummary: text (1-2 sentence structured summary),
  embedding: vector(1536) (Gemini embedding for semantic search)
}
```

**Indexes**: `startDate`, `source`, `tags` (GIN), `embedding` (HNSW for cosine similarity)

### `submittedEvents` Table

User-submitted event suggestions awaiting review.

### `userPreferences` Table

Server-synced user preferences (blocked hosts, keywords, hidden events, favorites, email digests).

```typescript
{
  userId: uuid (primary key, from Supabase auth),
  blockedHosts: text[] (organizers to hide),
  blockedKeywords: text[] (keywords to hide),
  hiddenEvents: jsonb (array of {title, organizer} fingerprints),
  useDefaultFilters: boolean (default true),
  favoritedEventIds: text[] (event IDs),
  filterSettings: jsonb (optional filter settings),
  // Email digest settings
  emailDigestFrequency: text ('none' | 'daily' | 'weekly'),
  emailDigestLastSentAt: timestamp (when last digest was sent),
  emailDigestTags: text[] (optional tag filter for digests),
  updatedAt: timestamp
}
```

### `curatorProfiles` Table

Curator profile data (slug, display name, bio, public visibility).

### `curatedEvents` Table

Events curated by users with optional notes.

---

## API Routes

### Cron Jobs (require `Authorization: Bearer {CRON_SECRET}`)

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/scrape` | Every 6h at :00 | Scrape all sources, upsert to DB, rule-based dedup |
| `/api/cron/ai` | Every 6h at :10 | AI tagging, summaries, embeddings, image generation |
| `/api/cron/cleanup` | 8x daily | Dead events, non-NC, cancelled, duplicates |
| `/api/cron/dedup` | Daily 5 AM ET | AI semantic deduplication |
| `/api/cron/email-digest` | Daily 7 AM ET | Send daily/weekly email digests to subscribers |

### Public APIs

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/health` | GET | Health check (DB status, event count) |
| `/api/chat` | POST | AI conversational event discovery (rate limited) |
| `/api/export/xml` | GET | RSS XML feed export |
| `/api/export/markdown` | GET | Markdown export |
| `/api/events/submit` | POST | Submit event via form |
| `/api/events/submit-url` | POST | Submit event via URL |
| `/api/events/report` | POST | Report an event |
| `/api/curator/[slug]` | GET | Public curator profile data |

### Authenticated APIs (require Supabase Auth)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/preferences` | GET/POST | Sync user preferences |
| `/api/events/[id]/favorite` | POST/DELETE | Favorite/unfavorite event |
| `/api/curate` | POST/DELETE | Add/remove curated events |
| `/api/curator/settings` | GET/POST | Curator profile settings |
| `/api/email-digest/settings` | GET/POST | Email digest preferences |

### Auth Routes

| Route | Purpose |
|-------|---------|
| `/auth/callback` | OAuth callback handler |
| `/auth/confirm` | Email confirmation |
| `/auth/signout` | Sign out |

---

## Scrapers

| Source | File | Method | Notes |
|--------|------|--------|-------|
| AVL_TODAY | `avltoday.ts` | CitySpark API | POST to portal.cityspark.com |
| EVENTBRITE | `eventbrite.ts` | HTML + API | Browse page scrape + API details |
| MEETUP | `meetup.ts` | GraphQL | Public API, location-based |
| FACEBOOK | `facebook.ts` | Browser automation | Disabled on Vercel (requires Playwright) |
| HARRAHS | `harrahs.ts` | Ticketmaster API + HTML | Harrah's Cherokee Center |
| ORANGE_PEEL | `orangepeel.ts` | Ticketmaster API + JSON-LD | The Orange Peel venue |
| GREY_EAGLE | `greyeagle.ts` | JSON-LD | Grey Eagle Taqueria |
| LIVE_MUSIC_AVL | `livemusicavl.ts` | ICS feeds | Select venues only |
| EXPLORE_ASHEVILLE | `exploreasheville.ts` | Public API | Tourism board events |
| MISFIT_IMPROV | `misfitimprov.ts` | Crowdwork API | Improv comedy shows |
| UDHARMA | `udharma.ts` | Squarespace API | Meditation/yoga events |
| NC_STAGE | `ncstage.ts` | ThunderTix | NC Stage Company theater |
| STORY_PARLOR | `storyparlor.ts` | Squarespace JSON-LD | Storytelling events |

---

## AI Integration

### Tagging (`lib/ai/tagging.ts`)

- **Model**: `gemini-2.5-flash`
- **Input**: Event title, description, location, organizer, date
- **Output**: JSON array of tag strings
- **Categories**: Entertainment, Food & Drink, Activities, Audience/Social, Other

### Image Generation (`lib/ai/imageGeneration.ts`)

- **Model**: `gemini-2.5-flash-image` (configurable via `GEMINI_IMAGE_MODEL`)
- **Output**: Uploaded to Supabase Storage, returns public URL
- **Compression**: Sharp resizes to 512px width, 80% JPEG quality
- **Prompt**: Generates promotional event graphics with Asheville mountain vibe

### Summaries (`lib/ai/summary.ts`)

- **Model**: Azure OpenAI (`gpt-5-mini` or configurable)
- **Output**: 1-2 sentence structured summary optimized for semantic search
- **Format**: "[Event type] at [venue] featuring [key details]."

### Embeddings (`lib/ai/embedding.ts`)

- **Model**: `gemini-embedding-001`
- **Dimensions**: 1536
- **Input**: `"${title}: ${aiSummary}"`
- **Used for**: Semantic search, similarity matching

### AI Deduplication (`lib/ai/aiDeduplication.ts`)

- **Model**: Azure OpenAI
- **Purpose**: Catch semantic duplicates rule-based dedup misses
- **Process**: Groups events by date, asks AI to identify duplicates

### AI Chat (`app/api/chat/route.ts`)

- **Primary**: Azure OpenAI (streaming)
- **Fallback**: OpenRouter (google/gemini-2.0-flash)
- **Features**: Date extraction, event filtering, curated recommendations

---

## Environment Variables

```bash
# ===========================================
# REQUIRED
# ===========================================

# PostgreSQL connection string (Supabase)
# Use the "Connection Pooler" URL from Supabase Dashboard -> Settings -> Database
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# ===========================================
# OPTIONAL - Cron Jobs
# ===========================================

# Secret for authenticating cron endpoint calls (min 16 chars)
CRON_SECRET=your-random-secret-here

# ===========================================
# OPTIONAL - AI Features (Google Gemini)
# ===========================================

# Google Gemini API key - enables tagging, images, embeddings
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

# ===========================================
# OPTIONAL - AI Features (Azure OpenAI)
# ===========================================

# Azure OpenAI - enables summaries, AI dedup, chat
AZURE_OPENAI_API_KEY=        # or AZURE_KEY_1
AZURE_OPENAI_ENDPOINT=       # or AZURE_ENDPOINT
AZURE_OPENAI_DEPLOYMENT=     # default: gpt-5-mini
AZURE_OPENAI_API_VERSION=    # default: 2024-12-01-preview

# ===========================================
# OPTIONAL - AI Chat (OpenRouter fallback)
# ===========================================

OPENROUTER_API_KEY=

# ===========================================
# OPTIONAL - Supabase Auth
# ===========================================

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google OAuth Client ID
NEXT_PUBLIC_GOOGLE_CLIENT_ID=

# ===========================================
# OPTIONAL - Notifications
# ===========================================

SLACK_WEBHOOK=

# ===========================================
# OPTIONAL - Email Digests (Postmark)
# ===========================================

# Postmark API - enables daily/weekly email digests
POSTMARK_API_KEY=
POSTMARK_FROM_EMAIL=hello@avlgo.com

# ===========================================
# OPTIONAL - Facebook Scraping (Advanced)
# ===========================================
# Requires browser automation, won't work on Vercel

FB_ENABLED=false
FB_C_USER=
FB_XS=
# ... (see .env.example for full list)
```

---

## Key Features

### Authentication

- Supabase Auth with Google OAuth
- `AuthProvider` component wraps app
- `UserMenu` component for account actions
- Server-side session validation

### User Preferences Sync

- Preferences stored in localStorage (offline-first)
- Synced to `userPreferences` table when authenticated
- Includes: blocked hosts, blocked keywords, hidden events, favorites

### Curator Profiles

- Users can create public profiles at `/u/[slug]`
- Curate events with optional notes (280 char max)
- Profile includes display name and bio (500 char max)

### Semantic Search

- Events get AI summaries and embeddings
- pgvector HNSW index for fast similarity search
- Used by AI chat for intelligent recommendations

### Event Submission

- Public form at `/api/events/submit`
- URL-based submission at `/api/events/submit-url`
- Events go to `submittedEvents` table for review

### Dark Mode

- `next-themes` for theme management
- `ThemeToggle` component
- Persists preference in localStorage

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run test:avl` | Test AVL Today scraper |
| `npm run test:eventbrite` | Test Eventbrite scraper |
| `npm run test:meetup` | Test Meetup scraper |
| `npm run test:harrahs` | Test Harrah's scraper |
| `npm run test:orangepeel` | Test Orange Peel scraper |
| `npm run test:greyeagle` | Test Grey Eagle scraper |
| `npm run test:storyparlor` | Test Story Parlor scraper |
| `npm run test:misfit` | Test Misfit Improv scraper |
| `npm run test:udharma` | Test UDharma scraper |
| `npm run test:tagging` | Test AI tag generation |
| `npm run test:image-gen` | Test AI image generation |
| `npm run test:summary` | Test AI summary generation |
| `npm run test:embedding` | Test embedding generation |
| `npm run test:similarity` | Test similarity search |
| `npm run db:check` | Check database connection |
| `npm run db:count` | Count events by source |
| `npm run db:tags` | Check tag statistics |
| `npm run db:clear` | Clear all events (destructive!) |
| `npm run backfill` | Backfill Eventbrite events |
| `npm run backfill:embeddings` | Backfill embeddings for existing events |
| `npm run tag:events` | Tag all untagged events |
| `npm run generate:seo-images` | Generate SEO images |

---

## Deployment

### Vercel Configuration (`vercel.json`)

```json
{
  "fluid": true,
  "crons": [
    { "path": "/api/cron/scrape", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/ai", "schedule": "10 */6 * * *" },
    { "path": "/api/cron/cleanup", "schedule": "30 1,4,7,10,13,16,19,22 * * *" },
    { "path": "/api/cron/dedup", "schedule": "0 10 * * *" },
    { "path": "/api/cron/email-digest", "schedule": "0 12 * * *" }
  ]
}
```

- **Fluid Compute**: Enabled for longer function execution (up to 800s for scrape/ai jobs)
- **Cron Schedule**: Scrape at :00, AI processing at :10, cleanup 8x daily, dedup daily at 5 AM ET, email digests daily at 7 AM ET

### Max Duration

- `/api/cron/scrape`: 800s (13+ minutes, requires Fluid Compute)
- `/api/cron/ai`: 800s (13+ minutes, requires Fluid Compute)
- `/api/cron/cleanup`: 300s (5 minutes)
- `/api/cron/dedup`: 300s (5 minutes)

### Manual Cron Trigger

```bash
curl -X GET https://your-domain.vercel.app/api/cron/scrape \
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

### AI summaries not generating

- Verify Azure OpenAI credentials are set
- Check `isAzureAIEnabled()` returns true

### Events not appearing

- Check if filtered by default spam filter (Settings -> disable)
- Verify events are in NC (location filter may be removing them)
- Check database has events: `npm run db:count`

### Duplicate events appearing

- Run cleanup: `curl /api/cron/cleanup -H "Authorization: Bearer ..."`
- Rule-based dedup runs in scrape job
- AI dedup runs daily at 5 AM ET

### Images not loading

- AI-generated images are now in Supabase Storage
- Check Supabase Storage bucket permissions
- Legacy base64 images may still exist for older events

---

## Data Flow

```
[Scraper Sources]
    │
    ├── AVL Today API ─────┐
    ├── Eventbrite ────────┤
    ├── Meetup GraphQL ────┤
    ├── Facebook* ─────────┤
    ├── Harrah's ──────────┼──▶ [Scraped Events]
    ├── Orange Peel ───────┤         │
    ├── Grey Eagle ────────┤         ▼
    ├── Live Music AVL ────┤   [Location Filter]
    ├── Explore Asheville ─┤   (remove non-NC)
    ├── Misfit Improv ─────┤         │
    ├── UDharma ───────────┤         ▼
    ├── NC Stage ──────────┤   [Upsert to DB]
    └── Story Parlor ──────┘   (scrape job)
                                     │
                                     ▼
                            [AI Processing Job]
                            (tags, summaries,
                             embeddings, images)
                                     │
                                     ▼
                            [Cleanup Job]
                            (dead, non-NC,
                             cancelled, dupes)
                                     │
                                     ▼
                            [AI Dedup Job]
                            (semantic dupes)
                                     │
                                     ▼
                              [SSR Page Load]
                                     │
                                     ▼
                            [Client Filtering]
                            (search, price,
                             blocked, tags)
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
# Edit .env with your Supabase DATABASE_URL and optional API keys

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
curl http://localhost:3000/api/cron/scrape -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## Code Quality Notes

- **TypeScript strict mode**: Enabled
- **No test framework**: Uses manual script-based testing
- **Component styling**: Inline Tailwind classes
- **State management**: React hooks + Supabase for persistence
- **Theme**: next-themes for dark mode support
