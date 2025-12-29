This is a sophisticated project with a high volume of features. While the current code is functional, it suffers from **"Boilerplate Drift"**—where logic like rate limiting, error handling, and date parsing is copied and pasted across multiple files, making it hard to maintain.

Here are the specific areas where you can clean up, reduce, and simplify your codebase:

### 1. Centralize API Rate Limiting

Currently, you have nearly identical in-memory rate limiting logic in `app/api/chat/route.ts`, `app/api/events/[id]/favorite/route.ts`, `app/api/events/report/route.ts`, and `app/api/events/submit/route.ts`.

**Action:** Create `lib/utils/rate-limit.ts`.

```typescript
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export function isRateLimited(ip: string, limit = 20, windowMs = 3600000) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    return false;
  }
  if (record.count >= limit) return true;
  record.count++;
  return false;
}
```

**Impact:** Deletes ~100 lines of redundant code and ensures consistent limiting across the app.

---

### 2. Consolidate "Parser" Utilities

You have many small files in `lib/utils` doing similar string manipulations (`extractPrice.ts`, `extractTime.ts`, `formatPrice.ts`, `cleanMarkdown.ts`, `cleanAsheville.ts`, `htmlEntities.ts`).

**Action:** Combine these into `lib/utils/parsers.ts`.

- Group `extractPrice`, `formatPrice`, and `tryExtractPrice` together.
- Group `extractTime` and `timezone.ts` logic.
- Move `decodeHtmlEntities` into this file as it's used by almost every scraper.

---

### 3. Scraper Refactoring (The "Base Scraper" Pattern)

Every scraper (e.g., `staticage.ts`, `revolve.ts`, `bmcmuseum.ts`) duplicates the same `USER_AGENT` string, `debugSave` logic, and `fetchWithRetry` patterns.

**Action:** Create a shared scraper utility `lib/scrapers/base.ts`.

```typescript
export const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 ...",
  Accept: "text/html,application/xhtml+xml,...",
};

export async function fetchEventData<T>(url: string, options = {}) {
  // Logic for fetchWithRetry + standard error logging
}
```

**Action:** Unify `facebook-*.ts`. You have 5 separate files for Facebook. Combine `facebook-stealth.ts`, `facebook-browser-graphql.ts`, and `facebook-graphql.ts` into a single `lib/scrapers/facebook/api.ts`.

---

### 4. Simplify AI Service Logic

You have `lib/ai/tagging.ts`, `lib/ai/summary.ts`, and `lib/ai/tagAndSummarize.ts`. The third file essentially renders the first two redundant.

**Action:**

1.  Keep `tagAndSummarize.ts` as the primary service.
2.  Refactor `tagging.ts` and `summary.ts` to be internal functions called by the "combined" service, or delete them if you only ever use the combined pass.
3.  Combine `azure-client.ts` and `client.ts` into `lib/ai/provider-clients.ts` to handle both Gemini and Azure in one place.

---

### 5. API Route Consolidation

Your `app/api/cron` folder is very deep.

**Action:** Consider merging `api/cron/scrape` and `api/cron/ai` into a single pipeline.
While Vercel has timeouts, you are already using "Fluid Compute." Running them together reduces database connection overhead and ensures that an event is tagged immediately after being scraped rather than waiting for a separate 10-minute offset cron job.

---

### 6. Script Management (Folder Organization)

Your `scripts/` folder has **61 files**. This makes it impossible to find what you need.

**Action:** Group scripts by domain:

- `scripts/scrapers/` (test-avl, test-meetup, etc.)
- `scripts/maintenance/` (clear-db, check-db-columns, migrate-to-supabase)
- `scripts/ai/` (tag-events, test-scoring, backfill-embeddings)

---

### 7. Consolidate Location Filtering

You have `lib/utils/extractCity.ts`, `lib/utils/locationFilter.ts`, and `lib/utils/zipFromCoords.ts`.

**Action:** These are all solving the same problem: "Where is this event?". Combine them into `lib/utils/geo.ts`.

- Move `ASHEVILLE_VENUES` and `KNOWN_CITIES` into a JSON config file or a single constant file to keep the logic files clean.

---

### 8. Consistent Timezone Handling

In `lib/scrapers/udharma.ts` and `lib/scrapers/eventbrite.ts`, you have local implementations of timezone math.

**Action:** Move all "Fake UTC to Real Eastern" logic strictly into `lib/utils/timezone.ts`. Any scraper needing date parsing should import `parseAsEastern` instead of writing its own `new Date()` logic.

### Summary of Files to Delete (after merging logic):

1.  `lib/utils/formatPrice.ts` (merge into `parsers.ts`)
2.  `lib/utils/htmlEntities.ts` (merge into `parsers.ts`)
3.  `lib/utils/cleanMarkdown.ts` (merge into `parsers.ts`)
4.  `lib/ai/tagging.ts` (merge into `tagAndSummarize.ts`)
5.  `lib/ai/summary.ts` (merge into `tagAndSummarize.ts`)
6.  `lib/scrapers/facebook-stealth.ts` (merge into `facebook/utils.ts`)
7.  `lib/scrapers/facebook-browser-graphql.ts` (merge into `facebook/api.ts`)

By implementing the **Rate Limit Utility** and the **Geo Utility** alone, you will reduce your codebase by several hundred lines of redundant logic.
