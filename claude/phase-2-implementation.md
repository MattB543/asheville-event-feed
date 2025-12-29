# Phase 2 Implementation: Scoring Engine & For You API

## Overview

Phase 2 of the Semantic Personalization feature has been successfully implemented. This phase builds upon the signal infrastructure from Phase 1 to create a complete personalized event recommendation system.

## Files Created

### 1. `lib/ai/personalization.ts` - Scoring Library

A comprehensive utility library for computing personalized event scores. Key functions:

#### `filterActiveSignals<T>(signals: T[]): T[]`
- Filters signals to only include those within the 12-month active window
- Used internally by other functions

#### `computeCentroid(eventIds: string[]): Promise<number[] | null>`
- Computes the average (centroid) embedding from a list of event IDs
- Fetches embeddings from the database
- Filters out events without embeddings
- Returns null if no valid embeddings found

#### `getUserCentroids(userId: string): Promise<{ positive: number[] | null; negative: number[] | null }>`
- Gets or computes cached centroids for a user
- Uses cached values if they exist and are less than 1 hour old
- Otherwise recomputes from active signals (12-month window)
- Updates cache in `userPreferences` table with computed centroids

#### `scoreEvent(eventEmbedding: number[], positiveCentroid: number[] | null, negativeCentroid: number[] | null): number`
- Scores an event against user centroids using cosine similarity
- Algorithm:
  - If no positive centroid: returns 0
  - If no negative centroid: returns similarity to positive centroid
  - Otherwise: returns `positive_similarity - negative_similarity`
- Returns a score between -1 and 1

#### `getScoreTier(score: number): 'great' | 'good' | null`
- Maps scores to tiers based on spec thresholds:
  - `great`: score > 0.7
  - `good`: score > 0.5
  - `null`: score > 0.3 (no visual treatment)
  - Hidden: score ≤ 0.3 (filtered out completely)

#### `findNearestLikedEvent(eventEmbedding: number[], positiveSignals: PositiveSignal[]): Promise<{ eventId: string; title: string } | null>`
- Finds the most similar liked event for explainability
- Compares target event to all active positive signal events
- Returns the event with highest cosine similarity

### 2. `app/api/for-you/route.ts` - For You API Endpoint

A complete API endpoint for serving personalized event feeds.

#### Endpoint: `GET /api/for-you`

**Query Parameters:**
- `dateRange` (optional): `'today' | 'tomorrow' | 'week' | 'later' | 'all'` (default: `'all'`)

**Authentication:**
- Requires valid Supabase auth session
- Returns 401 if not authenticated

**Response Schema:**
```typescript
{
  events: ScoredEvent[],
  meta: {
    signalCount: number,      // Total active signals (within 12 months)
    minimumMet: boolean        // true if >= 5 active signals
  }
}

interface ScoredEvent {
  event: { /* standard event object without embedding */ },
  score: number,               // Personalization score (-1 to 1)
  tier: 'great' | 'good' | null,
  explanation: {
    primary: { eventId: string; title: string } | null
  },
  bucket: 'today' | 'tomorrow' | 'week' | 'later'
}
```

**Implementation Details:**

1. **Authentication & Signal Retrieval**
   - Validates user session
   - Fetches user preferences from database
   - Counts active signals (within 12-month window)
   - Returns empty results if no positive signals

2. **Centroid Computation**
   - Calls `getUserCentroids()` to get or compute user interest profile
   - Uses cached centroids if fresh (< 1 hour old)
   - Otherwise recomputes from active signals

3. **Event Fetching**
   - Fetches events for next 14 days (or filtered by `dateRange` param)
   - Applies same filters as main feed:
     - Future events only
     - Excludes hidden/moderated events
     - Excludes online/virtual events
   - Fetches embeddings for scoring

4. **Scoring & Filtering**
   - Scores each event with an embedding
   - Filters out events with score ≤ 0.3 (Hidden tier)
   - Computes tier (`great`, `good`, or `null`)
   - Assigns time bucket (`today`, `tomorrow`, `week`, `later`)

