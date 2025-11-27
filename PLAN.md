# Filter System Redesign Plan

## Current State Analysis

### Existing Filter Types
1. **Search** - Text search across title, organizer, location (in FilterBar)
2. **Price Filter** - Any/Free/Max price (dropdown in FilterBar)
3. **Blocked Hosts** - Organizer names to hide (textarea in SettingsModal)
4. **Blocked Keywords** - Title keywords to hide (textarea in SettingsModal)
5. **Hidden Events** - Specific event IDs (one-click from EventCard)
6. **Default Spam Filter** - Toggle with 60+ predefined keywords (checkbox in SettingsModal)
7. **Tags** - Exist on events but NOT filterable currently

### UX Problems
- Textareas are clunky for managing individual filter items
- No visual indicator of active filters in main UI
- No tag/category filtering despite tags existing
- Settings hidden behind modal (not accessible inline)
- No quick filters (Today, This Weekend, Free)
- No undo/feedback when hiding events or blocking hosts

---

## Proposed Design: Modern Filter System

### Design Philosophy
- **Chip-based inputs** instead of textareas
- **Active filters visible** in main UI as removable pills
- **Tag filtering** promoted to first-class feature
- **Quick filters** for common use cases
- **Toast feedback** for actions
- **Mobile-first** with bottom sheet on small screens

---

## UI Component Structure

### 1. FilterBar (Enhanced)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [🔍 Search events...]          [Today ▼] [Price ▼] [Tags ▼] [⚙ More]   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Components:**
- Search input (existing)
- **Date Quick Filter** dropdown: Today, Tomorrow, This Weekend, This Week, All
- **Price Filter** dropdown: Any, Free, Under $20, Under $50
- **Tags Filter** dropdown/popover: Multi-select checkboxes for available tags
- **More Filters** button: Opens advanced filter panel

### 2. Active Filters Bar (New)

Displayed below FilterBar when any filters are active:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Active: [Free ✕] [Music ✕] [Live Performance ✕] [Clear all]            │
└──────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Shows all active filters as removable chips
- Each chip has ✕ to remove individual filter
- "Clear all" link to reset everything
- Count badge showing hidden event count: "Showing 45 of 120 events"

### 3. Filter Popover/Dropdown (New Component)

For Tags and advanced filters:

```
┌─────────────────────────┐
│  Filter by Tags         │
├─────────────────────────┤
│  ☑ Live Music           │
│  ☑ Food & Drink         │
│  ☐ Family Friendly      │
│  ☐ Outdoor              │
│  ☐ Art & Culture        │
│  ☐ Sports               │
│  ☐ Nightlife            │
│  ☐ Free Events          │
├─────────────────────────┤
│  [Apply]    [Clear]     │
└─────────────────────────┘
```

### 4. Settings Panel (Redesigned)

Replace modal with slide-out panel or dedicated section:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FILTER SETTINGS                                                    [✕] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Blocked Hosts                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [Bad Organizer ✕] [Spam Events LLC ✕]  [+ Add host...]         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Blocked Keywords                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [certification ✕] [webinar ✕]  [+ Add keyword...]              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Default Spam Filter                                                    │
│  [ON/OFF toggle]  Hide common spam (60 keywords)  [View list]          │
│                                                                         │
│  Hidden Events                                                          │
│  12 events hidden  [Clear all hidden]                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5. Toast/Snackbar Component (New)

For action feedback:

