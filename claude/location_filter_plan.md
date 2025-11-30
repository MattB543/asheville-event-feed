# Location Filter Implementation Plan

## Overview

Add a client-side location filter that allows users to filter events by specific towns in the Asheville area. The filter will appear as a dropdown in the FilterBar alongside the existing date, price, and tags filters.

## Current State Analysis

### Location Data in Database (1069 events)
From analyzing the database, location data comes in several formats:
- **City, State**: "Asheville, NC" (400 events), "Arden, NC", "Weaverville, NC"
- **City only**: "Asheville" (65), "Weaverville" (8), "Black Mountain" (6)
- **Venue only**: "The Orange Peel" (89), "The Grey Eagle" (54) - no city info
- **City @ Venue**: "Asheville @ Urban Orchard", "Black Mountain @ Pisgah Brewing"
- **Full address**: "46 Wall Street, Asheville, NC, United States, North Carolina 28801"
- **Online**: "Online" (10 events)
- **null/missing**: Some events have null location

### Existing Filter Architecture
- `FilterBar.tsx`: UI components with dropdown pattern (date, price, tags)
- `EventFeed.tsx`: Client-side filtering logic, localStorage persistence
- `ActiveFilters.tsx`: Shows active filter chips
- `lib/utils/locationFilter.ts`: Server-side NC filter (used during scraping)

---

## Implementation Plan

### Step 1: Create Location Extraction Utility

Create `lib/utils/extractCity.ts` to normalize location strings to city names.

```typescript
// Known NC cities in the Asheville area (ordered by likely frequency)
const KNOWN_CITIES = [
  'Asheville',
  'Black Mountain',
  'Weaverville',
  'Hendersonville',
  'Arden',
  'Candler',
  'Swannanoa',
  'Fletcher',
  'Mills River',
  'Brevard',
  'Waynesville',
  'Mars Hill',
  'Woodfin',
  'Leicester',
  'Fairview',
  'Burnsville',
  'Morganton',
  // Add more as needed
];

export function extractCity(location: string | null | undefined): string | null {
  if (!location) return null;
  if (location.toLowerCase() === 'online') return 'Online';

  // Check each known city (case insensitive)
  for (const city of KNOWN_CITIES) {
    if (location.toLowerCase().includes(city.toLowerCase())) {
      return city;
    }
  }

  return null; // Unknown location (venue-only, etc.)
}

export { KNOWN_CITIES };
```

**Logic:**
- Returns the city name if found in the location string
- Returns `"Online"` for online events
- Returns `null` for unknown locations (venue-only like "The Orange Peel")

### Step 2: Add Location Filter to FilterBar

Add a new dropdown to `components/FilterBar.tsx`:

1. **New types:**
```typescript
export type LocationFilterType = 'all' | 'asheville' | string; // 'all', 'asheville', or specific city name
```

2. **New props:**
```typescript
interface FilterBarProps {
  // ... existing props
  locationFilter: LocationFilterType;
  onLocationFilterChange: (val: LocationFilterType) => void;
  availableLocations: string[]; // Derived from events
}
```

3. **New dropdown UI** (similar to date/price dropdowns):
   - Icon: MapPin from lucide-react
   - "All Locations" (default)
   - "Asheville" (includes unknown locations)
   - Dynamic list of other cities found in events

### Step 3: Update EventFeed Filtering Logic

In `components/EventFeed.tsx`:

1. **New state:**
```typescript
const [locationFilter, setLocationFilter] = useState<LocationFilterType>(() =>
  getStorageItem("locationFilter", "all")
);
```

2. **Derive available locations from events:**
```typescript
const availableLocations = useMemo(() => {
  const citySet = new Set<string>();
  events.forEach(event => {
    const city = extractCity(event.location);
    if (city && city !== 'Online') {
      citySet.add(city);
    }
  });
  // Sort with Asheville first, then alphabetically
  const cities = Array.from(citySet);
  return cities.sort((a, b) => {
    if (a === 'Asheville') return -1;
    if (b === 'Asheville') return 1;
    return a.localeCompare(b);
  });
}, [events]);
```

3. **Add location filtering logic:**
```typescript
// In filteredEvents useMemo, after tag filter:

// 9. Location Filter
if (locationFilter !== "all") {
  const eventCity = extractCity(event.location);

  if (locationFilter === "asheville") {
    // "Asheville" filter includes: Asheville + unknown locations (null city)
    if (eventCity !== null && eventCity !== 'Asheville') {
      return false;
    }
  } else {
    // Specific city filter - exact match only
    if (eventCity !== locationFilter) {
      return false;
    }
  }
}
```

