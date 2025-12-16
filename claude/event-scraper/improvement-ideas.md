Below are the biggest “low hanging fruit” improvements I see from your infra report—prioritized by **security risk**, **cost/perf impact**, and **blast radius**. I’m deliberately focusing on changes you can do **incrementally** (no massive rebuild), and I’ll call out a couple places where the report likely overstates a protection that may not actually apply.

---

## 1) Tighten `next/image` immediately (right now it’s a security + cost footgun)

### What I’m seeing

Your `next.config.ts` allows **any** `http`/`https` hostname via:

```ts
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '**' },
    { protocol: 'http',  hostname: '**' },
  ],
},
```

Next’s Image Optimization is explicitly designed to require an allowlist “to protect your application from malicious users.”

When misconfigured (e.g., “allow all”), it becomes a known class of **SSRF / blind SSRF** and “make your server fetch attacker-chosen URLs” problems in the wild, and multiple security advisories / scanners specifically flag permissive `remotePatterns` as an issue.

### Low-rebuild fixes (pick one; all are incremental)

**Option A (fastest, safest): stop using Next Image Optimization for untrusted hosts**

- Create a tiny `SafeImage` component:

  - If the URL hostname is _yours_ (Supabase Storage / your CDN), render `<Image>`.
  - Otherwise render a plain `<img>` so the **browser** fetches it (no server-side fetch = kills the SSRF vector).

This lets you tighten `remotePatterns` to only your owned domains.

**Option B (still small, big payoff): re-host scraped images**

- When scraping, download the image and upload to Supabase Storage (or Vercel Blob).
- Store only the Storage URL in `events.imageUrl`.
- Then `remotePatterns` can allow only your bucket/CDN host.

**Option C (short-term “band-aid”): disable optimization globally**

- `images: { unoptimized: true }` (trade-off: you lose Next’s optimization benefits, but you remove the server-side fetcher as a target).

**Also: remove `http` unless absolutely unavoidable.** If some sources are `http`, prefer to fetch once during scraping and re-host (Option B), rather than letting runtime fetch arbitrary `http` forever.

---

## 2) Stop storing base64 “data URLs” in Postgres rows (it hurts DB, payload size, and rendering)

### What I’m seeing

You sometimes store AI images as `data:image/jpeg;base64,...` in `events.imageUrl`.

That creates a triple hit:

- **Database bloat** (big text field in a hot table)
- **Network bloat** (your SSR payloads can balloon—base64 is ~33% larger than binary)
- **Frontend costs** (large HTML/JSON to parse + memory)

### Low-rebuild fix

- Keep your `sharp` compression step, but instead of returning a data URL:

  1. Upload the JPEG buffer to **Supabase Storage** (or Vercel Blob)
  2. Store the **public URL** in `events.imageUrl`

This also dovetails perfectly with tightening `remotePatterns` (Section 1).

---

## 3) Your report claims “Supabase RLS protects user data” — that’s very likely _not true_ with Drizzle + direct DB connections

### Why this matters

You connect to Postgres via `DATABASE_URL` using postgres.js + Drizzle.

Supabase RLS is a database feature, but **whether it actually protects you depends on which DB role you connect as** and whether your connection sets the same request JWT context Supabase normally provides.

- Supabase’s RLS docs emphasize that RLS is what enables secure browser access patterns.
- But when you query Postgres directly from a backend/service layer, you typically:

  - Either **bypass RLS** (common if using highly-privileged roles)
  - Or you **don’t satisfy policies** that rely on `auth.uid()` unless you set JWT claims in the session

- Supabase maintainers have explicitly described the “direct connection with RLS” approach as requiring setting a Postgres config variable with JWT claims (e.g., `request.jwt.claims`) and running SQL as an authenticated role.

### What I’d do (low rebuild)

Pick one clear stance and implement it consistently:

**Stance A: “Backend is trusted; enforce auth in code, not RLS.” (simplest)**

