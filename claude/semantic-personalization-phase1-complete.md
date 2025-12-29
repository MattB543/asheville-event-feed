# Semantic Personalization - Phase 1 Implementation Complete

## Overview

Phase 1 of the Semantic Personalization feature has been implemented. This phase establishes the infrastructure for capturing user signals and prepares the database schema for future personalization features.

## What Was Implemented

### 1. Database Schema Changes (`lib/db/schema.ts`)

Added five new columns to the `userPreferences` table:

```typescript
// Semantic personalization (Phase 1)
// Array of {eventId: string, signalType: 'favorite' | 'calendar' | 'share' | 'viewSource', timestamp: string (ISO), active: boolean}
positiveSignals: jsonb('positive_signals').default([]),

// Array of {eventId: string, timestamp: string (ISO), active: boolean}
negativeSignals: jsonb('negative_signals').default([]),

// Cached centroids for performance (1536-dimensional vectors)
positiveCentroid: vector('positive_centroid', { dimensions: 1536 }),
negativeCentroid: vector('negative_centroid', { dimensions: 1536 }),
centroidUpdatedAt: timestamp('centroid_updated_at'),
```

**Signal Structure:**

- **Positive Signals**: Track events users like
  - `eventId`: UUID of the event
  - `signalType`: Type of interaction ('favorite' | 'calendar' | 'share' | 'viewSource')
  - `timestamp`: ISO 8601 timestamp when signal was created
  - `active`: Boolean flag (for 12-month rolling window - signals older than 12 months are auto-deactivated)

- **Negative Signals**: Track events users hide
  - `eventId`: UUID of the event
  - `timestamp`: ISO 8601 timestamp when signal was created
  - `active`: Boolean flag (for 12-month rolling window)

- **Centroids**: Cached vector embeddings for performance
  - `positiveCentroid`: Average embedding of all active positive signals
  - `negativeCentroid`: Average embedding of all active negative signals
  - `centroidUpdatedAt`: When centroids were last computed (for cache invalidation)

### 2. Signals API Endpoints

#### `POST /api/signals` - Add a signal

Adds a new signal to the user's profile.

**Request:**
```json
{
  "eventId": "uuid-string",
  "signalType": "favorite" | "calendar" | "share" | "viewSource" | "hide"
}
```

**Response:**
```json
{
  "success": true,
  "signal": {
    "eventId": "uuid-string",
    "signalType": "favorite",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "active": true
  }
}
```

**Behavior:**
- Requires authentication (Supabase auth)
- If `signalType` is `'hide'`, adds to `negativeSignals`
- Otherwise, adds to `positiveSignals`
- Prevents duplicate signals (same eventId + signalType combination)
- Automatically invalidates cached centroids (sets to null)
- Creates `userPreferences` row if user doesn't have one yet

**Error Cases:**
- 401: Unauthorized (no auth)
- 400: Invalid eventId or signalType
- 400: Signal already exists
- 500: Database error

#### `DELETE /api/signals` - Remove a signal

Removes an existing signal from the user's profile.

**Request:**
```json
{
  "eventId": "uuid-string",
  "signalType": "favorite" | "calendar" | "share" | "viewSource" | "hide"
}
```

**Response:**
```json
{
  "success": true
}
```

**Behavior:**
- Requires authentication
- Removes the signal from appropriate array (positive or negative)
- Automatically invalidates cached centroids
- Returns 404 if user has no preferences or signal not found

**Error Cases:**
- 401: Unauthorized
- 400: Invalid eventId or signalType
- 404: No preferences found
- 500: Database error

#### `POST /api/signals/reactivate` - Re-activate an old signal

Re-activates a signal that was auto-deactivated (for signals older than 12 months).

**Request:**
```json
{
  "eventId": "uuid-string"
}
```

**Response:**
```json
{
  "success": true,
  "signal": {
    "eventId": "uuid-string",
    "signalType": "favorite",
    "timestamp": "2023-01-15T10:30:00.000Z",
    "active": true
  }
}
```

**Behavior:**
- Requires authentication
- Searches both positive and negative signals for the eventId
- Sets `active: true` on the found signal
- Automatically invalidates cached centroids
- Returns the reactivated signal

**Error Cases:**
- 401: Unauthorized
- 400: Invalid eventId
- 404: No preferences found or signal not found
- 500: Database error

### 3. Test Script

Created `scripts/test-signals-schema.ts` to verify:
- Schema columns are correctly defined in TypeScript
- Database migration is needed (reminds to run `npx drizzle-kit push`)

## Next Steps

To complete the deployment:

1. **Push Database Schema Changes:**
   ```bash
   npx drizzle-kit push
   ```
   This will add the new columns to the `user_preferences` table in the database.

2. **Verify Migration:**
   ```bash
   npx tsx scripts/test-signals-schema.ts
   ```
   Should show "✅ Schema columns are accessible" after migration.

## Integration Points for Future Phases

### Phase 2: Scoring Engine
- Read `positiveSignals` and `negativeSignals` from userPreferences
- Fetch event embeddings from `events` table
- Compute centroids if cached values are null or stale
- Calculate similarity scores for events
- Cache computed centroids back to database

### Phase 3: For You UI
- Call scoring API to get personalized events
- Instrument existing UI actions to call `/api/signals`:
  - Favorite button → POST with `signalType: 'favorite'`
  - Hide button → POST with `signalType: 'hide'`
  - Calendar/ICS download → POST with `signalType: 'calendar'`
  - Share button → POST with `signalType: 'share'`
  - View Source link → POST with `signalType: 'viewSource'`

### Phase 4: Explainability
- Use positive signals to find nearest liked event for explanations
- Show "Similar to [Event Name] you liked" tooltips

### Phase 5: My Taste Page
- Read `positiveSignals` and `negativeSignals`
- Fetch event details for each signal
- Show signal history with remove/reactivate options
- Filter by active/inactive based on 12-month window

## Files Changed

- `lib/db/schema.ts` - Added 5 new columns to userPreferences
- `app/api/signals/route.ts` - POST and DELETE endpoints for signal management
- `app/api/signals/reactivate/route.ts` - POST endpoint for reactivating old signals
- `scripts/test-signals-schema.ts` - Test script for schema validation

## Notes

- **Backward Compatibility**: Existing `favoritedEventIds` array continues to work. The new signals system runs in parallel.
- **Cache Invalidation**: Centroids are automatically invalidated (set to null) whenever signals change. Future phases will compute and cache them.
- **Signal Deactivation**: The 12-month rolling window will be implemented in Phase 2 as part of the scoring engine (a background job will mark old signals as `active: false`).
- **No Breaking Changes**: This is purely additive - no existing functionality is modified.

## API Testing

You can test the new endpoints once the schema is migrated:

```bash
# Add a favorite signal
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"eventId": "some-uuid", "signalType": "favorite"}'

# Add a hide signal
curl -X POST http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"eventId": "some-uuid", "signalType": "hide"}'

# Remove a signal
curl -X DELETE http://localhost:3000/api/signals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"eventId": "some-uuid", "signalType": "favorite"}'

# Reactivate an old signal
curl -X POST http://localhost:3000/api/signals/reactivate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"eventId": "some-uuid"}'
```
