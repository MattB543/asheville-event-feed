# Semantic Personalization Spec

## Overview

This spec defines the implementation of a **Semantic Recommendation Engine** that replaces rule-based filtering (tags, keywords) with embedding-based personalization. The system builds a **User Interest Profile** from positive and negative signals, then uses vector similarity to rank events by relevance.

---

## Core Concept

Instead of manually blocking keywords like "Pesticide Training," the system observes user behavior:
- User hides a "Commercial Pesticide" event → system notes the embedding
- User favorites a Jazz show → system notes that embedding
- Future events similar to hidden events get buried; events similar to favorites get boosted

The User Interest Profile is a weighted average of:
- **Positive Centroid**: Average embedding of liked events
- **Negative Centroid**: Average embedding of hidden events (if any)

---

## Signal System

### Signal Types

| Action | Signal Type | Strength |
|--------|-------------|----------|
| Favorite event | Positive | Binary |
| Click calendar/ICS | Positive | Binary |
| Share event | Positive | Binary |
| Click "View Source" | Positive | Binary |
| Hide event | Negative | Binary |

All positive actions have equal weight. All are binary (no weighting by action type).

### Signal Behavior

- **Hide**: Only affects embedding-based scoring. Does NOT auto-block the organizer (that remains a separate feature in Settings)
- **Undo**: Users can remove positive signals if clicked accidentally (via My Taste page or event card)
- **Storage**: Store event IDs in `userPreferences`, reference embeddings from the `events` table (events persist indefinitely, only duplicates/cancellations are deleted)

---

## Profile Computation

### Time Window

- **12-month rolling window**: Signals older than 12 months are auto-deactivated
- Users can manually re-activate old signals from the My Taste page

### Centroid Calculation

```
Positive Centroid = average(embeddings of all positive signals within 12 months)
Negative Centroid = average(embeddings of all negative signals within 12 months)
```

### Scoring Algorithm

```
if (has negative signals):
    FinalScore = cosineSimilarity(event, positiveCentroid) - cosineSimilarity(event, negativeCentroid)
else:
    FinalScore = cosineSimilarity(event, positiveCentroid)
```

---

## Tier Thresholds

Using tight thresholds for selectivity:

| Tier | Threshold | Visual Treatment |
|------|-----------|------------------|
| Great Match | score > 0.7 | Subtle badge + subtle border/glow |
| Good Match | score > 0.5 | Subtle badge only |
| Okay | score > 0.3 | No indicator |
| Hidden | score ≤ 0.3 | Completely hidden from feed |

- **No percentages**: Use tier labels only ("Great Match", "Good Match")
- **No "Okay" badge**: Only Great and Good get visual treatment

---

## Cold Start & Onboarding

### Empty State (0 signals)

When a new user visits "For You" tab with no signals:
- Show empty state message
- Prompt: "Search and favorite events you're interested in to build your custom feed"
- No default/population-based recommendations

### Soft Minimum (1-4 signals)

- Show "For You" feed but with progress banner
- Banner text: "2/5 events liked — keep going to improve your recommendations!"
- Progress indicator shows X/5
- Feed still functions, just with less accurate personalization

### Active State (5+ signals)

- No banner
- Full personalization active

---

## Feed Structure

### Tab Placement

- **"For You"** is a **secondary tab** (not default)
- "All Events" remains the default view
- Both tabs visible to logged-in users with signals
- Anonymous users see "For You" tab with sign-in prompt (teaser)

### Time Buckets

Events in "For You" are grouped into time buckets, sorted by similarity within each:

1. **Today** — events happening today
2. **Tomorrow** — events happening tomorrow
3. **This Week** — events within the next 7 days (excluding today/tomorrow)
4. **Later** — events beyond 7 days

Within each bucket, events are sorted by `FinalScore` descending.

### Filtering

- Events with `FinalScore ≤ 0.3` are **completely hidden** (not collapsed, not shown)
- Existing filters (search, price, tags) still apply on top of personalization

---

## Explainability

### Tooltip Content

For Great/Good Match events, show explanation:
- **Primary**: Cite the single favorited event most similar to this event
- **Secondary** (if easy): Cite a second event halfway between this event and the centroid

Example: "Similar to Jazz at Little Jumbo you liked"

### Tooltip Trigger

- **Desktop**: Hover over match badge
- **Mobile**: Tap match badge to reveal tooltip

---

## Visual Design

### Match Indicators

For Great Match events:
- Small "Great Match" chip/badge on card (corner or below title)
- Subtle colored border or glow around card

For Good Match events:
- Small "Good Match" chip only
- No border/glow

### Hide Animation

When user hides an event in "For You":
- Card fades/slides out immediately
- No waiting for refresh

---

## My Taste Page

### Location

Dedicated section in user profile (e.g., `/profile/taste` or section within `/profile`)

### Content

- **Positive Signals**: List of events with:
  - Event title (linked to event page)
  - Signal type icon (heart for favorite, calendar for ICS, share icon, link icon)
  - Timestamp: "Favorited Dec 15, 2024"
  - Remove button (to undo signal)

- **Negative Signals**: List of hidden events with:
  - Event title
  - Timestamp: "Hidden Nov 2, 2024"
  - Remove button (to undo hide)