```
┌─────────────────────────────────────────────────────────────────┐
│  Event hidden  [Undo]                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model Changes

### No Database Changes Required
- All filter state remains client-side in localStorage
- Tags already exist on events from AI tagging
- No new tables needed

### localStorage Keys (Enhanced)
```typescript
interface FilterState {
  blockedHosts: string[];           // existing
  blockedKeywords: string[];        // existing
  hiddenIds: string[];              // existing
  useDefaultFilters: boolean;       // existing
  selectedTags: string[];           // NEW - filter by these tags
  dateFilter: 'all' | 'today' | 'tomorrow' | 'weekend' | 'week';  // NEW
  priceFilter: 'any' | 'free' | 'under20' | 'under50';           // enhanced
}
```

---

## Implementation Plan

### Phase 1: Core Components

#### 1.1 Create FilterChip Component
```typescript
// components/ui/FilterChip.tsx
interface FilterChipProps {
  label: string;
  onRemove?: () => void;
  variant?: 'default' | 'active' | 'muted';
}
```

#### 1.2 Create FilterPopover Component
```typescript
// components/ui/FilterPopover.tsx
interface FilterPopoverProps {
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode;
}
```

#### 1.3 Create Toast/Snackbar Component
```typescript
// components/ui/Toast.tsx
interface ToastProps {
  message: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
}
```

### Phase 2: Enhanced FilterBar

#### 2.1 Update FilterBar.tsx
- Add Date quick filter dropdown
- Add Tags filter popover
- Improve Price filter options
- Add "More" button for settings

#### 2.2 Create ActiveFilters Component
```typescript
// components/ActiveFilters.tsx
interface ActiveFiltersProps {
  filters: ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
  totalEvents: number;
  filteredCount: number;
}
```

### Phase 3: Tag Filtering

#### 3.1 Extract Available Tags
- Compute unique tags from all events
- Sort by frequency or alphabetically
- Cache for performance

#### 3.2 Add Tag Filter Logic
- Multi-select tag filtering
- Show events matching ANY selected tag (OR logic)
- Persist selection to localStorage

### Phase 4: Settings Redesign

#### 4.1 Replace Textareas with Chip Input
```typescript
// components/ui/ChipInput.tsx
interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}
```

#### 4.2 Convert Modal to Slide Panel
- Use CSS transform for slide animation
- Or keep modal but improve content layout

### Phase 5: Polish & Feedback

#### 5.1 Add Toast Provider
- Context for managing toasts
- Auto-dismiss after timeout
- Undo support for hide/block actions

#### 5.2 Event Count Display
- Show "X of Y events" in header
- Update in real-time as filters change

---

## File Changes Summary

### New Files
```
components/
├── ui/
│   ├── FilterChip.tsx      # Removable chip component
│   ├── FilterPopover.tsx   # Dropdown popover for filter lists
│   ├── ChipInput.tsx       # Input field that creates chips
│   └── Toast.tsx           # Toast/snackbar component
├── ActiveFilters.tsx       # Active filter chips bar
└── ToastProvider.tsx       # Toast context provider
```

### Modified Files
```
components/
├── FilterBar.tsx           # Add date/tag filters, improve layout
├── EventFeed.tsx           # Add tag filtering, toast context
├── SettingsModal.tsx       # Redesign with chip inputs (or replace)
└── EventCard.tsx           # Add toast feedback for actions
app/
└── layout.tsx              # Wrap with ToastProvider
```

---

## Visual Design Specifications

### Color Palette (Using Existing Tailwind)
- **Active filter chip**: `bg-blue-100 text-blue-800 border-blue-200`
- **Removable chip**: Include `hover:bg-blue-200` and ✕ icon
- **Tag chips on cards**: `bg-blue-50 text-blue-700` (existing)
- **Price chip**: `bg-green-50 text-green-700` for Free (existing)
- **Toast**: `bg-gray-900 text-white` with rounded corners

### Typography
- Filter labels: `text-sm font-medium text-gray-700`
- Chip text: `text-xs font-medium`
- Active filter count: `text-sm text-gray-500`

### Spacing
- Chip padding: `px-2 py-1` or `px-3 py-1.5`
- Gap between chips: `gap-2`
- FilterBar padding: `p-4` (existing)

---

## Mobile Considerations

### Responsive Breakpoints
- **Desktop (≥640px)**: Horizontal filter bar, dropdowns
- **Mobile (<640px)**:
  - Filters collapse to icon buttons
  - Tap opens bottom sheet or full modal
  - Active filters scroll horizontally

### Touch Targets
- Minimum 44x44px for touch targets
- Larger ✕ buttons on chips for mobile

### Bottom Sheet Pattern (Optional)
For mobile, consider slide-up panel instead of dropdown:
```
┌─────────────────────────────────────┐
│  ═══════════════════════════        │ ← drag handle
│  Filter by Tags                     │
│                                     │
│  [Music] [Food] [Art] [Sports]...   │
│                                     │
│  [Apply Filters]                    │
└─────────────────────────────────────┘
```

---

## Accessibility Requirements

- All interactive elements must be keyboard accessible
- Focus management in popovers/modals
- ARIA labels for filter controls
- Screen reader announcements for filter changes
- Color contrast compliance (already good with current palette)

---

## Performance Considerations

- Debounce search input (already implemented: 300ms)
- Memoize filtered events computation (already using useMemo)
- Extract tags list once, not on every render
- Lazy load settings panel content

---

## Design Decisions (Confirmed)

1. **Tag filter logic**: ANY tag (OR) - Show events with at least one matching tag for better discovery

2. **Settings UI**: Redesigned modal - Keep modal pattern but with chip-based inputs instead of textareas

3. **Toast feedback**: Toast only - Show confirmation toast for hide/block actions (no undo button)

4. **Date filters**: Full set - Today, Tomorrow, This Weekend, This Week, All

---

## Success Criteria

1. Users can filter by tags without opening settings
2. Active filters are visible at all times
3. One-click to remove any filter
4. Blocked hosts/keywords use chips not textareas
5. Toast feedback for hide/block actions with undo
6. Mobile-friendly filter experience
7. No layout shift when filters change
