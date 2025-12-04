# AI Chat 2-Step Date Range Optimization Plan

## Problem Statement
Currently, the AI chat sends ALL filtered events (potentially 1,000+) to the AI for every query. This is:
- **Slow**: Large context = slower response time
- **Expensive**: More tokens = higher API costs
- **Unnecessary**: Most queries only need a subset of events (e.g., "this weekend" only needs 3 days)

## Proposed Solution: 2-Step Date Range Extraction

### Step 1: Date Range Inference (Fast AI Call)
A lightweight AI call that:
1. Takes the user's message + current date/time
2. Determines the relevant date range for the query
3. Returns a structured response with start/end dates

**Example inputs → outputs:**
| User Query | Inferred Date Range |
|------------|---------------------|
| "date night ideas for this weekend" | Fri Dec 6 - Sun Dec 8 |
| "what's happening tonight" | Today only (Dec 3) |
| "live music this Friday" | Fri Dec 6 only |
| "events next week" | Mon Dec 9 - Sun Dec 15 |
| "find me trivia nights" | Default (2 weeks from today) |
| "New Year's Eve events" | Dec 31 only |

### Step 2: Main AI Response
1. Filter events to the inferred date range
2. Also apply user's existing filters (price, tags, locations, etc.)
3. Send only these filtered events to the main AI
4. Get the full response

## Implementation Details

### New API Endpoint or Route Logic

**Option A: Single endpoint with 2-step logic (RECOMMENDED)**
- `/api/chat` handles both steps internally
- Step 1: Extract date range (if no date filter already applied)
- Step 2: Get main response with filtered events

**Option B: Separate endpoint for date extraction**
- `/api/chat/extract-dates` - returns date range
- Client filters events, then calls `/api/chat`
- More complex, requires client changes

### Date Range Extraction Prompt

```
You are a date range extractor for an event search system.

Current date/time: Wednesday, December 3, 2025 at 2:30 PM (Eastern Time)

Given the user's query, determine the relevant date range for finding events.

Respond with ONLY a JSON object in this format:
{
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "reasoning": "brief explanation"
}

Rules:
- "tonight" = today's date only
- "this weekend" = upcoming Friday through Sunday
- "tomorrow" = the next day
- "this week" = today through Sunday
- "next week" = Monday through Sunday of next week
- "next month" = all of the following calendar month
- If no time reference, use default range of 14 days from today
- For specific dates mentioned (e.g., "December 31"), use that date

User query: "{userMessage}"
```

### Model Selection

**Step 1 (Date Extraction):**
- Use `gemini-2.0-flash-lite` (fast, cheap, via OpenRouter)
- Alternatively: `gpt-4o-mini` or similar fast model
- Non-streaming, just need JSON response

**Step 2 (Main Response):**
- Continue using `gemini-2.0-flash-001` (current model)
- Streaming response as before

### Skip Date Extraction When:
1. User already has a date filter applied (today, tomorrow, weekend, custom)
2. User explicitly mentions seeing "all events"
3. Subsequent messages in same conversation (cache the inferred range?)

### Default Behavior:
- If date extraction fails or is ambiguous: **14 days from today**
- If user says something like "show me everything": **30 days**

## Files to Modify

### 1. `app/api/chat/route.ts` (Major Changes)
- Add new function: `extractDateRange(userMessage: string, currentDate: Date)`
- Modify `POST` handler to implement streaming 2-step flow:
  1. Receive request with ALL events and previous date range (if any)
  2. Check if date extraction needed (first message or date-change detected)
  3. If needed, call fast AI to extract date range
  4. Stream progress message: `{ type: "dateRange", data: { start, end, message } }`
  5. Filter events by date range + user's other filters
  6. Stream main AI response as before

### 2. `components/AIChatModal.tsx` (Major Changes)
- Pass ALL events (from EventFeed) instead of pre-filtered events
- Also pass existing filter state (for non-date filters like price, tags)
- Track `currentDateRange` in component state
- Pass `currentDateRange` to API for follow-up messages
- Handle new streaming message type for date range display
- Show date range indicator in chat: "Checking events between X and Y..."

### 3. `components/EventFeed.tsx` (Minor Changes)
- Pass `events` (all events) to AIChatModal instead of `filteredEvents`
- Keep passing `activeFilters` for non-date filtering

