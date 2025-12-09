# Implementation Plan: Copy View / Shareable URL Feature

## Overview

Add a "Copy View" button that appears when filters are active. This button copies the current page URL with filter parameters, allowing users to share their exact filtered view with friends.

## Current State Analysis

### Existing Infrastructure
- **`exportParams`** (EventFeed.tsx:689-736): Already builds a query string with all filter state
- **`ActiveFilters`** component: Displays active filters and "XML/Markdown" export links using `exportParams`
- **XML/Markdown exports**: Already parse URL params and apply filters server-side (app/api/export/xml/route.ts)
- **Toast system**: Available via `useToast()` hook for copy feedback

### Filter Parameters (from exportParams)
| Parameter | Description | Shareable? |
|-----------|-------------|------------|
| `search` | Search query | Yes |
| `dateFilter` | all/today/tomorrow/weekend/dayOfWeek/custom | Yes |
| `days` | Comma-separated day numbers (0-6) for dayOfWeek | Yes |
| `dateStart`, `dateEnd` | Custom date range | Yes |
| `priceFilter` | any/free/under20/under100/custom | Yes |
| `maxPrice` | Custom max price | Yes |
| `tagsInclude` | Comma-separated included tags | Yes |
| `tagsExclude` | Comma-separated excluded tags | Yes |
| `locations` | Comma-separated location filters | Yes |
| `useDefaultFilters` | Whether default spam filter is enabled | Yes |
| `blockedHosts` | Personal blocked hosts | **No** |
| `blockedKeywords` | Personal blocked keywords | **No** |
| `hiddenEvents` | Personal hidden events | **No** |

## Implementation Design

### Part 1: Shareable URL Generation (EventFeed.tsx)

Create a `shareParams` useMemo that includes only shareable filters (excludes personal filters like blockedHosts, blockedKeywords, hiddenEvents):

```typescript
const shareParams = useMemo(() => {
  const params = new URLSearchParams();

  if (search) params.set("search", search);
  if (dateFilter !== "all") params.set("dateFilter", dateFilter);
  if (dateFilter === "dayOfWeek" && selectedDays.length > 0) {
    params.set("days", selectedDays.join(","));
  }
  if (dateFilter === "custom" && customDateRange.start) {
    params.set("dateStart", customDateRange.start);
    if (customDateRange.end) params.set("dateEnd", customDateRange.end);
  }
  if (priceFilter !== "any") params.set("priceFilter", priceFilter);
  if (priceFilter === "custom" && customMaxPrice !== null) {
    params.set("maxPrice", customMaxPrice.toString());
  }
  if (tagFilters.include.length > 0)
    params.set("tagsInclude", tagFilters.include.join(","));
  if (tagFilters.exclude.length > 0)
    params.set("tagsExclude", tagFilters.exclude.join(","));
  if (selectedLocations.length > 0)
    params.set("locations", selectedLocations.join(","));
  if (!useDefaultFilters) params.set("useDefaultFilters", "false");

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}, [search, dateFilter, customDateRange, selectedDays, priceFilter,
    customMaxPrice, tagFilters, selectedLocations, useDefaultFilters]);
```

### Part 2: Copy View Button (ActiveFilters.tsx)

Add "Copy View" button that appears when filters are active:

**New props:**
- `shareParams?: string` - The shareable URL query string

**UI placement** (when filters active):
```
Showing 42 of 156 events · Copy View · XML · Markdown
```

**Click handler:**
```typescript
const handleCopyView = async () => {
  const url = `${window.location.origin}${window.location.pathname}${shareParams || ""}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied to clipboard!");
  } catch {
    showToast("Failed to copy link", "error");
  }
};
```

### Part 3: Read URL Parameters on Page Load (EventFeed.tsx)

When user opens a shared URL, apply URL parameters to filter state:

```typescript
// Read URL params once after hydration
useEffect(() => {
  if (!isLoaded) return;

  const params = new URLSearchParams(window.location.search);

  // Check if any filter params exist
  const hasUrlFilters = params.has('search') || params.has('dateFilter') ||
    params.has('priceFilter') || params.has('tagsInclude') ||
    params.has('tagsExclude') || params.has('locations');

  if (!hasUrlFilters) return;

  // Apply URL params to state
  if (params.has('search')) setSearchInput(params.get('search') || '');

  if (params.has('dateFilter')) {
    const df = params.get('dateFilter') as DateFilterType;
    if (['all','today','tomorrow','weekend','dayOfWeek','custom'].includes(df)) {
      setDateFilter(df);
    }
  }
  // ... etc for other params
}, [isLoaded]);
```

## Files to Modify

1. **components/EventFeed.tsx**
   - Add `shareParams` useMemo
   - Add useEffect to read URL params on mount
   - Pass `shareParams` to ActiveFilters

2. **components/ActiveFilters.tsx**
   - Add `shareParams` prop
   - Add "Copy View" link with click handler
   - Import Link icon from lucide-react

## UI/UX Design

- **Appearance:** Text link matching existing "XML" and "Markdown" style
- **Icon:** Link2 icon from lucide-react (optional, could be text-only)
- **Feedback:** Toast "Link copied to clipboard!" on success
- **Visibility:** Only show when filters are active (via activeFilters.length > 0)

## Edge Cases

1. **Empty filters:** Button hidden when no filters active
2. **Invalid URL params:** Validate before applying (type guards)
3. **Clipboard API failure:** Show error toast
4. **SSR/Hydration:** Only read URL params after isLoaded=true

## Testing

1. Apply filters → Copy View → Verify URL contains params
2. Open copied URL in new tab → Verify same filters applied
3. Open URL with invalid params → Verify graceful handling
4. Verify personal filters (blockedHosts etc.) NOT in shared URL