- Treat the Drizzle connection as privileged.
- Ensure any route that reads/writes `userPreferences` _always_:

  - derives `userId` from a verified Supabase session/server auth
  - never accepts a `userId` from the client
  - scopes every query with `WHERE user_id = <authed user id>`

**Stance B: “We want RLS guarantees for preference tables.” (more work, but contained)**

- Use Supabase Data API (PostgREST) / supabase-js for user-scoped tables where you want RLS semantics
- Or implement the “set session claims” pattern so `auth.uid()` works for direct SQL

Right now your report reads like you’re getting RLS protection “for free.” With Drizzle direct SQL, you almost certainly are not.

---

## 4) Use Next.js 16 cache invalidation tied to your cron pipeline (fresher data, fewer DB hits, no redesign)

You currently use `revalidate = 3600` on `/` and `/events/[slug]`. That’s okay, but it means:

- new scraped events may take up to an hour to show up
- you re-render on a timer rather than on actual data change

Next.js 16 explicitly highlights improved caching APIs including `revalidateTag()` / `updateTag()` style workflows.
And Next has a supported `unstable_cache` API for caching server-side work.

### Low-rebuild pattern

- Wrap your DB fetch in a cached function tagged `"events"`:

```ts
import { unstable_cache } from "next/cache";

export const getHomeEvents = unstable_cache(
  async () => {
    // your db.select(...) here
  },
  ["home-events"],
  { tags: ["events"], revalidate: 3600 }
);
```

- In your cron routes (`/api/cron/scrape`, `/api/cron/cleanup`, `/api/cron/dedup`, `/api/cron/ai`), after successful DB mutation:

```ts
import { revalidateTag } from "next/cache";

revalidateTag("events");
```

**Result:** you keep ISR-like behavior, but the cache refresh is driven by your data pipeline rather than a dumb hourly timer.

---

## 5) Add cron “single-flight” locking (prevents overlapping runs + weird partial states)

Right now you’ve scheduled:

- scrape every 6 hours
- ai 10 minutes later
- cleanup 8x/day
- dedup daily

These can overlap (deploys, retries, slow scrapes, or long cleanups). Vercel’s cron is “just HTTP GET requests” and it’s easy to accidentally run the same endpoint twice (manual trigger + cron, or overlapping schedules).

### Low-rebuild fix

Use a **Postgres advisory lock** per job:

- At job start: `pg_try_advisory_lock(hashtext('cron_scrape'))`
- If lock not acquired: exit `200 { skipped: true }`
- Finally: unlock

This prevents concurrency bugs and also prevents multiple expensive scrape workers from hammering targets and your DB.

---

## 6) Your upsert pattern likely causes avoidable write amplification (table bloat + slower vacuum)

You do:

```ts
onConflictDoUpdate({
  target: events.url,
  set: { title, description, startDate, ... }
})
```

Even if nothing changed, Postgres will still perform an UPDATE, generating dead tuples and index churn.

### Low-rebuild fix

Make updates conditional: “only update if something actually differs.”

In raw SQL it’s the classic:

```sql
... DO UPDATE SET ...
WHERE (events.title IS DISTINCT FROM excluded.title OR ...)
```

Drizzle supports adding conditions in many conflict handlers; even if you need to drop down to SQL for this one, it’s worth it.

---

## 7) Add `updatedAt` + `lastSeenAt` to unlock incremental processing (and reduce your cron workload)

You already have `createdAt`, but no durable way to answer:

- “what changed since last run?”
- “did this event disappear from the source?”
- “which rows need AI work?”

### Low-rebuild schema tweak (high leverage)

Add:

- `updatedAt` (set on every upsert update)
- `lastSeenAt` (set whenever the scraper sees the event again)

Then:

- **AI cron** can process “events created/updated since last AI run”
- **cleanup** can hide events not seen in X days for sources that don’t 404 reliably
- **dedup** can focus only on recently changed rows

This reduces total compute + DB work without changing your UI at all.

---

