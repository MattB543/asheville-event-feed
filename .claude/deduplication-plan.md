# Deduplication Logic Analysis & Improvement Plan

## Executive Summary

The current deduplication logic has a fundamental flaw: **different event sources use different concepts for the "organizer" field**, causing cross-source duplicates to slip through. AVL Today and venue scrapers use the **venue name**, while Eventbrite uses the **actual organizer/promoter name**.

---

## Current Deduplication Logic

Located in `lib/utils/deduplication.ts`, the system uses three methods to identify duplicates:

### Method A: Same organizer + Same start time + Share ≥1 significant word in title
```typescript
const methodA = sameOrganizer && sameTime && shareWord;
```

### Method B: Exact same title + Same start time + 10+ shared description words
```typescript
const methodB = exactTitleMatch && sameTime && sharedDescWords >= 10;
```

### Method C: Same start time + 4+ consecutive significant words in title
```typescript
const methodC = sameTime && titlesShareOrderedWords(event1.title, event2.title, 4);
```

### Keep Preference (when duplicates found):
1. Known price (not "Unknown") wins
2. Longer description wins
3. Newer createdAt wins

---

## How Each Source Sets the "Organizer" Field

| Source | Organizer Field | Example Value |
|--------|-----------------|---------------|
| **AVL Today** | `ev.Venue \|\| "AVL Today"` | "The Orange Peel" |
| **Eventbrite** | `primary_organizer.name \|\| primary_venue.name` | "SPWM Productions" |
| **Meetup** | `group.name \|\| group.urlname` | "Asheville Hiking Club" |
| **Orange Peel** | Constant: `"The Orange Peel"` | "The Orange Peel" |
| **Harrah's** | Constant: `"Harrah's Cherokee Center Asheville"` | "Harrah's Cherokee Center Asheville" |
| **Grey Eagle** | Venue name | "The Grey Eagle" |
| **Live Music AVL** | Venue name | Varies by venue |
| **Facebook** | Event organizer | Varies |

---

## Identified Issues

### Issue 1: Cross-Source Organizer Mismatch (CRITICAL)

**The same event will have different organizers depending on the source:**

Example - Concert at The Orange Peel:
- **AVL Today**: organizer = "The Orange Peel" (venue)
- **Eventbrite**: organizer = "Band Name" (actual performer/promoter)
- **Orange Peel scraper**: organizer = "The Orange Peel" (venue)

**Result**: Method A fails because organizers don't match, even though it's the same event.

### Issue 2: Method A is Too Weak (Single Word Match)

Requiring only 1 shared significant word is insufficient:
- "Mountain Music Festival" and "Mountain Yoga Retreat" would match if same organizer + time
- "Asheville Art Walk" and "Asheville Food Tour" would match

### Issue 3: Venue Information Not Used

The `location` field often contains venue info that could help:
- Eventbrite: `"Asheville @ The Orange Peel"`
- This venue information is ignored in deduplication

### Issue 4: Method C Too Strict for Short Titles

Requiring 4 consecutive words fails for short event names:
- "Jazz Night" vs "Jazz Night at VOWL Bar" - only 2 consecutive significant words ("jazz", "night")

### Issue 5: Time Comparison Edge Cases

`isSameTime()` compares down to minutes in UTC, but:
- Some sources may report times slightly differently (e.g., 7:00 PM vs 7:30 PM for doors vs show)
- Events on the same day at the same venue are likely the same, even with slight time differences

---

## Proposed Improvements

### Improvement 1: Add Venue-Based Deduplication (Method D)

Extract venue from location field and use it for matching:

```typescript
// Method D: Same venue (extracted from location) + Same date + 2+ shared title words
const venue1 = extractVenue(event1.location);
const venue2 = extractVenue(event2.location);
const sameVenue = venue1 && venue2 && normalizeVenue(venue1) === normalizeVenue(venue2);
const sameDate = isSameDate(event1.startDate, event2.startDate); // Just date, not time
const share2Words = titlesShareWords(event1.title, event2.title, 2);

const methodD = sameVenue && sameDate && share2Words;
```

**Venue extraction patterns:**
- `"Asheville @ The Orange Peel"` → `"The Orange Peel"`
- `"Downtown, Asheville"` → `null` (no specific venue)

**Venue normalization:**
- `"The Orange Peel"` == `"Orange Peel"`
- `"Harrah's Cherokee Center Asheville"` == `"Harrahs Cherokee Center"`

