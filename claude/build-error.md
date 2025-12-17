12:16:45.579 Running build in Washington, D.C., USA (East) – iad1
12:16:45.580 Build machine configuration: 4 cores, 8 GB
12:16:45.685 Cloning github.com/MattB543/asheville-event-feed (Branch: main, Commit: c4aecd0)
12:16:46.175 Cloning completed: 489.000ms
12:16:47.414 Restored build cache from previous deployment (GhRmu935o5QQym6Z2XBLVHkQRnpm)
12:16:48.276 Running "vercel build"
12:16:48.721 Vercel CLI 50.0.1
12:16:49.042 Installing dependencies...
12:16:50.217
12:16:50.217 up to date in 970ms
12:16:50.218
12:16:50.218 225 packages are looking for funding
12:16:50.218 run `npm fund` for details
12:16:50.250 Detected Next.js version: 16.0.10
12:16:50.255 Running "npm run build"
12:16:50.356
12:16:50.356 > asheville-event-feed@0.1.0 build
12:16:50.356 > next build
12:16:50.356
12:16:51.391 ▲ Next.js 16.0.10 (Turbopack)
12:16:51.392
12:16:51.428 Creating an optimized production build ...
12:17:02.380 ✓ Compiled successfully in 10.4s
12:17:02.385 Running TypeScript ...
12:17:10.165 Collecting page data using 3 workers ...
12:17:10.609 [dotenv@17.2.3] injecting env (0) from .env -- tip: 🔐 prevent committing .env to code: https://dotenvx.com/precommit
12:17:10.611 [dotenv@17.2.3] injecting env (0) from .env -- tip: 👥 sync secrets across teammates & machines: https://dotenvx.com/ops
12:17:10.684 [dotenv@17.2.3] injecting env (0) from .env -- tip: ✅ audit secrets and track compliance: https://dotenvx.com/ops
12:17:10.754 [dotenv@17.2.3] injecting env (0) from .env -- tip: 🔑 add access controls to secrets: https://dotenvx.com/ops
12:17:10.768 [dotenv@17.2.3] injecting env (0) from .env -- tip: ✅ audit secrets and track compliance: https://dotenvx.com/ops
12:17:10.805 Generating static pages using 3 workers (0/24) ...
12:17:11.156 [dotenv@17.2.3] injecting env (0) from .env -- tip: 🔑 add access controls to secrets: https://dotenvx.com/ops
12:17:11.242 Generating static pages using 3 workers (6/24)
12:17:11.357 Generating static pages using 3 workers (12/24)
12:17:11.376 Generating static pages using 3 workers (18/24)
12:17:11.524 [dotenv@17.2.3] injecting env (0) from .env -- tip: ⚙️ suppress all logs with { quiet: true }
12:17:11.545 [Home] Fetching events from database...
12:17:11.785 [Home] Fetched 3460 events, 3416 after spam filter.
12:17:11.874 Failed to set Next.js data cache for unstable_cache / 890bc80da2ee4b22c0a86ef76ee0ec50b2c27105b4c1b1bf48753b5835dfefe0, items over 2MB can not be cached (4763346 bytes)
12:17:15.659 ✓ Generating static pages using 3 workers (24/24) in 4.9s
12:17:15.699 Finalizing page optimization ...
12:17:15.704
12:17:15.706 Route (app) Revalidate Expire
12:17:15.707 ┌ ○ / 1h 1y
12:17:15.707 ├ ○ /\_not-found
12:17:15.707 ├ ƒ /api/chat
12:17:15.707 ├ ƒ /api/cron
12:17:15.707 ├ ƒ /api/cron/ai
12:17:15.707 ├ ƒ /api/cron/cleanup
12:17:15.707 ├ ƒ /api/cron/dedup
12:17:15.707 ├ ƒ /api/cron/scrape
12:17:15.707 ├ ƒ /api/curate
12:17:15.707 ├ ƒ /api/curator/[slug]
12:17:15.707 ├ ƒ /api/curator/settings
12:17:15.707 ├ ƒ /api/events/[id]/favorite
12:17:15.707 ├ ƒ /api/events/report
12:17:15.707 ├ ƒ /api/events/submit
12:17:15.707 ├ ƒ /api/events/submit-url
12:17:15.707 ├ ƒ /api/export/json
12:17:15.707 ├ ƒ /api/export/markdown
12:17:15.708 ├ ƒ /api/health
12:17:15.708 ├ ƒ /api/preferences
12:17:15.708 ├ ƒ /auth/callback
12:17:15.708 ├ ƒ /auth/confirm
12:17:15.708 ├ ƒ /auth/signout
12:17:15.708 ├ ƒ /events/[slug]
12:17:15.708 ├ ○ /login
12:17:15.708 ├ ○ /manifest.webmanifest
12:17:15.708 ├ ƒ /profile
12:17:15.708 ├ ○ /robots.txt
12:17:15.710 ├ ○ /sitemap.xml
12:17:15.710 └ ƒ /u/[slug]
12:17:15.710
12:17:15.710
12:17:15.710 ƒ Proxy (Middleware)
12:17:15.711
12:17:15.711 ○ (Static) prerendered as static content
12:17:15.711 ƒ (Dynamic) server-rendered on demand
12:17:15.711
12:17:16.420 Traced Next.js server files in: 61.276ms
12:17:17.471 Created all serverless functions in: 1.050s
12:17:17.487 Collected static files (public/, static/, .next/static): 4.908ms
12:17:17.722 Build Completed in /vercel/output [29s]
12:17:17.988 Deploying outputs...
12:17:23.775 Warning: Oversized Incremental Static Regeneration (ISR) page: index.fallback (31.93 MB). Pre-rendered responses that are larger than 19.07 MB result in a failure (FALLBACK_BODY_TOO_LARGE) at runtime. Use environment variable VERCEL_BYPASS_FALLBACK_OVERSIZED_ERROR=1 to work around the build failure. More information: https://vercel.link/oversized-isr-page
12:17:23.919 Error: Oversized Incremental Static Regeneration (ISR) page: index.fallback (31.93 MB). Pre-rendered responses that are larger than 19.07 MB result in a failure (FALLBACK_BODY_TOO_LARGE) at runtime. Use environment variable VERCEL_BYPASS_FALLBACK_OVERSIZED_ERROR=1 to work around the build failure. More information: https://vercel.link/oversized-isr-page. Learn More: https://vercel.link/oversized-isr-page
