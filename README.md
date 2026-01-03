# Asheville Event Feed (AVL GO)

A web app that aggregates events from 10+ sources for the Asheville, NC area, featuring AI-powered tagging, semantic search, and user authentication.

## Features

- Aggregates events from multiple sources (AVL Today, Eventbrite, Meetup, Facebook, venue calendars, and more)
- AI-powered event tagging and image generation using Google Gemini
- AI summaries and semantic search with vector embeddings
- Conversational AI chat for event discovery
- User authentication with Google OAuth
- Curator profiles - create public curated event lists
- Client-side filtering, search, and preferences sync
- Block hosts/keywords you don't want to see
- Hide individual events
- Dark mode support
- Responsive design for mobile and desktop

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Supabase PostgreSQL with pgvector
- **ORM:** Drizzle ORM
- **AI:** Google Gemini (tagging, images, embeddings) + Azure OpenAI (summaries, chat)
- **Auth:** Supabase Auth + Google OAuth
- **Styling:** Tailwind CSS v4
- **Deployment:** Vercel (with Fluid Compute)

## Quickstart (5 minutes)

Want to get this running locally? Here's the fastest path:

### 1. Get a free database

Head to [supabase.com](https://supabase.com) and create a new project. Once it's created, go to **Settings > Database** and copy the **Connection Pooler** URI (Transaction mode). It looks something like:

```
postgresql://postgres.[project-ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### 2. Set up your environment

Copy the example env file and add your database URL:

```bash
cp .env.example .env
```

Then edit `.env` and paste your Supabase connection string:

```bash
DATABASE_URL=postgresql://your-connection-string-here
```

That's the only required variable. The others are optional (AI features, auth, etc.).

### 3. Install and set up the database

```bash
npm install
npx drizzle-kit push
```

The first command installs dependencies. The second creates the tables in your database.

### 4. Get some events

```bash
npm run backfill
```

This scrapes ~30 pages of Eventbrite events and saves them to your database. Takes a couple minutes.

### 5. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and you should see events!

### Troubleshooting

**"tsx: command not found"** - Run `npm install -D tsx` to add it locally.

**No events showing** - Make sure the backfill completed. Check with `npm run db:count`.

**Database connection errors** - Double-check your `DATABASE_URL` in `.env`. Make sure you're using the Connection Pooler URL from Supabase.

---

## Getting Started (Detailed)

### Prerequisites

- Node.js 20+
- Supabase account (free tier works)
- Optional: Gemini API key (for AI tagging/images)
- Optional: Azure OpenAI (for AI summaries/chat)

### Environment Variables

Create a `.env` file in the project root:

```bash
# Required
DATABASE_URL=postgresql://...

# Optional - Cron authentication
CRON_SECRET=your-random-secret-min-16-chars

# Optional - AI Features (Google Gemini)
GEMINI_API_KEY=your-gemini-api-key

# Optional - AI Features (Azure OpenAI)
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=

# Optional - Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
```

See `.env.example` for the full list of optional variables.

### Installation

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Database Setup

```bash
npx drizzle-kit push
```

## Available Scripts

### Development

```bash
npm run dev             # Start development server
npm run build           # Build for production
npm run start           # Start production server
npm run lint            # Run ESLint
npm run cron:schedule   # View cron job schedules and next run times
```

### Database Management

```bash
npm run db:check     # Check database connection
npm run db:count     # Count events by source
npm run db:tags      # Check tag statistics
npm run db:clear     # Clear all events (use with caution)
```

### Scrapers

```bash
npm run test:avl         # Test AVL Today scraper
npm run test:eventbrite  # Test Eventbrite scraper
npm run test:meetup      # Test Meetup scraper
npm run test:harrahs     # Test Harrah's scraper
npm run test:orangepeel  # Test Orange Peel scraper
npm run test:greyeagle   # Test Grey Eagle scraper
npm run backfill         # Backfill events from Eventbrite
```

### AI Features

```bash
npm run test:tagging     # Test AI tagging
npm run test:image-gen   # Test AI image generation
npm run test:summary     # Test AI summary generation
npm run test:embedding   # Test embedding generation
npm run tag:events       # Tag all untagged events
npm run backfill:embeddings  # Backfill embeddings
```

## API Routes

| Endpoint                    | Method      | Description                                   |
| --------------------------- | ----------- | --------------------------------------------- |
| `/api/cron/scrape`          | GET         | Trigger event scraping (requires auth)        |
| `/api/cron/ai`              | GET         | Trigger AI processing (requires auth)         |
| `/api/cron/cleanup`         | GET         | Cleanup dead/duplicate events (requires auth) |
| `/api/cron/dedup`           | GET         | AI semantic deduplication (requires auth)     |
| `/api/health`               | GET         | Health check endpoint                         |
| `/api/chat`                 | POST        | AI conversational event discovery             |
| `/api/preferences`          | GET/POST    | User preferences sync                         |
| `/api/events/[id]/favorite` | POST/DELETE | Favorite/unfavorite events                    |
| `/api/events/submit`        | POST        | Submit new event                              |
| `/api/export/xml`           | GET         | RSS XML export                                |
| `/api/export/markdown`      | GET         | Markdown export                               |

## Event Sources

The app scrapes events from 10+ sources:

| Source            | Method                          |
| ----------------- | ------------------------------- |
| AVL Today         | CitySpark API                   |
| Eventbrite        | HTML scraping + API             |
| Meetup            | GraphQL API                     |
| Facebook          | Browser automation (local only) |
| Harrah's Cherokee | Ticketmaster API                |
| Orange Peel       | Ticketmaster API + JSON-LD      |
| Grey Eagle        | JSON-LD                         |
| Live Music AVL    | ICS feeds                       |
| Explore Asheville | Public API                      |
| Misfit Improv     | Crowdwork API                   |
| NC Stage          | ThunderTix                      |
| Story Parlor      | Squarespace JSON-LD             |

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

The cron jobs are configured in `vercel.json`:

- Scraping runs every 6 hours
- AI processing runs 10 minutes after scraping
- Cleanup runs 8 times daily
- AI deduplication runs daily at 5 AM ET

### Manual Cron Trigger

```bash
curl -X GET https://your-domain.vercel.app/api/cron/scrape \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Project Structure

```
asheville-event-feed/
├── app/                      # Next.js App Router
│   ├── api/                  # API routes (cron, chat, preferences, etc.)
│   ├── auth/                 # Auth routes (callback, signout)
│   ├── events/[slug]/        # Individual event pages
│   ├── login/                # Login page
│   ├── profile/              # User profile page
│   ├── u/[slug]/             # Curator profile pages
│   └── page.tsx              # Main page
├── components/               # React components
├── lib/
│   ├── ai/                   # AI integrations (Gemini, Azure OpenAI)
│   ├── db/                   # Database schema and queries
│   ├── scrapers/             # Event source scrapers
│   ├── supabase/             # Supabase client and utilities
│   └── utils/                # Utility functions
└── scripts/                  # CLI utility scripts
```

## License

MIT