5. **Explainability**
   - For `great` and `good` tier events:
     - Finds nearest liked event using `findNearestLikedEvent()`
     - Includes in `explanation.primary` field

6. **Sorting & Grouping**
   - Events sorted first by time bucket priority (today → tomorrow → week → later)
   - Then sorted by score descending within each bucket
   - Returns sorted array of scored events

## Key Design Decisions

### 1. Caching Strategy
- **Centroid Cache TTL**: 1 hour
- **Cache Invalidation**: Automatic on signal changes (handled in Phase 1)
- **Why**: Balances freshness with performance, avoids recomputing on every request

### 2. Time Window
- **Active Signal Window**: 12 months
- **Event Fetch Window**: 14 days ahead
- **Why**: Spec requirement for 12-month signals, 14 days matches typical user planning horizon

### 3. Scoring Algorithm
- Uses cosine similarity for embedding comparison
- Subtracts negative similarity from positive to create balanced score
- **Why**: Allows both positive reinforcement and negative suppression

### 4. Tier Thresholds
- **Great**: > 0.7 (tight threshold for selectivity)
- **Good**: > 0.5
- **Hidden**: ≤ 0.3 (complete removal from feed)
- **Why**: Follows spec exactly, ensures high-quality recommendations

### 5. Time Bucket Logic
- Uses Eastern timezone for all date calculations (consistent with rest of app)
- Bucket boundaries computed fresh on each request
- **Why**: Ensures accurate "today" and "tomorrow" based on user's timezone

## Database Usage

### Reads
- `userPreferences` table: Fetches signals and cached centroids
- `events` table: Fetches event details and embeddings

### Writes
- `userPreferences` table: Updates cached centroids after computation

### Performance Considerations
- Centroid cache reduces DB reads on repeated requests
- Embedding fetch limited to 14-day window (typically 100-500 events)
- Batch queries used where possible

## Integration with Phase 1

Phase 2 seamlessly integrates with Phase 1 signal infrastructure:

1. **Signal Structure**: Uses `PositiveSignal` and `NegativeSignal` types from Phase 1
2. **Cache Invalidation**: Respects cache invalidation from `POST /api/signals`
3. **Active Filtering**: Applies same 12-month window to signals
4. **Database Schema**: Uses columns added in Phase 1 (`positiveSignals`, `negativeSignals`, `positiveCentroid`, `negativeCentroid`, `centroidUpdatedAt`)

## Testing Recommendations

### Manual Testing
```bash
# 1. Add some positive signals
curl -X POST http://localhost:3000/api/signals \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"eventId": "EVENT_ID", "signalType": "favorite"}'

# 2. Fetch personalized feed
curl http://localhost:3000/api/for-you \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Test with date range filter
curl "http://localhost:3000/api/for-you?dateRange=today" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Integration Testing
1. Create test user with signals
2. Verify centroid computation works
3. Verify scoring produces expected tiers
4. Verify explanations reference correct liked events
5. Test edge cases:
   - User with no signals
   - User with only negative signals
   - Events without embeddings
   - Empty result sets

### Performance Testing
1. Test with large signal sets (50+ signals)
2. Measure centroid computation time
3. Measure scoring time for 500+ events
4. Verify cache is being used effectively

## Next Steps (Phase 3)

With Phase 2 complete, the foundation is ready for Phase 3: For You UI

Required UI components:
1. "For You" tab in EventFeed
2. Time bucket sections (Today/Tomorrow/This Week/Later)
3. Match badges and styling (great/good tiers)
4. Explainability tooltips
5. Sign-in prompt for anonymous users
6. Onboarding banner with progress indicator (X/5 signals)

## Files Modified

None - Phase 2 is purely additive, no existing files were modified.

## Dependencies

- Drizzle ORM for database queries
- Existing `lib/ai/embedding.ts` for cosine similarity function
- Existing `lib/utils/timezone.ts` for date handling
- Existing `lib/supabase/server.ts` for authentication
- Phase 1 signal infrastructure (`app/api/signals/route.ts`)
