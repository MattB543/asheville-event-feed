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
- **Poster Uploads**: Users photograph flyers at `/posters`; Gemini vision reads the events off them and inserts them with `source: 'POSTER'`
- **User Preferences**: Server-synced filtering preferences
- **Data Management**: PostgreSQL with automatic deduplication (rule-based + AI-powered)

---

Reminders for Claude:

- Only make changes that are directly requested or very obvious next steps. Keep solutions simple and focused.
- Always read and understand relevant files before proposing edits. Do not speculate about code you have not inspected.

---

## Tech Stack

| Layer            | Technology                                              |
| ---------------- | ------------------------------------------------------- |
| Framework        | Next.js 16 (App Router)                                 |
| Language         | TypeScript                                              |
| Database         | PostgreSQL (Supabase) with pgvector                     |
| ORM              | Drizzle ORM                                             |
| AI - Tagging     | Google Gemini (`gemini-2.5-flash`)                      |
| AI - Embeddings  | Google Gemini (`gemini-embedding-001`, 1536 dimensions) |
| AI - Summaries   | Azure OpenAI (`gpt-5-mini` or configurable)             |
| AI - Chat        | Azure OpenAI + OpenRouter fallback                      |
| Authentication   | Supabase Auth + Google OAuth                            |
| Image Storage    | Supabase Storage                                        |
| Styling          | Tailwind CSS v4                                         |
| Deployment       | Vercel (with Fluid Compute + cron jobs)                 |
| Image Processing | Sharp (compression)                                     |

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
│   │   ├── posters/
│   │   │   ├── upload/           # Poster upload + inline pipeline
│   │   │   └── [id]/moderate/    # Approve/deny (super admin)
│   │   └── health/route.ts       # Health check
│   ├── admin/posters/page.tsx    # Poster moderation queue (unlisted)
│   ├── posters/page.tsx          # Community poster feed
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
│   ├── posters/                  # Poster feed, upload modal, admin queue
│   └── Providers.tsx             # Combined providers
├── lib/
│   ├── ai/
│   │   ├── client.ts             # Gemini client (tagging + embeddings)
│   │   ├── azure-client.ts       # Azure OpenAI client
│   │   ├── tagging.ts            # AI tag generation
│   │   ├── summary.ts            # AI summary generation
│   │   ├── embedding.ts          # Vector embedding generation
│   │   └── aiDeduplication.ts    # AI-powered duplicate detection
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
│   ├── posters/
│   │   ├── processUpload.ts      # Upload pipeline (normalize → extract → publish)
│   │   └── promoteExtractions.ts # Extraction → event matching + insert
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
  source: text ('AVL_TODAY' | 'EVENTBRITE' | 'MEETUP' | 'FACEBOOK' | 'POSTER' | ...),
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
  embedding: vector(1536) (Gemini embedding for semantic search),
  // Dedup soft-delete (dedup no longer hard-deletes)
  dedupedAt: timestamp (set when removed as a duplicate; NULL = live; excluded from feed + dedup input),
  dedupSkip: boolean (manual "never auto-dedup this row" flag; to restore a bad merge set dedupedAt=NULL and dedupSkip=true)
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

### `posterUploads` Table

One row per uploaded poster photo. Single status state machine:
`processing` → `failed` | `pending_review` | `published` | `denied`.

- `imagePath` — object path in the **private** `poster-uploads` ingress bucket
- `publicImageUrl` — set only once published (copied to `event-images/posters/{uploadId}.jpg`); cleared on a takedown
- `imageHash` — sha256 of the normalized JPEG; exact re-uploads short-circuit before any AI spend
- `imageWidth` / `imageHeight` — dimensions of the image actually PUBLISHED (the auto-crop when there is one, otherwise the normalized JPEG), written by `publishPosterImage`. The `/posters` masonry needs each poster's aspect ratio server-side to reserve its tile before the image decodes; without them the wall reflows as it loads. Nullable only for rows predating the column (`scripts/backfill-poster-dimensions.ts` fills those in)
- `safetyReason` — why the AI flagged it (`GEMINI_BLOCKED:<reason>` for a Gemini hard block, which produces no extractions)
- `errorMessage` / `rawModelOutput` — failure detail, shown in the moderation queue
- `reviewedAt` — set on approve/deny, so "AI said safe" and "admin approved" stay distinguishable

