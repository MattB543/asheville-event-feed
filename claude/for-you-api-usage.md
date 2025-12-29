# For You API Usage Guide

## Quick Start

The For You API provides personalized event recommendations based on user signals (favorites, calendar clicks, shares, view source clicks, and hides).

## Endpoint

```
GET /api/for-you
```

## Authentication

Requires Supabase authentication. Include auth token in request headers.

## Query Parameters

| Parameter | Type | Default | Options | Description |
|-----------|------|---------|---------|-------------|
| `dateRange` | string | `'all'` | `'today'`, `'tomorrow'`, `'week'`, `'later'`, `'all'` | Filter events by date range |

## Response Format

```typescript
{
  events: ScoredEvent[],
  meta: {
    signalCount: number,      // Number of active signals (within 12 months)
    minimumMet: boolean        // true if user has >= 5 signals
  }
}
```

### ScoredEvent Structure

```typescript
interface ScoredEvent {
  event: {
    // Standard event fields (same as main feed)
    id: string;
    title: string;
    description: string | null;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    price: string | null;
    url: string;
    imageUrl: string | null;
    tags: string[] | null;
    // ... additional event fields
  },
  score: number,               // Personalization score (-1 to 1)
  tier: 'great' | 'good' | null,
  explanation: {
    primary: {
      eventId: string;
      title: string;
    } | null
  },
  bucket: 'today' | 'tomorrow' | 'week' | 'later'
}
```

## Score Tiers

| Tier | Threshold | Visual Treatment | Description |
|------|-----------|------------------|-------------|
| `great` | score > 0.7 | Badge + border/glow | Highly recommended |
| `good` | score > 0.5 | Badge only | Recommended |
| `null` | score > 0.3 | No indicator | Acceptable match |
| Hidden | score ≤ 0.3 | Not returned | Filtered out |

## Time Buckets

Events are automatically grouped into time buckets:

- **today**: Events happening today (in Eastern timezone)
- **tomorrow**: Events happening tomorrow
- **week**: Events within next 7 days (excluding today/tomorrow)
- **later**: Events beyond 7 days (up to 14 days ahead)

Events are sorted by score within each bucket.

## Example Usage

### JavaScript/TypeScript

```typescript
// Fetch all personalized events
const response = await fetch('/api/for-you', {
  headers: {
    'Authorization': `Bearer ${authToken}`
  }
});
const data = await response.json();

console.log(`Found ${data.events.length} personalized events`);
console.log(`User has ${data.meta.signalCount} active signals`);

// Group by bucket
const byBucket = {
  today: data.events.filter(e => e.bucket === 'today'),
  tomorrow: data.events.filter(e => e.bucket === 'tomorrow'),
  week: data.events.filter(e => e.bucket === 'week'),
  later: data.events.filter(e => e.bucket === 'later'),
};

// Display great matches
const greatMatches = data.events.filter(e => e.tier === 'great');
greatMatches.forEach(({ event, score, explanation }) => {
  console.log(`${event.title} (score: ${score.toFixed(2)})`);
  if (explanation.primary) {
    console.log(`  Similar to: ${explanation.primary.title}`);
  }
});
```

### Fetch today's personalized events

```typescript
const response = await fetch('/api/for-you?dateRange=today', {
  headers: {
    'Authorization': `Bearer ${authToken}`
  }
});
const data = await response.json();
```

### React Component Example

```tsx
import { useEffect, useState } from 'react';

interface ForYouData {
  events: ScoredEvent[];
  meta: {
    signalCount: number;
    minimumMet: boolean;
  };
}

function ForYouFeed() {
  const [data, setData] = useState<ForYouData | null>(null);
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'tomorrow'>('all');

  useEffect(() => {
    async function fetchForYou() {
      const response = await fetch(`/api/for-you?dateRange=${dateRange}`);
      const json = await response.json();
      setData(json);
    }
    fetchForYou();
  }, [dateRange]);

  if (!data) return <div>Loading...</div>;

  if (data.events.length === 0) {
    return (
      <div>
        <p>No personalized events yet!</p>
        {!data.meta.minimumMet && (
          <p>Like {5 - data.meta.signalCount} more events to improve recommendations.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {!data.meta.minimumMet && (
        <div className="banner">
          {data.meta.signalCount}/5 events liked — keep going to improve your recommendations!
        </div>
      )}

      {data.events.map(({ event, score, tier, explanation, bucket }) => (
        <div key={event.id} className={`event-card tier-${tier}`}>
          <h3>{event.title}</h3>
          {tier && <span className="badge">{tier} Match</span>}
          {explanation.primary && (
            <p className="explanation">
              Similar to {explanation.primary.title}
            </p>
          )}
          <p className="bucket">{bucket}</p>
        </div>
      ))}
    </div>
  );
}
```

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Unauthorized"
}
```
User is not authenticated.

### 500 Internal Server Error
```json
{
  "error": "Failed to generate personalized feed"
}
```
Server error occurred during processing.

## Performance Characteristics

- **First Request**: ~1-2 seconds (computes centroids)
- **Cached Requests**: ~200-500ms (uses cached centroids)
- **Cache Duration**: 1 hour
- **Cache Invalidation**: Automatic when user adds/removes signals

## Minimum Signal Requirements

- **Functional Minimum**: 1 signal (feed will work but be less accurate)
- **Recommended Minimum**: 5 signals (spec threshold for "active state")
- **Optimal**: 10+ signals (better personalization)

## Notes

1. **Embeddings Required**: Events without embeddings are excluded from results
2. **Time Zone**: All date calculations use Eastern timezone (consistent with main feed)
3. **Event Horizon**: Only fetches events up to 14 days in the future
4. **Score Range**: Scores are between -1 and 1, but most fall in 0.3-0.9 range
5. **Explanation**: Only provided for `great` and `good` tier events

## Integration with Signals API

Users build their interest profile via the Signals API:

```typescript
// Add positive signal
await fetch('/api/signals', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    eventId: 'event-123',
    signalType: 'favorite' // or 'calendar', 'share', 'viewSource'
  })
});

// Add negative signal (hide event)
await fetch('/api/signals', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    eventId: 'event-456',
    signalType: 'hide'
  })
});
```

After adding signals, the For You feed will automatically recompute centroids and update recommendations.
