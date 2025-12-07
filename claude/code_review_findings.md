# Code Review Findings - Asheville Event Feed

**Date:** December 6, 2025
**Reviewed by:** Claude (Opus 4.5)

This document contains bugs, potential issues, and improvement recommendations identified during a comprehensive code review of the Asheville Event Feed codebase.

---

## Critical Issues

### 1. Security: Timing-Unsafe Authorization Check
**File:** `app/api/cron/route.ts:33`

```typescript
if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
```

**Issue:** Simple string comparison is vulnerable to timing attacks. An attacker could potentially deduce the secret character-by-character by measuring response times.

**Fix:** Use a timing-safe comparison:
```typescript
import { timingSafeEqual } from 'crypto';

const expectedToken = Buffer.from(`Bearer ${env.CRON_SECRET}`);
const providedToken = Buffer.from(authHeader || '');
if (expectedToken.length !== providedToken.length ||
    !timingSafeEqual(expectedToken, providedToken)) {
  return new NextResponse("Unauthorized", { status: 401 });
}
```

### 2. Non-null Assertion on DATABASE_URL
**File:** `lib/config/env.ts:13`

```typescript
get DATABASE_URL() { return process.env.DATABASE_URL!; },
```

**Issue:** The non-null assertion (`!`) assumes `DATABASE_URL` is always defined, which can cause cryptic runtime errors when it's not.

**Fix:** Add explicit error handling or type guards in consuming code.

---

## Bugs

### 3. Typo in Venue Fallback Image Path
**File:** `lib/scrapers/livemusicavl.ts:37`

```typescript
'5 walnut': '/waltnut.webp',
'walnut wine': '/waltnut.webp',
```

**Issue:** The filename is misspelled as `waltnut.webp` instead of `walnut.webp`.

**Fix:** Rename to correct spelling or ensure the actual file matches this name.

### 4. Unused Database Variable
**File:** `lib/db/index.ts:15`

```typescript
_sql = neon(env.DATABASE_URL);
```

**Issue:** The `_sql` variable is assigned but never used anywhere. It's created to establish the connection but the reference isn't exposed or utilized.

**Fix:** Either remove the unused variable assignment or expose it if needed for raw SQL queries.

### 5. Hardcoded Timezone Offset Ignores DST
**Files:**
- `lib/scrapers/harrahs.ts:157`
- `lib/scrapers/orangepeel.ts:189`
- `lib/scrapers/meetup.ts:212-213`

```typescript
startDate = new Date(`${dateStr}T${timeStr}-05:00`);
```

**Issue:** Hardcoding `-05:00` (EST) doesn't account for Eastern Daylight Time (-04:00). Events during DST will have incorrect times.

**Fix:** Calculate the actual offset dynamically:
```typescript
// Detect if date falls in DST
const testDate = new Date(`${dateStr}T12:00:00`);
const offset = testDate.toLocaleString('en-US', {
  timeZone: 'America/New_York',
  timeZoneName: 'shortOffset'
}).includes('-4') ? '-04:00' : '-05:00';
```

### 6. Potential Race Condition in ErrorBoundary Retry
**File:** `components/ErrorBoundary.tsx:27-29`

```typescript
handleRetry = () => {
  this.setState({ hasError: false, error: undefined });
};
```

**Issue:** Clicking "Try Again" resets the error state but if the same error occurs immediately, React's error boundary may not catch it in the same render cycle.

**Fix:** Add a small delay or key change to force remount:
```typescript
handleRetry = () => {
  this.setState({ hasError: false, error: undefined, retryKey: Date.now() });
};
// Then use this.state.retryKey as key prop on children
```

---

## Code Quality Issues

### 7. Duplicate HTML Entity Decoding Functions
**Files:**
- `lib/scrapers/greyeagle.ts:22-52`
- `lib/scrapers/livemusicavl.ts:106-132`

**Issue:** Both files implement nearly identical `decodeHtmlEntities` functions.

**Fix:** Create a shared utility:
```typescript
// lib/utils/htmlEntities.ts
export function decodeHtmlEntities(text: string): string { ... }
```

### 8. Price Extraction in Grey Eagle is Too Greedy
**File:** `lib/scrapers/greyeagle.ts:206-209`

```typescript
const singlePriceMatch = html.match(/\$(\d+(?:\.\d{2})?)/);
```

**Issue:** This regex matches the first dollar amount anywhere in the HTML, which could be unrelated to the event price (e.g., "$5 off appetizers" in an ad).

**Fix:** Narrow the search to specific price containers or use the structured data first:
```typescript
// Look for price in ticket-related context
const priceMatch = html.match(/(?:tickets?|admission|entry|price)[^$]*\$(\d+(?:\.\d{2})?)/i);
```

### 9. Missing Index on Tags Column
**File:** `lib/db/schema.ts:17`

```typescript
tags: text('tags').array(),
```

**Issue:** No GIN index on the tags array. Queries filtering by tags will be slow at scale.

**Fix:** Add a GIN index:
```typescript
import { index } from 'drizzle-orm/pg-core';

// In table definition
}, (table) => ({
  tagsIdx: index('events_tags_idx').using('gin', table.tags),
}));
```

### 10. Large Base64 Images in Database
**File:** `lib/ai/imageGeneration.ts:109`