## 8) Vercel Cron security: you can harden slightly with almost no effort

You already use `CRON_SECRET`. Vercel officially supports this: set `CRON_SECRET` as an env var and Vercel will automatically send it in the `Authorization` header for cron invocations.
Cron invocations also have a known user agent `vercel-cron/1.0`.

### Low-rebuild hardening

- Validate:

  - `Authorization` matches your secret
  - AND `User-Agent` starts with `vercel-cron/1.0` (nice extra signal)

- Always respond 200 when “job already running” (so you don’t create noisy retry storms)

---

## 9) “Fluid compute” changes your concurrency model—double check DB connection settings

You have `"fluid": true` in `vercel.json`. That enables Vercel Fluid compute for the deployment.
Fluid compute can run **multiple invocations concurrently in the same instance/process**, sharing global state.

### Why you should care

You currently set `postgres(..., { max: 1 })`.

That won’t break correctness (postgres.js will queue work), but under concurrency it can become a throughput bottleneck.

### Low-rebuild tweak

- Consider bumping `max` modestly (e.g., 3–5) and watch DB pooler metrics.
- If you ever move to `pg` `Pool`, Vercel has an official “attachDatabasePool” approach for Fluid compute—though it’s aimed at supported clients like `pg`, not postgres.js.

---

## 10) Dependency hygiene that can prevent “works locally, breaks in prod”

A couple small, easy wins:

### (A) Ensure runtime deps are in `dependencies`, not `devDependencies`

Your report shows `patchright` in devDependencies, but it’s used by production cron routes. If your install/build pipeline ever omits devDependencies, scrapes will fail at runtime.

### (B) Remove genuinely unused packages

You already called out `@neondatabase/serverless` is unused. Removing it reduces install size and the chance of accidental transitive vulnerabilities.

---

## 11) Performance wins that don’t require rebuilding the app

These are still “infra-ish” because they reduce server load, payload size, and client CPU.

### (A) Stop shipping full descriptions to the home feed

Descriptions are often the biggest payload field. You already have `aiSummary`.

Low-rebuild:

- For `/` list query: return `aiSummary` + maybe a truncated description (e.g., 200–400 chars)
- For `/events/[slug]`: fetch full description

### (B) Add list virtualization before you add pagination

Pagination touches URL/state/UI behavior. Virtualization is often a drop-in improvement:

- `react-window` / `react-virtual` can make 1000+ events feel fine without changing how you fetch data.

---

## Things that are unclear from the report (but worth checking)

Not blockers—just places where the “best” recommendation depends on your reality:

1. **How many events are you typically returning on `/`?** (50 vs 5,000 changes whether you do “virtualize only” or “server-side pagination” first.)
2. **Are you serving scraped remote images through `<Image>` today?** If yes, the remotePatterns wildcard is a bigger immediate risk than if you mostly use `<img>`.
3. **Which DB role does `DATABASE_URL` connect as?** This determines whether RLS is bypassed (and whether the “RLS protects user data” claim is accurate).
4. **Do your cron routes ever hit timeouts in production?** If yes, the next step is making jobs resumable + incremental (the `updatedAt/lastSeenAt` change helps a lot).

---

## If I had to pick only 5 “do these next” items

1. **Replace wildcard `remotePatterns`** with a safe image strategy (SafeImage + allowlist +/or re-host images).
2. **Move base64 images out of Postgres** into Storage/Blob.
3. **Stop assuming RLS applies to Drizzle direct DB queries**; explicitly enforce auth or move user tables to supabase-js/RLS semantics.
4. **Cron single-flight locking** (advisory locks) + incremental processing fields (`updatedAt`, `lastSeenAt`).
5. **Tag-based revalidation** (cache DB fetch + `revalidateTag('events')` after cron).

If you want, paste your actual `EventCard` image rendering snippet and one cron route (scrape or ai), and I can be very concrete about the minimal code changes to implement the SafeImage + storage migration + cache invalidation pattern with your current structure.
