# Ticketmaster Discovery API Reference

## Finding Venue IDs

Search for venues to get their Ticketmaster ID:

```bash
curl "https://app.ticketmaster.com/discovery/v2/venues.json?apikey=YOUR_KEY&keyword=Orange%20Peel&stateCode=NC"
```

Response includes `id` field - this is the venueId for event queries.

## Fetching Events by Venue

```bash
curl "https://app.ticketmaster.com/discovery/v2/events.json?apikey=YOUR_KEY&venueId=KovZpa3hYe&size=50&page=0&sort=date,asc"
```

## Response Structure

```typescript
interface TMResponse {
  _embedded?: {
    events?: TMEvent[];
  };
  page?: {
    totalElements: number;
    totalPages: number;
    number: number;  // Current page (0-indexed)
    size: number;
  };
}

interface TMEvent {
  id: string;
  name: string;
  url: string;
  dates?: {
    start?: {
      localDate?: string;      // "2025-12-04"
      localTime?: string;      // "19:00:00"
      dateTime?: string;       // ISO8601 with timezone
    };
  };
  priceRanges?: Array<{
    min: number;
    max: number;
    currency: string;
  }>;
  images?: Array<{
    url: string;
    width: number;
    height: number;
    ratio: string;  // "16_9", "3_2", "4_3", etc.
  }>;
  info?: string;           // Event logistics
  pleaseNote?: string;     // Additional notes
  description?: string;    // Rarely populated
  _embedded?: {
    venues?: Array<{ name: string }>;
    attractions?: Array<{ name: string; description?: string }>;
  };
}
```

## Best Practices

1. **Rate Limiting**: Max 5 requests/second, add 200ms delays
2. **Images**: Prefer `16_9` ratio, sort by width descending
3. **Dates**: Use `dateTime` if available (includes timezone), fallback to `localDate` + `localTime`
4. **Pagination**: Check `page.number < page.totalPages - 1` for more pages
5. **API Key**: Store in `TICKETMASTER_API_KEY` environment variable

## Known Venue IDs (Asheville Area)

| Venue | ID |
|-------|-----|
| Harrah's Cherokee Center Asheville | KovZpZAJvnIA |
| The Orange Peel | KovZpa3hYe |