### `posterExtractions` Table

One row per poster detected in an upload, and one row per printed date on a
multi-date flyer (rows sharing an `ordinal` came off the same poster). `outcome`
is `created` | `matched_existing` | `skipped_no_date` | `skipped_past` |
`skipped_non_nc` | `failed`, with `eventId` pointing at the resulting event.
Promotion is idempotent: settled outcomes are left alone and `failed` rows are
retried, so approving an already-published upload is the retry path.

### Row Level Security (RLS)

RLS is enabled on all tables. Supabase's "RLS auto-enable trigger" is active, so new tables will have RLS enabled automatically. All database writes from the app go through server-side Drizzle ORM using `DATABASE_URL` (the `postgres` role), which bypasses RLS. RLS policies only govern access via Supabase's PostgREST API (the `anon` and `authenticated` roles exposed by the client-side anon key).

**Important:** Drizzle ORM does not manage RLS. When adding new tables via `drizzle-kit push`, you must manually create RLS policies and configure grants via SQL (Supabase Dashboard SQL Editor or a migration file). Without policies, RLS defaults to deny-all for `anon`/`authenticated`.

| Table                 | anon                 | authenticated                                     |
| --------------------- | -------------------- | ------------------------------------------------- |
| `events`              | SELECT               | SELECT                                            |
| `curated_events`      | SELECT               | SELECT, INSERT, UPDATE, DELETE (own)              |
| `curator_profiles`    | SELECT (public only) | SELECT (own + public), INSERT (own), UPDATE (own) |
| `matching_questions`  | SELECT (active only) | SELECT (active only)                              |
| `submitted_events`    | INSERT               | INSERT                                            |
| `user_preferences`    | —                    | SELECT, INSERT, UPDATE (own)                      |
| `newsletter_settings` | —                    | SELECT, INSERT, UPDATE (own)                      |
| `matching_profiles`   | —                    | SELECT, INSERT, UPDATE (own)                      |
| `matching_answers`    | —                    | SELECT, INSERT, UPDATE (own)                      |
| `cron_job_runs`       | —                    | —                                                 |
| `poster_uploads`      | —                    | —                                                 |
| `poster_extractions`  | —                    | —                                                 |

"Own" means the policy restricts access to rows where `user_id = auth.uid()` (or `profile_id` belongs to the user for `matching_answers`).

---

## API Routes

### Cron Jobs (require `Authorization: Bearer {CRON_SECRET}`)

| Route                    | Schedule        | Purpose                                                       |
| ------------------------ | --------------- | ------------------------------------------------------------- |
| `/api/cron/scrape`       | Every 6h at :00 | Scrape all sources, upsert to DB, rule-based dedup            |
| `/api/cron/verify`       | Every 3h at :05 | Verify events missing data via Jina + AI (30/run)             |
| `/api/cron/ai`           | Every 3h at :20 | AI tagging, summaries, embeddings, image generation           |
| `/api/cron/cleanup`      | 8x daily        | Dead events, non-NC, cancelled, duplicates                    |
| `/api/cron/dedup`        | Daily 4 AM ET   | AI semantic dedup of Top Events (score ≥15) over next 30 days |
| `/api/cron/email-digest` | Daily 7 AM ET   | Send daily/weekly email digests to subscribers                |
| `/api/cron/top30-weekly` | Fri 11 AM ET    | Weekly Top 30 email                                           |

Every cron run (prod and local) is recorded in the `cron_job_runs` table (`job_name`, `status`, `duration_ms`, `result` stats). This is the only durable record — Vercel keeps runtime logs for only ~1 hour, so console output is useless for after-the-fact auditing.