### 4. New Types (in route.ts or separate file)
```typescript
interface DateRangeResult {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  displayMessage: string;  // "Checking events between Fri Dec 5th..."
}

interface StreamMessage {
  type: "dateRange" | "content" | "done" | "error";
  data: DateRangeResult | string;
}
```

### 5. API Request Changes
```typescript
interface ChatRequest {
  messages: ChatMessage[];
  allEvents: Event[];  // NEW: all events, not pre-filtered
  filters: {
    // Keep existing filter types for non-date filtering
    priceFilter?: string;
    tagsInclude?: string[];
    tagsExclude?: string[];
    locations?: string[];
  };
  currentDateRange?: {  // NEW: previous date range from conversation
    startDate: string;
    endDate: string;
  };
}

## Edge Cases to Handle

1. **Multi-turn conversations**: If user asks "what about next weekend?" after asking about "this weekend", need to re-extract dates
2. **Non-date queries**: "find me trivia nights" - use default 2-week range
3. **Past dates**: "what happened last weekend" - should probably say "no past events" or filter correctly
4. **Specific venues**: "events at Orange Peel this month" - extract month + venue filter

## User Decisions (Confirmed)

1. **Show inferred date range**: YES
   - Display immediately as progress indicator: "Checking events between Fri Dec 5th and Sun Dec 7th..."
   - This gives user feedback while the main AI is thinking

2. **Default range**: 2 weeks (14 days) when query doesn't specify dates

3. **Follow-up handling**: Keep same date range for conversation
   - Store inferred date range in client state
   - Only re-extract if user explicitly mentions different dates (e.g., "what about next weekend?")
   - Detect date-change phrases: "next week", "tomorrow", "this weekend", etc.

## Performance Expectations

| Scenario | Current (1000 events) | After (filtered) |
|----------|----------------------|------------------|
| "tonight" | 1000 events in context | ~30-50 events |
| "this weekend" | 1000 events | ~150-200 events |
| "next week" | 1000 events | ~300 events |
| API latency | ~3-5 seconds | ~1-2 seconds |
| Token cost | High | 50-80% reduction |

## Implementation Order

### Phase 1: Backend - Date Extraction
1. Add `extractDateRange()` function to `/api/chat/route.ts`
   - Fast AI call to OpenRouter with gemini-2.0-flash-lite
   - Returns `{ startDate, endDate, displayMessage }`
   - Handle JSON parsing and fallback to 14-day default

2. Add `shouldReExtractDates()` helper function
   - Detects date-changing phrases: "tomorrow", "next week", "weekend", etc.
   - Returns true for first message or when date change detected

3. Add `filterEventsByDateRange()` helper function
   - Takes events and date range, returns filtered events
   - Handles timezone correctly (Eastern Time)

### Phase 2: Backend - Streaming Protocol
4. Modify `/api/chat` POST handler to use custom streaming:
   - First, stream date range message if extracted
   - Then stream main AI response
   - Use SSE format with message types

5. Update system prompt builder to accept filtered events
   - Remove date filter from filters section (now handled by extraction)
   - Update event count to reflect filtered count

### Phase 3: Frontend - AIChatModal Changes
6. Update `AIChatModal.tsx` props:
   - Accept `allEvents` instead of `filteredEvents`
   - Keep `activeFilters` but ignore date filter

7. Add `currentDateRange` state to AIChatModal
   - Persist across messages in same conversation
   - Reset when modal closes

8. Update stream parsing to handle new message types:
   - `dateRange`: Show "Checking events between X and Y..."
   - `content`: Append to assistant message (current behavior)
   - Handle fallback for backwards compatibility

9. Add date range indicator UI:
   - Show as a small system message before assistant response
   - Style it as informational (e.g., italic gray text)

### Phase 4: Frontend - EventFeed Integration
10. Update `EventFeed.tsx`:
    - Pass `events` (all events) to AIChatModal
    - Remove date filter from `activeFilters` passed to chat

### Phase 5: Testing & Polish
11. Test various queries:
    - "tonight", "this weekend", "next Friday"
    - Non-date queries: "trivia nights", "live music"
    - Follow-ups: "what else?", "what about next week?"

12. Performance testing:
    - Compare response times before/after
    - Verify token count reduction

13. Error handling:
    - Date extraction fails → use 14-day default
    - API timeout → show error gracefully
