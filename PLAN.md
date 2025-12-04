# Plan: Improve AI Chat Event Curation

## Problem Analysis

The AI chat feature is not following user intent. When a user asks for "most interesting events this weekend", the AI dumps ALL 287 matching events instead of curating a selection of ~6 truly interesting ones.

**Root Cause:** The system prompt in `app/api/chat/route.ts` lines 315-329 contains this instruction:
```
- Be thorough - list ALL matching events, don't skip any
```

This forces the AI to list everything regardless of user intent.

## Current Flow

1. User sends message → API route receives it
2. Date range extraction (Stage 1) - **Working well**
3. Events filtered by date range (e.g., 287 events for weekend)
4. All filtered events sent to AI with system prompt
5. AI follows prompt to list ALL events - **Problem here**

## Proposed Solution

Rewrite the system prompt to make the AI intelligent about event selection based on user intent.

### Key Changes to System Prompt

1. **Remove the "list ALL events" instruction**

2. **Add intent-aware selection logic:**
   - When user asks for "interesting/best/top/unique/recommendations" → Curate 5-8 standout events with brief explanations
   - When user asks for specific types (e.g., "jazz", "comedy", "free") → Filter and show relevant matches (up to ~15)
   - When user explicitly asks to "show all/list everything" → Show comprehensive list
   - For general queries without specifics → Show diverse selection across categories

3. **Add curation criteria for "interesting" events:**
   - Unique or special one-time events (not recurring weekly events like "Trivia Night")
   - Events at notable venues (Orange Peel, Grey Eagle, Harrah's Cherokee Center, etc.)
   - Events with specific themes or notable performers
   - Events that align with user's implied interests (excluded tags reveal preferences)
   - Avoid generic events like "Career Fair", "Committee Meeting", "Story Time" unless relevant

4. **Improve response format for curated selections:**
   - Include brief reason why each event is interesting/recommended
   - Group logically (by day, then by type/vibe)
   - Offer to show more if user wants

### Implementation Details

Modify `buildSystemPrompt()` function in `app/api/chat/route.ts` (lines 267-352).

**New System Prompt Structure:**

```
You are an AI assistant helping users discover events in Asheville, NC...

## Your Role
You are a knowledgeable local guide who curates event recommendations based on what the user is looking for. You do NOT just list events - you intelligently select and recommend based on the query.

## Response Behavior Guidelines

### When user asks for "interesting", "best", "unique", "recommendations", or "what should I do":
- Select 5-8 standout events that are genuinely notable
- Prioritize: live music at known venues, special one-time events, local favorites, unique experiences
- Avoid: recurring weekly meetings, generic classes, committee meetings, support groups
- For each event, briefly explain why you recommend it (1 sentence)

### When user asks for specific event types (e.g., "jazz", "comedy", "free outdoor"):
- Filter to only relevant events
- Show up to 15 matching events
- If many matches, highlight the top picks and mention there are more

### When user asks to "show all", "list everything", or wants a comprehensive view:
- Provide a complete list grouped by day
- No need for explanations per event

### When user asks about a specific event or wants details:
- Provide full details for that event
- Suggest similar events they might also enjoy

## What Makes an Event "Interesting" (Curation Criteria)
- Notable venue (Orange Peel, Grey Eagle, Harrah's Cherokee Center, NC Arboretum)
- Named performer/artist (band names, comedian names, etc.)
- Special one-time event (not recurring weekly)
- Holiday/seasonal special events
- High community interest (large events, festivals, markets)
- Unique local experiences

## What to Deprioritize
- Recurring weekly meetings (book clubs, meditation groups, support groups)
- Generic classes and workshops (unless specifically relevant)
- Career fairs, committee meetings, certification training
- Events with "Unknown" prices AND generic titles
- Online/virtual events (unless user asks)

## Response Format
- Use markdown with **bold headings** for dates
- Make event titles clickable links: [**Event Title**](url)
- Include: Date/time, Location, Price
- For curated selections: Add brief "why" explanation (e.g., "Classic Asheville venue", "Popular local band")
- End curated responses with: "Want to see more options? I can show [specific alternatives]."
```

### Example Improved Response

**User:** "most interesting events happening this weekend?"

**Current (Bad) Response:** Lists all 287 events...

**Improved Response:**
```markdown
Here are 6 standout events this weekend:

**Friday, December 5**

1. [**OK Go**](url) at The Orange Peel
   Fri, Dec 5, 8:00 PM | Price: TBD
   *The alt-rock band known for their creative music videos - rare Asheville appearance*

2. [**Southern Culture on the Skids**](url) at The Grey Eagle
   Fri, Dec 5, 8:00 PM | $27
   *Legendary Southern rock band - always a high-energy show*

3. [**Downtown Asheville Gallery Walk**](url)
   Fri, Dec 5, 5:00 PM | Free
   *First Friday gallery hop through downtown - great for art lovers*

**Saturday, December 6**

4. [**The Big Crafty**](url) at Harrah's Cherokee Center
   Sat, Dec 6, 10:00 AM | Free admission
   *Asheville's premier holiday craft market with 175+ local artisans*

5. [**Winter Lights**](url) at NC Arboretum
   Sat, Dec 6, 6:00 PM | $45
   *Stunning half-mile walking trail of holiday lights in the gardens*

6. [**ACS Presents Yuletide Candlelight**](url)
   Sat, Dec 6, 7:00 PM | Price: TBD
   *Asheville Choral Society's beloved annual holiday concert*

---

Want to see more? I can show you all live music, all free events, or the full list of 287 weekend events.
```

## Files to Modify

- `app/api/chat/route.ts` - Lines 267-352 (`buildSystemPrompt` function)

## Testing Plan

After changes, test with these queries:
1. "most interesting events this weekend?" → Should return ~6 curated events with explanations
2. "show me all free music events" → Should filter and list music events that are free
3. "list everything happening Saturday" → Should show comprehensive Saturday list
4. "what's good for a date night?" → Should curate romantic evening events
5. "any comedy shows?" → Should filter to comedy specifically
6. "what else?" (follow-up) → Should provide additional curated options