**Routine health check** (run every few days): `npm run cron:health` (or `npm run cron:health -- 7` for a 7-day window). It reports per-job run counts and cadence gaps (flagging missed runs), per-scrape inserted/updated counts, scraper failures with error text, "silent" scrapers returning 0 events on every run, stale sources, and AI enrichment coverage — ending in a `VERDICT` line. Exits non-zero when something needs attention.

The scrape job's `result` carries what that check reads: `inserted` / `updated` (genuinely new vs re-confirmed — `upserted` counts every row touched and is not a growth signal), `scrapers[]` (per-scraper `{name, ok, events, ms, error}`), `insertedBySource`, and `skippedSources`.

### Public APIs

| Route                       | Method | Purpose                                          |
| --------------------------- | ------ | ------------------------------------------------ |
| `/api/health`               | GET    | Health check (DB status, event count)            |
| `/api/chat`                 | POST   | AI conversational event discovery (rate limited) |
| `/api/export/xml`           | GET    | RSS XML feed export                              |
| `/api/export/markdown`      | GET    | Markdown export                                  |
| `/api/events/submit`        | POST   | Submit event via form                            |
| `/api/events/submit-url`    | POST   | Submit event via URL                             |
| `/api/events/report`        | POST   | Report an event                                  |
| `/api/curator/[slug]`       | GET    | Public curator profile data                      |
| `/api/events/favorites`     | POST   | Fetch public event data for a list of event IDs  |
| `/api/events/[id]/favorite` | POST   | Increment/decrement an event's favorite count    |

`/api/events/[id]/favorite` is intentionally anonymous — favoriting is
localStorage-driven with no sign-in required, so the endpoint only takes
`{ action: 'add' | 'remove' }` and adjusts `favoriteCount`. There is no DELETE
handler. It is rate limited per IP and, more tightly, per event per IP; the
count is still forgeable (see the deferred `favorites(eventId, anonId)` ledger).

### Authenticated APIs (require Supabase Auth)

| Route                        | Method      | Purpose                                        |
| ---------------------------- | ----------- | ---------------------------------------------- |
| `/api/preferences`           | GET/POST    | Sync user preferences                          |
| `/api/curate`                | POST/DELETE | Add/remove curated events                      |
| `/api/curator/settings`      | GET/POST    | Curator profile settings                       |
| `/api/email-digest/settings` | GET/POST    | Email digest preferences                       |
| `/api/posters/upload`        | POST        | Upload a poster photo (multipart, 20/day/user) |

### Admin APIs (require `SUPER_ADMIN`)

| Route                        | Method | Purpose                         |
| ---------------------------- | ------ | ------------------------------- |
| `/api/admin/event/score`     | POST   | Set/clear event score overrides |
| `/api/admin/curator/verify`  | POST   | Verify a curator profile        |
| `/api/posters/[id]/moderate` | POST   | Approve or deny a poster upload |

Poster moderation guard is the canonical one: `getUser()` → 401, then
`isSuperAdmin(user.id)` → 403. Both actions accept `pending_review` **or**
`published` uploads — approve re-runs promotion (the retry path), deny is a
takedown that deletes the public image, clears `publicImageUrl`, and hides
linked events. Deny only hides events from `outcome='created'` extractions whose
`source` is still `POSTER`; `matched_existing` rows point at real scraped
listings and are never touched.

### Auth Routes

| Route            | Purpose                |
| ---------------- | ---------------------- |
| `/auth/callback` | OAuth callback handler |
| `/auth/confirm`  | Email confirmation     |
| `/auth/signout`  | Sign out               |

---

## Scrapers