4. **Persist to localStorage:**
```typescript
localStorage.setItem("locationFilter", JSON.stringify(locationFilter));
```

### Step 4: Update ActiveFilters Display

In `components/ActiveFilters.tsx`:

1. **Add location filter type:**
```typescript
export interface ActiveFilter {
  id: string;
  type: "date" | "price" | "tag" | "search" | "location"; // add "location"
  label: string;
}
```

2. **In EventFeed, add location to activeFilters:**
```typescript
if (locationFilter !== "all") {
  const label = locationFilter === "asheville"
    ? "Asheville area"
    : locationFilter;
  filters.push({ id: "location", type: "location", label });
}
```

3. **Handle location filter removal:**
```typescript
// In handleRemoveFilter
if (id === "location") {
  setLocationFilter("all");
}
```

### Step 5: Update Clear All Filters

In `handleClearAllFilters`:
```typescript
setLocationFilter("all");
```

---

## UI/UX Design

### Location Dropdown Design

```
┌─────────────────────────────┐
│ [MapPin] Asheville area  ▼  │  ← Button when "asheville" selected
└─────────────────────────────┘

Dropdown menu:
┌─────────────────────────────┐
│ ○ All Locations             │
│ ● Asheville area            │  ← Includes unknown venues
│ ─────────────────────────── │
│ ○ Arden                     │
│ ○ Black Mountain            │
│ ○ Brevard                   │
│ ○ Candler                   │
│ ○ Hendersonville            │
│ ○ Weaverville               │
│ ─────────────────────────── │
│ ○ Online                    │
└─────────────────────────────┘
```

**Key UX decisions:**
- "Asheville area" instead of just "Asheville" to indicate it's inclusive
- Divider between Asheville and other cities
- Online at the bottom with divider
- Radio button selection (single choice)

---

## Behavior Specification

| Filter Selection | Events Shown |
|-----------------|--------------|
| "All Locations" | All events (no location filtering) |
| "Asheville area" | Events in Asheville + events with unknown/unrecognized locations (e.g., "The Orange Peel") |
| "Weaverville" | Only events explicitly in Weaverville |
| "Black Mountain" | Only events explicitly in Black Mountain |
| "Online" | Only online events |

**Rationale for "Asheville area" behavior:**
- Venues like "The Orange Peel" and "The Grey Eagle" are Asheville venues even though the location field doesn't specify the city
- Users filtering for "Asheville" expect to see these local venue events
- Other specific cities (Weaverville, Black Mountain) should be exact matches since users specifically chose that town

---

## Files to Modify

1. **Create:** `lib/utils/extractCity.ts` - City extraction utility
2. **Modify:** `components/FilterBar.tsx` - Add location dropdown
3. **Modify:** `components/EventFeed.tsx` - Add filtering logic and state
4. **Modify:** `components/ActiveFilters.tsx` - Support location filter type (minor)

---

## Testing Plan

1. **Verify city extraction:**
   - "Asheville, NC" → "Asheville"
   - "Black Mountain @ Pisgah Brewing" → "Black Mountain"
   - "The Orange Peel" → null (unknown)
   - "46 Wall Street, Asheville, NC, ..." → "Asheville"
   - "Online" → "Online"

2. **Verify filter behavior:**
   - "All Locations" shows all events
   - "Asheville area" shows Asheville events + venue-only events (Orange Peel, etc.)
   - "Weaverville" shows only Weaverville events
   - Filter persists across page reloads
   - Filter appears in active filters bar
   - "Clear all" resets location filter

3. **Verify UI:**
   - Dropdown matches existing date/price dropdown styling
   - Available cities are derived from actual event data
   - Label updates when filter is selected

---

## Edge Cases

1. **Event with venue in Asheville but city shows as different:**
   - Example: "The Grey Eagle (Special Event)" - should be treated as unknown → included in "Asheville area"

2. **Events with "Travelers Rest" or other SC cities:**
   - These slipped through server-side filter and appear in the database
   - They won't appear in the location dropdown since they're not in KNOWN_CITIES
   - They'll be excluded from "Asheville area" filter (city is unknown)
   - They'll only show in "All Locations"

3. **Empty available locations:**
   - If no events have recognizable cities, dropdown should still show "All Locations" and "Asheville area"

---

## Implementation Order

1. Create `extractCity.ts` utility
2. Add location state and persistence to `EventFeed.tsx`
3. Add location dropdown to `FilterBar.tsx`
4. Add filtering logic to `EventFeed.tsx`
5. Update `ActiveFilters.tsx` to handle location type
6. Test all scenarios

Estimated complexity: Medium
- Follows existing patterns exactly (date/price filters)
- Main complexity is city extraction logic
- No database changes required
- No API changes required