### Improvement 2: Strengthen Method A (Require 2+ Words)

Change from 1 shared word to 2 shared words:

```typescript
// Current: titlesShareWord (1 word)
const shareWord = titlesShareWord(event1.title, event2.title);

// Proposed: titlesShareWords (2+ words)
const share2Words = titlesShareWords(event1.title, event2.title, 2);
```

Or use fuzzy similarity threshold:
```typescript
const titleSimilarity = calculateTitleSimilarity(title1, title2);
const methodA = sameOrganizer && sameTime && titleSimilarity >= 0.5;
```

### Improvement 3: Add Same-Day Venue Check

For known venues, if two events are on the same day at the same venue, they're likely the same:

```typescript
// Method E: Known venue + Same date + Any title overlap
const knownVenue1 = isKnownVenue(event1.organizer) || isKnownVenue(extractVenue(event1.location));
const knownVenue2 = isKnownVenue(event2.organizer) || isKnownVenue(extractVenue(event2.location));
const venueMatch = knownVenue1 && knownVenue2 && normalizeVenue(knownVenue1) === normalizeVenue(knownVenue2);
const sameDate = isSameDate(event1.startDate, event2.startDate);
const anyTitleOverlap = titlesShareWord(event1.title, event2.title);

const methodE = venueMatch && sameDate && anyTitleOverlap;
```

### Improvement 4: Known Venue Registry

Create a registry of known Asheville venues for matching:

```typescript
const KNOWN_VENUES = new Map([
  // Normalized name → [aliases]
  ['orange peel', ['the orange peel', 'theorangepeel', 'orange peel social hall']],
  ['harrahs', ['harrahs cherokee center', 'harrahs cherokee center asheville', 'hcca']],
  ['grey eagle', ['the grey eagle', 'grey eagle taqueria', 'greyeagle']],
  ['salvage station', ['salvage station asheville']],
  ['asheville music hall', ['the asheville music hall', 'amh']],
  ['isis', ['isis music hall', 'the isis']],
  ['vowl bar', ['vowl', 'the vowl bar']],
  // ... more venues
]);
```

### Improvement 5: Relax Method C for Short Titles

Reduce required consecutive words based on title length:

```typescript
function getMinConsecutiveWords(title1: string, title2: string): number {
  const words1 = extractWordsOrdered(title1);
  const words2 = extractWordsOrdered(title2);
  const minLength = Math.min(words1.length, words2.length);

  if (minLength <= 2) return 2;  // Short titles: require 2 consecutive
  if (minLength <= 4) return 3;  // Medium titles: require 3 consecutive
  return 4;                       // Long titles: require 4 consecutive
}
```

---

## Implementation Priority

### Phase 1 (High Impact, Low Risk)
1. **Add venue extraction utility** - Parse venue from location strings
2. **Create known venue registry** - Normalize venue names for matching
3. **Add Method D** - Venue + date + 2 word title match

### Phase 2 (Medium Impact)
4. **Strengthen Method A** - Require 2+ shared words instead of 1
5. **Add Method E** - Known venue + same date + any title overlap

### Phase 3 (Refinement)
6. **Relax Method C** for short titles
7. **Add title similarity scoring** (Levenshtein or similar)
8. **Add same-day time window** - Events at same venue within 2 hours are likely same

---

## Testing Strategy

Before deploying changes:

1. **Dry run on existing data** - Run new deduplication without deleting, log what would be removed
2. **Manual review** - Verify identified duplicates are actually duplicates
3. **Check for false positives** - Ensure different events at same venue aren't incorrectly merged
4. **Edge case testing**:
   - Same event, different titles (e.g., "Jazz Night" vs "Jazz Night with John Smith")
   - Same venue, different events on same day (e.g., matinee vs evening show)
   - Multi-day events

---

## Files to Modify

| File | Changes |
|------|---------|
| `lib/utils/deduplication.ts` | Add Methods D & E, strengthen Method A, venue extraction |
| `lib/utils/venues.ts` (new) | Known venue registry, venue normalization utilities |
| `scripts/test-deduplication.ts` (new) | Dry-run testing script |

---

## Questions to Clarify

1. **How aggressive should deduplication be?** Better to miss some duplicates (false negatives) or accidentally merge distinct events (false positives)?

2. **Should we keep one version per source?** Instead of deleting duplicates, keep best version and mark others as "duplicate_of: <id>"?

3. **Priority for same-day venue conflicts?** If Orange Peel has two events on the same day with similar names, which to keep?