| Source            | File                  | Method                     | Notes                                    |
| ----------------- | --------------------- | -------------------------- | ---------------------------------------- |
| AVL_TODAY         | `avltoday.ts`         | CitySpark API              | POST to portal.cityspark.com             |
| EVENTBRITE        | `eventbrite.ts`       | HTML + API                 | Browse page scrape + API details         |
| MEETUP            | `meetup.ts`           | GraphQL                    | Public API, location-based               |
| FACEBOOK          | `facebook.ts`         | Browser automation         | Disabled on Vercel (requires Playwright) |
| HARRAHS           | `harrahs.ts`          | Ticketmaster API + HTML    | Harrah's Cherokee Center                 |
| ORANGE_PEEL       | `orangepeel.ts`       | Ticketmaster API + JSON-LD | The Orange Peel venue                    |
| GREY_EAGLE        | `greyeagle.ts`        | JSON-LD                    | Grey Eagle Taqueria                      |
| LIVE_MUSIC_AVL    | `livemusicavl.ts`     | ICS feeds                  | Select venues only                       |
| EXPLORE_ASHEVILLE | `exploreasheville.ts` | Public API                 | Tourism board events                     |
| MISFIT_IMPROV     | `misfitimprov.ts`     | Crowdwork API              | Improv comedy shows                      |
| UDHARMA           | `udharma.ts`          | Squarespace API            | Meditation/yoga events                   |
| NC_STAGE          | `ncstage.ts`          | ThunderTix                 | NC Stage Company theater                 |
| STORY_PARLOR      | `storyparlor.ts`      | Squarespace JSON-LD        | Storytelling events                      |

---

## AI Integration

### Tagging (`lib/ai/tagging.ts`)

- **Model**: `gemini-2.5-flash`
- **Input**: Event title, description, location, organizer, date
- **Output**: JSON array of tag strings
- **Categories**: Entertainment, Food & Drink, Activities, Audience/Social, Other

### Images

AI image generation is not wired up. The AI cron's "Images Pass" batch-applies the
static `/asheville-default.jpg` placeholder to events with no image.

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
GEMINI_VISION_MODEL=gemini-3.7-flash   # poster extraction

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

# Supabase auth UUID of the single super admin (score overrides, curator
# verification, /admin/posters). Server-only - never exposed to the client.
SUPER_ADMIN=

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

### Poster Uploads

- Signed-in users upload a flyer photo from `/posters`; `POST /api/posters/upload` runs the whole pipeline inline (sharp normalize → sha256 duplicate check → Gemini vision extraction → publish or flag → event promotion)
- Images land in the **private** `poster-uploads` bucket first. Only a safe (or admin-approved) upload is copied to the public `event-images` bucket at `posters/{uploadId}.jpg`; flagged images are rendered in the admin queue via 1h signed URLs
- Public feed at `/posters` (newest 30 published uploads), rendered as a full-width masonry "poster wall": CSS multi-column tiles showing nothing but the image, each with a seeded tilt and tape (see `lib/posters/posterDisplay.ts` — all jitter is derived from the upload id via FNV-1a, never `Math.random`, or SSR and the client draw different walls). Tapping a tile opens a fullscreen lightbox with the poster and its extracted events underneath. Poster events link back with `https://avlgo.com/posters?p={extractionId}`, which opens that poster directly
- The wall's CSS deliberately avoids blend modes, backdrop filters and CSS filters — each one promotes every tile to its own composited layer and repaints it on scroll. Tiles carry no transform (the tilt is on the inner `.poster-paper`) so they open no stacking context, which is what lets a tape strip paint over the neighbouring column
- Moderation queue at `/admin/posters` (super admin only, unlisted — no nav link): flagged uploads oldest-first plus recent failures
- A denied upload's public image is deleted and its created events are hidden; hidden events 404 on `/events/[slug]` and are excluded from similar-event recommendations

### Dark Mode

- `next-themes` for theme management
- `ThemeToggle` component
- Persists preference in localStorage

---

## Scripts Reference