```typescript
const dataUrl = `data:image/jpeg;base64,${compressedBase64}`;
```

**Issue:** AI-generated images are stored as base64 data URLs directly in the PostgreSQL database. This:
- Increases database size significantly
- Makes queries slower
- Is inefficient for bandwidth (base64 is ~33% larger than binary)

**Fix:** Consider using external storage (S3, Cloudinary, Vercel Blob) and storing only URLs.

### 11. Unused Facebook Configuration
**File:** `lib/config/env.ts:31-65`

**Issue:** The `FB_CONFIG` and related Facebook functions exist but Facebook scraping is disabled on Vercel and likely never used. This adds dead code and potential confusion.

**Fix:** Either remove entirely or add clear documentation about when/how it's used (local development only).

---

## Minor Issues & Suggestions

### 12. Missing Abort Controller Cleanup
**File:** `components/AIChatModal.tsx:127`

```typescript
const abortControllerRef = useRef<AbortController | null>(null);
```

**Issue:** The abort controller reference isn't cleaned up on component unmount, which could cause issues if the component unmounts during an active request.

**Fix:** Add cleanup in useEffect:
```typescript
useEffect(() => {
  return () => {
    abortControllerRef.current?.abort();
  };
}, []);
```

### 13. Inconsistent Error Casting
**File:** `lib/utils/retry.ts:18`

```typescript
lastError = error as Error;
```

**Issue:** Casting `error` to `Error` without type checking. In JavaScript, thrown values can be anything (strings, objects, etc.).

**Fix:**
```typescript
lastError = error instanceof Error ? error : new Error(String(error));
```

### 14. Potential XSS in AI Chat Responses
**File:** `components/AIChatModal.tsx:464-480`

**Issue:** AI responses are rendered with ReactMarkdown. While ReactMarkdown sanitizes by default, malicious prompt injection could theoretically cause issues with custom renderers.

**Current Mitigation:** The custom `a` renderer is safe, but verify all custom component overrides carefully.

### 15. Magic Numbers in Scrapers
**Files:** Various scrapers

**Issue:** Multiple hardcoded numbers (delays, batch sizes, limits) scattered throughout:
```typescript
await new Promise((r) => setTimeout(r, 200));  // harrahs.ts
const BATCH_SIZE = 15;  // eventbrite.ts
const maxPagesPerDay = 10;  // meetup.ts
```

**Fix:** Consider consolidating into a config file:
```typescript
// lib/config/scraperConfig.ts
export const SCRAPER_CONFIG = {
  rateLimit: {
    ticketmaster: 200,
    eventbrite: 2000,
    meetup: 300,
  },
  batchSize: {
    eventbrite: 15,
    tagging: 5,
    imageGen: 3,
  },
};
```

### 16. Upsert Doesn't Preserve Tags for Existing Events
**File:** `app/api/cron/route.ts:331-343`

```typescript
.onConflictDoUpdate({
  target: events.url,
  set: {
    // Note: tags is NOT in this list
    title: event.title,
    ...
  },
});
```

**Issue:** When an existing event is updated, its tags are not modified. This is intentional (tags are only generated for new events), but if an event's title/description changes significantly, the tags may become outdated.

**Suggestion:** Consider re-tagging events whose title has changed significantly.

### 17. Rate Limiter Memory Leak Potential
**File:** `app/api/chat/route.ts:17-23`

```typescript
if (rateLimitMap.size > 1000) {
  const cutoff = now - RATE_LIMIT_MS * 10;
  for (const [key, time] of rateLimitMap.entries()) {
    if (time < cutoff) rateLimitMap.delete(key);
  }
}
```

**Issue:** Cleanup only triggers after 1000 entries. In low-traffic scenarios, stale entries persist indefinitely.

**Fix:** Run cleanup on a timer or every N requests regardless of map size.

---

## Performance Suggestions

### 18. Consider Connection Pooling
**File:** `lib/db/index.ts`

The current setup creates a new connection for each request. For high traffic, consider connection pooling via Neon's connection pooler or PgBouncer.

### 19. Parallelize More Scraper Work
**File:** `app/api/cron/route.ts:174-183`

The venue scrapers (Harrah's, Orange Peel, Grey Eagle, LiveMusicAVL) are already parallelized, which is good. However, the subsequent tagging and image generation are done in small batches with delays. Consider:
- Increasing batch sizes for tagging (5 -> 10)
- Using Promise.allSettled instead of Promise.all for better error isolation

### 20. Add Database Query Caching
**File:** `app/page.tsx:24-28`

The main page query could benefit from caching for frequently accessed data:
```typescript
export const revalidate = 3600; // Already set, good!
```
Consider adding Redis or edge caching for even faster responses.

---

## Summary

| Category | Count |
|----------|-------|
| Critical | 2 |
| Bugs | 4 |
| Code Quality | 5 |
| Minor Issues | 6 |
| Performance | 3 |

**Priority recommendations:**
1. Fix the timing-unsafe authorization check (security)
2. Fix the DST-ignorant timezone handling (data accuracy)
3. Add the missing GIN index on tags (performance)
4. Consolidate duplicate utility functions (maintainability)
5. Consider moving images to external storage (scalability)
