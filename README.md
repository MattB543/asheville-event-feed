# Asheville Event Feed

A web app that aggregates events from AVL Today and Eventbrite for the Asheville, NC area.

## Features

- Aggregates events from multiple sources (AVL Today/CitySpark, Eventbrite)
- AI-powered event tagging using Google Gemini
- Client-side filtering and search
- Block hosts/keywords you don't want to see
- Hide individual events
- Responsive design for mobile and desktop

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Neon PostgreSQL with Drizzle ORM
- **AI:** Google Gemini for event tagging
- **Styling:** Tailwind CSS
- **Deployment:** Vercel

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database (Neon recommended)
- Gemini API key (optional, for tagging)

### Environment Variables

Create a `.env` file in the project root:

```bash
DATABASE_URL=postgresql://...
CRON_SECRET=your-random-secret-min-16-chars
GEMINI_API_KEY=your-gemini-api-key  # Optional
```

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
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
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
npm run backfill         # Backfill events from Eventbrite (30 pages)
```

### Tagging

```bash
npm run test:tagging  # Test AI tagging
npm run tag:events    # Tag all untagged events
```

## API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cron` | GET | Trigger event scraping (requires `Authorization: Bearer {CRON_SECRET}`) |
| `/api/cron/cleanup` | GET | Remove dead/404 Eventbrite events (requires auth, runs every 3h) |
| `/api/health` | GET | Health check endpoint |

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

The cron job is configured in `vercel.json` to run every 6 hours.

### Manual Cron Trigger

```bash
curl -X GET https://your-domain.vercel.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Project Structure

```
asheville-event-feed/
├── app/
│   ├── api/
│   │   ├── cron/route.ts      # Scraping cron job
│   │   └── health/route.ts    # Health check
│   ├── page.tsx               # Main page
│   └── layout.tsx             # Root layout
├── components/
│   ├── EventCard.tsx          # Individual event card
│   ├── EventFeed.tsx          # Event list with filtering
│   ├── FilterBar.tsx          # Search and price filters
│   ├── SettingsModal.tsx      # Block hosts/keywords settings
│   └── ErrorBoundary.tsx      # Error handling
├── lib/
│   ├── db/
│   │   ├── index.ts           # Database connection
│   │   └── schema.ts          # Drizzle schema
│   ├── scrapers/
│   │   ├── avlToday.ts        # AVL Today scraper
│   │   ├── eventbrite.ts      # Eventbrite scraper
│   │   └── types.ts           # Shared types
│   ├── ai/
│   │   ├── client.ts          # Gemini client
│   │   └── tagging.ts         # Event tagging logic
│   ├── hooks/
│   │   └── useDebounce.ts     # Debounce hook
│   └── utils/
│       └── retry.ts           # Retry utility
└── scripts/                   # Utility scripts
```

## License

MIT