| Script                        | Purpose                                 |
| ----------------------------- | --------------------------------------- |
| `npm run dev`                 | Start development server                |
| `npm run build`               | Build for production                    |
| `npm run test:avl`            | Test AVL Today scraper                  |
| `npm run test:eventbrite`     | Test Eventbrite scraper                 |
| `npm run test:meetup`         | Test Meetup scraper                     |
| `npm run test:harrahs`        | Test Harrah's scraper                   |
| `npm run test:orangepeel`     | Test Orange Peel scraper                |
| `npm run test:greyeagle`      | Test Grey Eagle scraper                 |
| `npm run test:storyparlor`    | Test Story Parlor scraper               |
| `npm run test:misfit`         | Test Misfit Improv scraper              |
| `npm run test:udharma`        | Test UDharma scraper                    |
| `npm run db:check`            | Check database connection               |
| `npm run db:count`            | Count events by source                  |
| `npm run db:tags`             | Check tag statistics                    |
| `npm run db:clear`            | Clear all events (destructive!)         |
| `npm run backfill`            | Backfill Eventbrite events              |
| `npm run backfill:embeddings` | Backfill embeddings for existing events |
| `npm run tag:events`          | Tag all untagged events                 |

---

## Deployment

### Vercel Configuration (`vercel.json`)

```json
{
  "fluid": true,
  "crons": [
    { "path": "/api/cron/scrape", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/verify", "schedule": "5 */3 * * *" },
    { "path": "/api/cron/ai", "schedule": "20 */3 * * *" },
    { "path": "/api/cron/cleanup", "schedule": "30 1,4,7,10,13,16,19,22 * * *" },
    { "path": "/api/cron/dedup", "schedule": "0 8 * * *" },
    { "path": "/api/cron/email-digest", "schedule": "0 12 * * *" },
    { "path": "/api/cron/top30-weekly", "schedule": "0 15 * * 5" }
  ]
}
```

- **Fluid Compute**: Enabled for longer function execution (up to 800s for scrape/ai/verify jobs)
- **Cron Schedule**: Scrape at :00, verify at :05 (every 3h), AI processing at :20 (every 3h), cleanup 8x daily, dedup daily at 4 AM ET, email digests daily at 7 AM ET, Top 30 email Fridays 11 AM ET
- **Known prod gaps**: two sources are local-only and are deliberately skipped on Vercel, so a periodic local full scrape (see `scripts/run-full-cron-local.ts`, `scripts/run-facebook-local.ts`, `scripts/drain-ai-backlog-local.sh`) is required to keep them current:
  - **MountainX** (~9,700 events) — Cloudflare challenges Node's default TLS/ALPN fingerprint, **not** the IP: `curl` gets 200 where Node's `fetch` gets "Just a moment...", and no amount of header spoofing helps. The scraper now issues requests through an undici `Agent` with `allowH2: true` **and** Chrome's cipher order — both halves are required, either alone still 403s. Three tiers: Tribe REST API → month-view HTML (JSON-LD), both over that dispatcher → patchright with a **fresh browser context per month** (a shared context carries a Cloudflare cookie that poisons later navigations). 403s are transient reputation checks, so `fetchAsChrome` retries with backoff rather than falling through a tier. Still gated by `localOnly: true` in the scrape route's `SCRAPERS` registry — but since this was never IP-based, the dispatcher may well work from Vercel; testing that would let MountainX come off the gate entirely.
  - **Facebook** — needs browser automation plus session cookies. Gated by `isFacebookEnabled()`, which returns false on Vercel.

  Both gates key off `process.env.VERCEL` via `isLocalScrapeRuntime()` in `lib/config/env.ts`, so a local run picks them up automatically with no flag to set. The scrape job's `result.skippedSources` records what was skipped on each run — on Vercel expect `["Mountain Xpress", "Facebook"]` and `failures.scrapers: 0`.

### Max Duration

- `/api/cron/scrape`: 800s (13+ minutes, requires Fluid Compute)
- `/api/cron/verify`: 800s (verifies up to 30 events missing data)
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
- AI dedup runs daily at 4 AM ET

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