- **Inactive Signals**: Events older than 12 months
  - Shown in separate section (collapsed by default)
  - "Re-activate" button to bring back into active profile

### Actions

- Remove any signal (undo favorite, undo hide)
- Re-activate old signals
- View signal history

---

## Performance & Caching

### Computation Strategy

- **On-demand, cached**: Compute personalized scores on first "For You" visit
- **Cache duration**: 1 hour
- **Cache invalidation**: Immediately when user adds new signal (favorite, hide, calendar, share, view source)

### Cache Key

```
cache_key = `user:${userId}:forYou:${dateRange}`
```

### Cross-Tab State

- State syncs on tab switch (not live)
- Favoriting in "All Events" doesn't immediately update "For You" scores
- Switching tabs triggers refresh

---

## Authentication

### Logged-in Users

- Full access to "For You" feature
- Signals persist in `userPreferences` table
- My Taste page available

### Anonymous Users

- "For You" tab visible but shows sign-in prompt
- Prompt: "Sign in to get personalized recommendations"
- No localStorage fallback for anonymous signals

---

## Database Schema Changes

### userPreferences Table

Add new columns:

```sql
-- Positive signals (event IDs with metadata)
positiveSignals: jsonb
-- Structure: [{ eventId: string, signalType: 'favorite' | 'calendar' | 'share' | 'viewSource', timestamp: ISO date, active: boolean }]

-- Negative signals (event IDs with metadata)
negativeSignals: jsonb
-- Structure: [{ eventId: string, timestamp: ISO date, active: boolean }]

-- Cached centroids (for performance)
positiveCentroid: vector(1536) | null
negativeCentroid: vector(1536) | null
centroidUpdatedAt: timestamp | null
```

### Indexes

No new indexes required (embeddings already indexed on events table).

---

## API Endpoints

### GET /api/for-you

Returns personalized event feed.

Query params:
- `dateRange`: 'today' | 'tomorrow' | 'week' | 'later' | 'all'

Response:
```json
{
  "events": [
    {
      "event": { /* standard event object */ },
      "score": 0.75,
      "tier": "great" | "good" | null,
      "explanation": {
        "primary": { "eventId": "...", "title": "Jazz at Little Jumbo" },
        "secondary": { "eventId": "...", "title": "..." } | null
      }
    }
  ],
  "meta": {
    "signalCount": 8,
    "minimumMet": true
  }
}
```

### POST /api/signals

Add a signal.

```json
{
  "eventId": "...",
  "signalType": "favorite" | "calendar" | "share" | "viewSource" | "hide"
}
```

### DELETE /api/signals

Remove a signal.

```json
{
  "eventId": "...",
  "signalType": "favorite" | "calendar" | "share" | "viewSource" | "hide"
}
```

### POST /api/signals/reactivate

Re-activate an old signal.

```json
{
  "eventId": "..."
}
```

### GET /api/taste

Get user's signal history for My Taste page.

Response:
```json
{
  "positive": [
    { "event": {...}, "signalType": "favorite", "timestamp": "...", "active": true }
  ],
  "negative": [
    { "event": {...}, "timestamp": "...", "active": true }
  ],
  "inactive": [
    { "event": {...}, "signalType": "favorite", "timestamp": "...", "active": false }
  ]
}
```

---

## Implementation Phases

### Phase 1: Signal Infrastructure

1. Add signal columns to `userPreferences` schema
2. Instrument signal capture on existing actions:
   - Favorite button → add positive signal
   - Hide button → add negative signal
   - Calendar/ICS click → add positive signal
   - Share button → add positive signal
   - View Source click → add positive signal
3. Build `/api/signals` endpoints
4. Add cache invalidation on signal changes

### Phase 2: Scoring Engine

1. Implement centroid computation (average of embeddings)
2. Implement similarity scoring against centroids
3. Build `/api/for-you` endpoint with time bucketing
4. Add caching layer with 1-hour TTL

### Phase 3: For You UI

1. Add "For You" tab to EventFeed
2. Implement time bucket sections (Today/Tomorrow/This Week/Later)
3. Add match badges and border/glow styling
4. Implement hide animation
5. Add sign-in prompt for anonymous users
6. Add onboarding banner with progress indicator

### Phase 4: Explainability

1. Compute nearest liked event for explanations
2. Compute secondary reference event (optional)
3. Add hover/tap tooltip component
4. Wire up to match badges

### Phase 5: My Taste Page

1. Create `/profile/taste` route
2. Build signal list components with icons and timestamps
3. Add remove/undo functionality
4. Add inactive signals section with re-activate

---

## Success Metrics

1. **Click-Through Rate**: Higher CTR on "For You" vs "All Events"
2. **Signal Volume**: Increased use of Hide feature (now that it "has superpowers")
3. **Retention**: Users with personalized feeds return more frequently
4. **Time to Value**: Users hit 5-signal minimum within first 2 sessions

---

## Out of Scope for MVP

- "I'm Feeling Lucky" button
- Population-based recommendations for cold start
- Implicit signals from dwell time
- Cross-user collaborative filtering
- A/B testing infrastructure
- Admin dashboard for threshold tuning
