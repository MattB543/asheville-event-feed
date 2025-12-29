# AI Prompts & Flow Report

*Generated: 2025-12-29*

This document details all AI prompts used in the Asheville Event Feed system (excluding image generation).

---

## Table of Contents

1. [Overview](#overview)
2. [Tagging & Summary Generation](#1-tagging--summary-generation)
3. [Embedding Generation](#2-embedding-generation)
4. [Event Quality Scoring](#3-event-quality-scoring)
5. [AI Deduplication](#4-ai-deduplication)
6. [Data Enrichment](#5-data-enrichment)
7. [AI Chat](#6-ai-chat)
8. [Personalization](#7-personalization)
9. [Recurring Detection](#8-recurring-detection)
10. [Processing Flow Diagram](#processing-flow)

---

## Overview

| Feature | Model | Has Prompt? | Trigger |
|---------|-------|-------------|---------|
| Tags & Summary | Azure OpenAI (gpt-5-mini) | Yes | Cron `/api/cron/ai` |
| Embeddings | Google Gemini (gemini-embedding-001) | No (text formatting) | Cron `/api/cron/ai` |
| Scoring | Azure OpenAI (gpt-5-mini) | Yes | Cron `/api/cron/ai` |
| AI Dedup | Azure OpenAI (gpt-5-mini) | Yes | Cron `/api/cron/dedup` |
| Enrichment | Azure OpenAI (gpt-5-mini) | Yes | Manual |
| Chat | Azure OpenAI + OpenRouter fallback | Yes (2-step) | User POST `/api/chat` |
| Personalization | None (math only) | No | Real-time |
| Recurring Detection | None (DB query) | No | Cron `/api/cron/ai` |

---

## 1. Tagging & Summary Generation

**File:** `lib/ai/tagAndSummarize.ts`
**Model:** Azure OpenAI (default: `gpt-5-mini`)
**Trigger:** `/api/cron/ai` cron job (every 6 hours at :10)

### System Prompt

```
You are an expert event analyzer for Asheville, NC. You will analyze events and provide two things:

1. TAGS - Assign tags in two categories:
   - OFFICIAL TAGS (1-4 tags): Select ONLY from the allowed list below
   - CUSTOM TAGS (1-5 tags): Create descriptive tags for genre, vibe, skill level, venue type, etc.

2. SUMMARY - Generate a 1-2 sentence structured summary for semantic search.

## ALLOWED OFFICIAL TAGS (use ONLY these exact tags):

Entertainment:
- Live Music – concerts, bands, live performances
- Comedy – stand-up, improv, showcases
- Theater & Film – plays, performances, movie nights
- Dance – lessons, parties, social dance nights
- Trivia – pub trivia, game nights
- Open Mic – open mic nights, poetry slams, showcases
- Karaoke – karaoke nights, sing-along events

Food & Drink:
- Dining – special dinners, brunches, prix fixe meals
- Beer – brewery events, tastings
- Wine & Spirits – wine tastings, cocktail events

Activities:
- Art – galleries, visual art events, art classes
- Crafts – pottery, jewelry, DIY workshops
- Fitness – yoga, exercise, climbing, general fitness
- Sports – team sports, athletic events, competitions
- Wellness – sound healing, holistic health, self-care
- Spiritual – ceremonies, religious gatherings, dharma talks
- Meditation – meditation sits, mindfulness, guided meditation
- Outdoors – hiking, nature, parks
- Tours – walking tours, ghost tours, historical
- Gaming – board games, D&D, video games
- Education – classes, workshops, lectures, learning events
- Tech – technology meetups, coding, maker events
- Book Club – book discussions, reading groups, literary meetups
- Museum Exhibition – museum exhibits, gallery shows, curated displays

Audience/Social:
- Family – kid-friendly, all-ages
- Dating – singles events, speed dating
- Networking – business, professional meetups
- Nightlife – 21+, bar events, late-night
- LGBTQ+ – pride, queer-specific events
- Pets – dog-friendly, goat yoga, cat lounges
- Community – neighborhood events, local meetups
- Volunteering – volunteer opportunities, community service, charity work
- Support Groups – recovery, grief, mental health support meetings

Seasonal:
- Holiday – seasonal celebrations, Christmas, Halloween, etc.
- Markets – pop-ups, vendors, shopping, craft fairs

## TAG RULES:
1. For official tags: ONLY use tags from the list above. Do NOT create new official tags.
2. NEVER use category names as tags (not "Entertainment", "Food & Drink", etc.)
3. Use the exact spelling and capitalization for official tags.
4. Custom tags should be lowercase, descriptive, and specific (e.g., "jazz", "beginner friendly").

## SUMMARY RULES:
- NEVER repeat the event title or venue name (assume the user has already read them).
- Focus on the "Hook": What is the specific vibe, a unique detail not in the title, or the exact activity?
- Format: A single, active sentence under 20 words.
- Start with a verb (e.g., "Featuring," "Blending," "Showcasing," "Exploring") or a direct descriptor.
- No city names, no dates, no prices.
- Bad: "Live music at The Orange Peel featuring Mersiv." (Redundant)
- Good: "Bass-heavy electronic sets with immersive lighting and experimental beat-driven performances."
- Bad: "Group meditation at Urban Dharma featuring silent sits." (Redundant)
- Good: "Guided silent practice focusing on traditional Buddhist techniques and community empowerment."

Return ONLY valid JSON in this format:
{"official": ["Tag1", "Tag2"], "custom": ["tag1", "tag2"], "summary": "Your summary here."}
```

### User Prompt Template

```
Analyze this event:

Title: {event.title}
Description: {event.description (first 500 chars)}
Location: {event.location}
Organizer: {event.organizer}
Date: {event.startDate ISO}
```

### Output Format

```json
{
  "official": ["Live Music", "Nightlife"],
  "custom": ["jazz", "local artists", "late night"],
  "summary": "Featuring local jazz trio with improvisation and soul-influenced grooves."
}
```

### Processing Flow

1. Finds events missing tags OR summary (next 3 months, max 100)
2. Processes in batches of 5 with 1-second delays
3. Validates official tags against whitelist
4. Normalizes custom tags (capitalizes words)
5. Updates database with valid results

---

## 2. Embedding Generation

**File:** `lib/ai/embedding.ts`
**Model:** Google Gemini (`gemini-embedding-001`, 1536 dimensions)
**Trigger:** `/api/cron/ai` cron job

### No LLM Prompt - Text Formatting Only

The embedding is generated from a formatted text string:

```
"{Title}: {AI Summary}"
```

**Example:**
```
"Jazz Night at Grey Eagle: Featuring local jazz trio with improvisation and soul-influenced grooves."
```

### Code (createEmbeddingText function)

```typescript
export function createEmbeddingText(title: string, aiSummary: string): string {
  return `${title}: ${aiSummary}`;
}
```

### Key Implementation Details

**Task Types:**
- Documents (stored events): `TaskType.RETRIEVAL_DOCUMENT`
- Search queries: `TaskType.RETRIEVAL_QUERY`

**API Call Configuration:**
```typescript
const result = await model.embedContent({
  content: { role: "user", parts: [{ text }] },
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  outputDimensionality: 1536,
});
```

**Helper Functions:**
- `generateEmbedding(text, options)` - Generate embedding for stored documents
- `generateQueryEmbedding(query)` - Generate embedding for search queries
- `cosineSimilarity(a, b)` - Calculate similarity between two embeddings (returns -1 to 1)

### Processing Flow

1. Finds events WITH summary but WITHOUT embedding (next 3 months, max 100)
2. Calls `createEmbeddingText()` to format input
3. Generates embedding using Gemini with `TaskType.RETRIEVAL_DOCUMENT`
4. Stores 1536-dimensional vector in database
5. Processes in batches of 10 with 500ms delays

### Batch Processing

```typescript
export async function generateEmbeddings(
  texts: string[],
  options?: {
    taskType?: TaskType;
    delayMs?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<(number[] | null)[]>
```

Default delay: 100ms between requests to avoid rate limits

---

## 3. Event Quality Scoring

**File:** `lib/ai/scoring.ts`
**Model:** Azure OpenAI (default: `gpt-5-mini`)
**Trigger:** `/api/cron/ai` cron job

### System Prompt

```
You are an expert Event Curator for Asheville, NC. Your goal is to rank events so that the "Score" acts as a discovery heat-map.

## DIMENSION 1 - Rarity & Urgency (0-10)
How "missable" is this?
- 1-3: Daily/Weekly (Trivia, regular yoga, open mics).
- 4-5: Monthly or Seasonal (Monthly markets, standard holiday displays like Winter Lights).
- 6-7: Special Limited Runs (A 2-week theater run, a 3-stop workshop series).
- 8-9: True One-Offs (A touring band's only stop, a specific guest speaker, a unique gala).
- 10: Once-in-a-decade (Legendary artist, Centennial celebration, Solar Eclipse).

## DIMENSION 2 - Cool & Unique Factor (0-10)
How much "Main Character Energy" does this event have?
- 1-3: Standard/Utility (AA meetings, generic classes, basic networking).
- 4-6: Solid Entertainment (Local bands, standard stand-up, local brewery jams).
- 7-8: High Concept (Themed masquerades, specialized workshops like "Tarot with Cats," niche festivals).
- 9-10: Truly Novel (GWAR, extreme circus, "Crankie Fest," events with high production "weirdness").

## DIMENSION 3 - Magnitude & Caliber (0-10)
What is the scale of the "Draw"?
- 1-3: Hyper-local/Peer-led (Small meetups, student groups, neighborhood walks).
- 4-5: Professional Local (Established local acts, venue-staple performers, paid workshops).
- 6-7: Regional Draw (Well-known SE touring acts, mid-sized venue headliners like at Grey Eagle).
- 8-9: National Headliner (Acts at Orange Peel, Harrah's Arena, or major touring theater).
- 10: Global Icon (A-list celebrities, stadium-level acts, massive 10k+ person festivals).

## CALIBRATION LOGIC:
- If it's a TOURING ACT at a major venue (Orange Peel, Grey Eagle, Rabbit Rabbit), it should automatically start at 18+ total.
- If it's a massive ASHEVILLE TRADITION (Gingerbread competition, Crankie Fest), it should score 20+.
- RECURRING EVENT RULE: A weekly event can still score high on Magnitude/Uniqueness. Don't let a "1" in Rarity crush a "9" in Magnitude.
- BELL CURVE: Aim for a broader spread.
  - 0-10: Standard weekly/utility.
  - 11-17: High-quality local weekend options.
  - 18-24: Major touring shows and significant local productions.
  - 25-30: "The biggest event of the month."

Return ONLY valid JSON:
{"rarity": N, "unique": N, "magnitude": N, "reason": "Short explanation."}
```

### User Prompt Template

```
Score this event:

Title: {event.title}
Description: {first 300 chars}
Location: {event.location}
Organizer: {event.organizer}
Tags: {tag1, tag2, ...}
Summary: {event.aiSummary}
Date: {formatted date}
Price: {event.price}

Similar upcoming events (by semantic similarity):
1. "{title}" at {location} on {date} ({XX}% similar)
2. "{title}" at {location} on {date} ({XX}% similar)
...

(Or if no similar events: "(No similar events found - this may indicate a unique event)")
```

### Output Format

```json
{
  "rarity": 8,
  "unique": 7,
  "magnitude": 9,
  "reason": "Major touring act at Orange Peel - rare Asheville stop for nationally recognized band."
}
```

### Similar Events Mechanism (Key to Scoring)

**How it works:**

The scoring system uses pgvector similarity search to provide context about how rare/unique an event is:

1. **Query Similar Events** (`lib/db/similaritySearch.ts`):
```typescript
const similarEvents = await findSimilarEvents(event.id, {
  limit: 20,
  minSimilarity: 0.4,  // 40% similarity threshold
  futureOnly: true,     // Only upcoming events
  orderBy: 'similarity' // Most similar first
});
```

2. **Calculate Similarity** (using pgvector's cosine distance):
```typescript
const similarity = sql<number>`1 - (${cosineDistance(events.embedding, sourceEmbedding)})`;
```

3. **Pass to AI as Context**:
```
Similar upcoming events (by semantic similarity):
1. "Jazz Night at Grey Eagle" at Grey Eagle on Jan 15 (78% similar)
2. "Blues & Brews" at The Bywater on Jan 18 (65% similar)
3. "Open Mic Night" at Isis Music Hall on Jan 20 (52% similar)
```

4. **AI Uses This to Assess Rarity**:
   - Many similar events → lower rarity score
   - No similar events → likely unique, higher rarity score
   - Similar events but different magnitude → can still score high

**Database Query Implementation:**
```typescript
export async function findSimilarEvents(
  eventId: string,
  options: {
    limit?: number;
    minSimilarity?: number;
    excludeIds?: string[];
    futureOnly?: boolean;
    orderBy?: 'similarity' | 'date';
  }
): Promise<SimilarEvent[]>
```

**Key Features:**
- Uses HNSW index on embedding column for fast similarity search
- Filters: exclude source event, minimum similarity threshold, future-only option
- Returns similarity score (0.0 to 1.0) with each result
- Can order by similarity or date

### Processing Flow

1. Finds events WITH embedding+summary but WITHOUT score (next 3 months, max 50)
2. **Recurring Check First:**
   - If `recurringType === 'daily'` → auto-score 5/30 (R:1, U:2, M:2)
   - Checks for weekly recurring via database query (see section 8)
   - If weekly recurring detected → auto-score 5/30 (R:1, U:2, M:2)
3. **Similarity Search** (if not recurring):
   - Queries pgvector for up to 20 similar events (≥40% similarity)
   - Formats results with similarity percentages
4. **AI Scoring:**
   - Sends event data + similar events context to Azure OpenAI
   - AI returns breakdown: rarity, unique, magnitude (0-10 each)
   - Validates and clamps scores to 0-10 range
5. Updates database with score breakdown and reason
6. Processes sequentially with 500ms delays

### Cost Optimization via Recurring Detection

**Auto-Scoring Rules:**
```typescript
export function getRecurringEventScore(type: 'daily' | 'weekly'): EventScoreResult {
  return {
    score: 5,
    rarity: 1,  // Very low - happens frequently
    unique: 2,  // Low - common activity type
    magnitude: 2, // Low - typically local/community level
    reason: type === 'daily'
      ? 'Daily recurring event - happens every day.'
      : 'Weekly recurring event - happens every week.'
  };
}
```

This skips ~50% of events from AI scoring, saving significant API costs

---

## 4. AI Deduplication

**File:** `lib/ai/aiDeduplication.ts`
**Model:** Azure OpenAI (default: `gpt-5-mini`)
**Trigger:** `/api/cron/dedup` cron job (daily at 5 AM ET)

### System Prompt

```
You identify duplicate event listings. Analyze events on the same day and return the numeric IDs of duplicates to REMOVE.

DUPLICATES are the same real-world event listed multiple times:
- Same event at same venue with different titles
- Same performer at same venue from different sources
- Titles that are variations of each other at same time/venue

NOT DUPLICATES:
- Different events at same venue (different times, 2+ hours apart)
- Similar events at different venues

When duplicates exist, REMOVE the one with:
- "Unknown" price (keep the one with known price)
- Less complete title/description
- Aggregator source (keep venue/primary source)

Be conservative - only flag clear duplicates.

Respond with ONLY valid JSON (no markdown):
{"duplicates":[{"remove":[1,2],"reason":"brief reason"}]}

If no duplicates: {"duplicates":[]}
```

### User Prompt Template

```
Here are {N} events on {YYYY-MM-DD}. Identify any duplicates:

{
  "id": 1,
  "title": "...",
  "description": "...",
  "organizer": "...",
  "location": "...",
  "time": "HH:MM AM/PM",
  "price": "$XX or Free or Ticketed",
  "source": "SOURCE_NAME"
}
{
  "id": 2,
  ...
}
```

### Output Format

```json
{
  "duplicates": [
    {
      "remove": [2, 3],
      "reason": "Same concert at Orange Peel, duplicate listings from different sources"
    }
  ]
}
```

### Key Implementation Details

**Spam Filtering Before AI:**
```typescript
function filterSpamEvents(events: EventForAIDedup[]): EventForAIDedup[] {
  return events.filter((event) => {
    // Check title, description, organizer against default filter keywords
    if (matchesDefaultFilter(event.title)) return false;
    if (event.description && matchesDefaultFilter(event.description)) return false;
    if (event.organizer && matchesDefaultFilter(event.organizer)) return false;
    return true;
  });
}
```

**Date Grouping:**
```typescript
function groupEventsByDate(events: EventForAIDedup[]): Map<string, EventForAIDedup[]> {
  // Uses Eastern time date to match local event dates
  const dateKey = event.startDate.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // YYYY-MM-DD format
  // ...
}
```

**Index Mapping Strategy:**
```typescript
// Create 1-indexed mapping for human readability
const indexToId = new Map<number, string>();
filteredEvents.forEach((event, i) => {
  indexToId.set(i + 1, event.id);  // 1-indexed
});

// AI receives numeric indices (1, 2, 3...)
// Response is mapped back to UUIDs before deletion
```

**Error Handling:**
```typescript
interface DayResult {
  date: string;
  eventCount: number;
  duplicatesFound: number;
  groups: AIDuplicateGroup[];
  tokensUsed: number;
  error?: string;
}
```

**Debug Mode:**
```typescript
// Set AI_DEDUP_DEBUG_DIR env var to save inputs/outputs
const debugDir = process.env.AI_DEDUP_DEBUG_DIR;
if (debugDir) {
  await fs.writeFile(`${debugDir}/input-${date}.txt`, ...);
  await fs.writeFile(`${debugDir}/output-${date}.txt`, ...);
}
```

### Processing Flow

1. Fetches all events from database
2. Groups events by date (Eastern Time using `toLocaleDateString`)
3. Skips days with <2 events (can't have duplicates)
4. **Filters out spam events** (matches default filter keywords)
5. Creates index-to-UUID mapping (1-indexed)
6. Formats events for prompt with numeric indices
7. Sends day's events to AI with `maxTokens: 4000`
8. **Response Parsing:**
   - Strips markdown code blocks if present
   - Validates JSON structure
   - Maps numeric indices back to UUIDs
   - Validates all IDs exist in original event set
9. Deletes identified duplicates in batch
10. Processes up to 11 days (configurable via `maxDays`)
11. 300ms delay between API calls to avoid rate limiting

### Batch Deletion

```typescript
if (result.idsToRemove.length > 0) {
  await db.delete(events).where(inArray(events.id, result.idsToRemove));
  console.log(`Removed ${result.idsToRemove.length} duplicate events.`);
}
```

### Stats Tracking

```typescript
interface AIDeduplicationResult {
  success: boolean;
  daysProcessed: number;
  totalDuplicatesFound: number;
  idsToRemove: string[];
  totalTokensUsed: number;
  dayResults: DayResult[];
  errors: string[];
}
```

---

## 5. Data Enrichment

**File:** `lib/ai/dataEnrichment.ts`
**Model:** Azure OpenAI (default: `gpt-5-mini`)
**Trigger:** Manual script/integration (not automated)

### System Prompt

```
You are a data extraction assistant. Extract event pricing and timing information from event descriptions and web page content.

IMPORTANT RULES:
1. Extract information that is EXPLICITLY stated OR strongly implied in the content
2. Common price phrases to recognize:
   - "$20 at the door", "20 bucks", "$15-25" → extract the price
   - "free event", "no cover", "free admission", "open to all" → "Free"
   - "buy tickets", "tickets available", "ticketed event" without price → "Ticketed"
   - Community events, meetups, public gatherings without price mentioned → likely "Free"
3. PRICE FORMAT - Always normalize to one of these formats:
   - "$25" - exact price
   - "$25+" - minimum price (for "starting at $25", "$25 and up", etc.)
   - "$15 - $30" - price range
   - "Free" - free events
   - "Ticketed" - requires tickets but price unknown
   - Do NOT include explanations like "$15 per person" - just "$15"
   - For complex prices like "$15 per child + adult" → "$15+"
4. For time, extract if a specific start time is mentioned (e.g., "7pm", "19:00", "doors at 6, show at 7", "starting at 8")
5. Return time in 24-hour format (e.g., "19:00" not "7:00 PM")
6. If you see a "doors" time and "show" time, return the show time
7. Use your judgment - if it's clearly a free community event or paid concert, indicate that

Return ONLY a JSON object with this structure (no markdown, no explanation):
{"price": "$25" | "$25+" | "$15 - $30" | "Free" | "Ticketed" | null, "time": "19:00" | null, "confidence": "high" | "medium" | "low"}
```

### User Prompt Template

```
Event: "{event.title}"
Organizer: {event.organizer or "Unknown"}
URL: {event.url}
NEED TO EXTRACT: Price (currently unknown)
NEED TO EXTRACT: Event start time (currently unknown)

Page content:
---
{Fetched page markdown (12000 chars max) OR event description fallback}
---

Extract the requested information. If the event appears to be a free community event/meetup with no price mentioned, return "Free". If it's clearly a ticketed show (concert, comedy, theater) but no price is shown, return "Ticketed".
```

### Output Format

```json
{
  "price": "$25",
  "time": "19:00",
  "confidence": "high"
}
```

---

## 6. AI Chat

**File:** `app/api/chat/route.ts`
**Models:** Azure OpenAI (primary) + OpenRouter fallback (`google/gemini-2.0-flash-lite-001`)
**Trigger:** User POST to `/api/chat`

### Overview

The chat API uses a **2-step AI pipeline**:

1. **Date Extraction** - Extract date range from user query (if needed)
2. **Main Response** - Stream curated event recommendations with context

**Rate Limiting:**
```typescript
const RATE_LIMIT_MS = 2000; // 2 seconds between requests per IP
const rateLimitKey = `chat:${ip}`;
if (isRateLimited(rateLimitKey, 1, RATE_LIMIT_MS)) {
  return new Response({ error: "Please wait..." }, { status: 429 });
}
```

**Provider Fallback:**
```typescript
// Try Azure first, fall back to OpenRouter if unavailable
if (isAzureAIEnabled()) {
  const result = await extractDateRangeWithAzure(userMessage);
  if (result) return result;
}

if (openRouterApiKey) {
  const result = await extractDateRangeWithOpenRouter(userMessage, apiKey);
  if (result) return result;
}

// Ultimate fallback: 14 days from today
return { dateRange: getDefaultDateRange(), displayMessage: "..." };
```

### Step 1: Date Range Extraction Prompt

```
You are a date range extractor for an event search system.

Current date/time: {Today's date} at {current time} (Eastern Time)

Given the user's query, determine the relevant date range for finding events.

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "reasoning": "brief explanation"}

Rules:
- "tonight" or "today" = today's date only
- "tomorrow" = the next day only
- "this weekend" = upcoming Friday through Sunday
- "this week" = today through Sunday
- "next week" = Monday through Sunday of next week
- "next month" = all of the following calendar month
- If no time reference is given, use 14 days from today as the default range
- For specific dates mentioned (e.g., "December 31"), use that specific date
- For day names (e.g., "Friday"), find the next occurrence of that day

User query: "{latest user message}"
```

### Step 2: Main Chat System Prompt

```
You are a knowledgeable local guide helping users discover events in Asheville, NC. Today is {date} and the current time is {time} (Eastern Time).

## Your Role
You intelligently curate and recommend events based on what the user is actually looking for. You do NOT just dump lists of events - you select and explain based on the user's intent.

## User's Active Filters:
- Date range: {start} to {end}
- Search: "{search term}"
- Price: {filter}
- Tags (included): {tags}
- Tags (excluded): {tags}
- Locations: {locations}

## Available Events ({eventCount} events in this date range):

{Formatted event list - see format below}

## Response Behavior - FOLLOW THESE CAREFULLY

### When user asks for "interesting", "best", "unique", "cool", "recommendations", "what should I do", or similar:
- Select only 5-8 standout events that are genuinely notable
- For EACH event, add a brief italicized explanation of why it's worth attending
- Prioritize: concerts/shows at known venues, special one-time events, festivals, holiday specials, unique local experiences
- AVOID including: recurring weekly meetings, generic classes, career fairs, committee meetings, story times, meditation groups (unless user asks)

### When user asks for specific event types (e.g., "jazz", "comedy", "free", "outdoor", "family-friendly"):
- Filter to ONLY events matching that criteria
- Show up to 10-15 relevant matches
- If many matches exist, show the highlights and mention there are more available

### When user explicitly asks to "show all", "list everything", or "give me the full list":
- ONLY then provide a comprehensive list grouped by day
- No explanations needed per event in this case

### When user asks about a specific event or wants more details:
- Provide full details for that event including description if available
- Suggest 2-3 similar events they might also enjoy

## What Makes an Event Worth Recommending
- Notable Asheville venues: Orange Peel, Grey Eagle, Harrah's Cherokee Center, NC Arboretum, Asheville Community Theatre
- Named performers/artists (specific band names, comedian names, etc.)
- Special one-time or seasonal events (not recurring weekly)
- Holiday-themed events during holiday season
- Large community events, festivals, markets (like The Big Crafty)
- Unique local experiences

## What to Deprioritize (unless specifically relevant to the query)
- Generic recurring events (weekly book clubs, meditation groups, support groups)
- Career fairs, committee meetings, certification training
- Events with vague titles AND unknown prices
- Online/virtual events
- Very early morning events (before 7 AM)

## Response Format
- Use **bold headings** for date groupings
- Make event titles clickable: [**Event Title**](url)
- Format: Title link, then date/time, location, price on separate lines
- For curated picks: Add brief *italicized reason* why you recommend it
- End curated responses with: "Want more options? I can show you [relevant alternatives based on their query]."

## Example of a Good Curated Response

**Friday, December 5**

1. [**OK Go**](https://avlgo.com/events/ok-go-2025-12-05-a1b2c3)
   Fri, Dec 5 at 8:00 PM
   The Orange Peel
   Price: $35
   *The iconic alt-rock band known for their creative music videos - rare Asheville stop*

2. [**Southern Culture on the Skids**](https://avlgo.com/events/southern-culture-on-the-skids-2025-12-05-d4e5f6)
   Fri, Dec 5 at 8:00 PM
   The Grey Eagle
   Price: $27
   *Legendary Southern rock - always a high-energy show*

---

**Saturday, December 6**

3. [**The Big Crafty**](https://avlgo.com/events/the-big-crafty-2025-12-06-g7h8i9)
   Sat, Dec 6 at 10:00 AM
   Harrah's Cherokee Center
   Price: Free
   *Asheville's premier holiday craft market with 175+ local artisans*

---

Want more options? I can show you all live music this weekend, all free events, or the full list of {eventCount} events.
```

### Event Format for AI

Each event is formatted as:

```
{Event Title}
URL: {internal AVL GO URL}
When: {Short date + time}
Where: {location}
Price: {price or "?"}
Host: {organizer}
Tags: {comma-separated tags}
Description: {truncated description}

---
```

### Date Re-Extraction Logic

**When to re-extract dates:**
```typescript
const DATE_CHANGE_PATTERNS = [
  /\btonight\b/i, /\btomorrow\b/i, /\btoday\b/i, /\bweekend\b/i,
  /\bthis week\b/i, /\bnext week\b/i, /\bnext month\b/i,
  /\bfriday\b/i, /\bsaturday\b/i, /\bsunday\b/i,
  // ... more patterns
];

function shouldReExtractDates(
  userMessage: string,
  hasExistingDateRange: boolean
): boolean {
  // Always extract on first message
  if (!hasExistingDateRange) return true;

  // Check if user mentions date-related phrases
  return DATE_CHANGE_PATTERNS.some(pattern => pattern.test(userMessage));
}
```

This avoids redundant AI calls when user continues asking about the same date range.

### Event Formatting for AI

```typescript
function formatEventsForAI(events: EventData[]): string {
  return events.map((event) => {
    const eventDate = new Date(event.startDate);
    const date = eventDate.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
      timeZone: "America/New_York",
    });

    // Generate internal AVL GO event page URL
    const internalUrl = generateEventUrl(event.title, eventDate, event.id);

    return [
      event.title,
      `URL: ${internalUrl}`,
      `When: ${date}`,
      event.location ? `Where: ${event.location}` : null,
      event.price ? `Price: ${event.price}` : `Price: ?`,
      event.organizer ? `Host: ${event.organizer}` : null,
      event.tags?.length ? `Tags: ${event.tags.join(", ")}` : null,
      event.description || null,
    ].filter(Boolean).join("\n");
  }).join("\n---\n");
}
```

### Streaming Architecture

**Server-Sent Events (SSE) Format:**
```typescript
const encoder = new TextEncoder();
const stream = new TransformStream<Uint8Array, Uint8Array>();
const writer = stream.writable.getWriter();

// Send date range info first
await writer.write(
  encoder.encode(`data: ${JSON.stringify({
    type: "dateRange",
    data: { startDate, endDate, displayMessage, eventCount }
  })}\n\n`)
);

// Stream AI response chunks
for await (const token of azureStream) {
  const chunk = { choices: [{ delta: { content: token } }] };
  await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

await writer.write(encoder.encode(`data: [DONE]\n\n`));
await writer.close();
```

**Azure Streaming:**
```typescript
async function streamWithAzure(
  apiMessages: Array<{ role: string; content: string }>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder
): Promise<boolean> {
  const stream = await azureChatCompletionStream(apiMessages);
  if (!stream) return false;

  for await (const token of stream) {
    const chunk = { choices: [{ delta: { content: token } }] };
    await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }

  return true;
}
```

**OpenRouter Streaming:**
```typescript
async function streamWithOpenRouter(
  apiMessages: Array<{ role: string; content: string }>,
  apiKey: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder
): Promise<boolean> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://avlgo.com",
      "X-Title": "AVL GO Event Finder",
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash-001",
      messages: apiMessages,
      stream: true,
    }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    await writer.write(encoder.encode(chunk)); // Forward SSE directly
  }

  return true;
}
```

### Processing Flow

1. **Rate Limit Check** - 1 request per 2 seconds per IP
2. **Parse Request** - Validate messages, events, filters
3. **Date Extraction** (if needed):
   - Check if user message contains date phrases
   - If yes, extract date range via AI (Azure → OpenRouter fallback)
   - If no, reuse previous date range from conversation
4. **Filter Events** - Apply date range to all events
5. **Build System Prompt** - Include filtered events + user's active filters
6. **Stream Response**:
   - Send date range info first (JSON message)
   - Stream AI response via SSE (Azure → OpenRouter fallback)
   - Close stream when complete
7. **Error Handling** - Send error message if AI unavailable

### Message Format

**Request:**
```typescript
{
  messages: ChatMessage[];
  allEvents: EventData[];
  filters: {
    search?: string;
    priceFilter?: string;
    tagsInclude?: string[];
    tagsExclude?: string[];
    locations?: string[];
  };
  currentDateRange?: DateRange;
}
```

**Response (SSE stream):**
```
data: {"type":"dateRange","data":{"startDate":"2025-01-15","endDate":"2025-01-31","displayMessage":"Checking events from Jan 15 to Jan 31...","eventCount":42}}

data: {"choices":[{"delta":{"content":"Here"}}]}

data: {"choices":[{"delta":{"content":" are"}}]}

data: {"choices":[{"delta":{"content":" some"}}]}

data: [DONE]
```

---

## 7. Personalization

**File:** `lib/ai/personalization.ts`
**Model:** None (pure mathematical computation)
**Trigger:** Real-time when computing user feed

### No LLM Prompt - Centroid-Based Scoring

Uses pre-generated embeddings to compute similarity scores without AI:

```typescript
// Algorithm:
// 1. Compute centroid (average) of embeddings from user's favorited events → positive centroid
// 2. Compute centroid of embeddings from user's hidden events → negative centroid
// 3. Score new event:
//    - If only positive centroid: score = cosine_similarity(event, positive_centroid)
//    - If both: score = cosine_similarity(event, positive) - cosine_similarity(event, negative)

// Score tiers:
// > 0.7: "Great Match" (visual badge)
// > 0.5: "Good Match" (subtle treatment)
// ≤ 0.5: No special treatment
```

### Key Implementation Details

**Signal Types:**
```typescript
export type PositiveSignalType = 'favorite' | 'calendar' | 'share' | 'viewSource';

export interface PositiveSignal {
  eventId: string;
  signalType: PositiveSignalType;
  timestamp: string;
  active: boolean;
}

export interface NegativeSignal {
  eventId: string;
  timestamp: string;
  active: boolean;
}
```

**Centroid Computation:**
```typescript
export async function computeCentroid(eventIds: string[]): Promise<number[] | null> {
  // 1. Fetch embeddings for all events
  const eventsWithEmbeddings = await db
    .select({ id: events.id, embedding: events.embedding })
    .from(events)
    .where(inArray(events.id, eventIds));

  // 2. Filter out events without embeddings
  const validEmbeddings = eventsWithEmbeddings
    .filter(e => e.embedding !== null)
    .map(e => e.embedding as number[]);

  // 3. Compute average of all embeddings
  const dimensions = validEmbeddings[0].length;
  const centroid = new Array(dimensions).fill(0);

  for (const embedding of validEmbeddings) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= validEmbeddings.length;
  }

  return centroid;
}
```

**Scoring Function:**
```typescript
export function scoreEvent(
  eventEmbedding: number[],
  positiveCentroid: number[] | null,
  negativeCentroid: number[] | null
): number {
  if (!positiveCentroid) {
    return 0; // No positive signals = no personalization
  }

  const positiveSim = cosineSimilarity(eventEmbedding, positiveCentroid);

  if (!negativeCentroid) {
    return positiveSim;
  }

  const negativeSim = cosineSimilarity(eventEmbedding, negativeCentroid);
  return positiveSim - negativeSim;
}
```

**Tier Mapping:**
```typescript
export function getScoreTier(score: number): 'great' | 'good' | null {
  if (score > 0.7) return 'great';
  if (score > 0.5) return 'good';
  return null; // 'okay' tier gets no visual treatment
}
```

**Caching Strategy:**
```typescript
// Centroids cached in userPreferences table
const CENTROID_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Check cache freshness
const cacheIsFresh =
  userPref.centroidUpdatedAt &&
  Date.now() - userPref.centroidUpdatedAt.getTime() < CENTROID_CACHE_TTL_MS;

// Store in database as pgvector
await db.update(userPreferences).set({
  positiveCentroid: positiveCentroid
    ? sql`${JSON.stringify(positiveCentroid)}::vector`
    : null,
  negativeCentroid: negativeCentroid
    ? sql`${JSON.stringify(negativeCentroid)}::vector`
    : null,
  centroidUpdatedAt: new Date(),
});
```

**Signal Time Window:**
```typescript
const SIGNAL_TIME_WINDOW_MS = 12 * 30 * 24 * 60 * 60 * 1000; // 12 months

function filterActiveSignals<T extends { timestamp: string; active: boolean }>(
  signals: T[]
): T[] {
  const cutoffDate = new Date(Date.now() - SIGNAL_TIME_WINDOW_MS);
  return signals.filter(
    signal => signal.active && new Date(signal.timestamp) >= cutoffDate
  );
}
```

**Explainability Helper:**
```typescript
export async function findNearestLikedEvent(
  eventEmbedding: number[],
  positiveSignals: PositiveSignal[]
): Promise<{ eventId: string; title: string } | null> {
  // Compares event to all positive signal embeddings
  // Returns most similar liked event for "You might like this because..." explanations
}
```

### Processing Flow

1. Fetch user preferences (positive/negative signals from database)
2. Filter to active signals (within 12 months, active: true)
3. Check cached centroids validity (< 1 hour old)
4. If stale or missing:
   - Fetch embeddings for all signal event IDs
   - Compute average (centroid) for positive and negative separately
   - Store centroids in database as pgvector type
   - Update centroidUpdatedAt timestamp
5. For each event in feed:
   - Calculate cosine similarity to positive centroid
   - Calculate cosine similarity to negative centroid (if exists)
   - Score = positive_sim - negative_sim
6. Map score to tier (great/good/null)
7. Return tier for UI treatment

### Database Schema

```sql
-- userPreferences table
positiveCentroid vector(1536),
negativeCentroid vector(1536),
centroidUpdatedAt timestamp,
positiveSignals jsonb,  -- Array of PositiveSignal objects
negativeSignals jsonb   -- Array of NegativeSignal objects
```

---

## 8. Recurring Detection

**File:** `lib/ai/recurringDetection.ts`
**Model:** None (database query only)
**Trigger:** During scoring job in `/api/cron/ai`

### No LLM Prompt - Rule-Based Detection

Detects weekly recurring events without AI to save costs:

```typescript
// Algorithm:
// 1. Search for other events with:
//    - Same title (case-insensitive, trimmed)
//    - Same location OR same organizer (case-insensitive)
//    - Within 8 weeks in future OR 4 weeks in past
// 2. If ≥2 other matches found (3+ total occurrences):
//    - Mark as weekly recurring
//    - Use fixed score (5/30) instead of AI scoring
// 3. If no venue/organizer info:
//    - Require ≥3 other matches (more conservative)
```

### Key Implementation Details

**Database Query:**
```typescript
export async function checkWeeklyRecurring(
  title: string,
  location: string | null,
  organizer: string | null,
  eventId: string,
  startDate: Date
): Promise<WeeklyRecurringCheck> {
  // Normalize inputs
  const normalizedTitle = title.toLowerCase().trim();
  const normalizedLocation = location?.toLowerCase().trim() || null;
  const normalizedOrganizer = organizer?.toLowerCase().trim() || null;

  // Look 8 weeks forward, 4 weeks back
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 56); // 8 weeks
  const lookbackDate = new Date(startDate);
  lookbackDate.setDate(lookbackDate.getDate() - 28); // 4 weeks back

  // Build venue matching condition
  let venueCondition;
  if (normalizedLocation && normalizedOrganizer) {
    // Match either location or organizer
    venueCondition = or(
      sql`LOWER(TRIM(${events.location})) = ${normalizedLocation}`,
      sql`LOWER(TRIM(${events.organizer})) = ${normalizedOrganizer}`
    );
  } else if (normalizedLocation) {
    venueCondition = sql`LOWER(TRIM(${events.location})) = ${normalizedLocation}`;
  } else if (normalizedOrganizer) {
    venueCondition = sql`LOWER(TRIM(${events.organizer})) = ${normalizedOrganizer}`;
  } else {
    // No venue/organizer info - match any (less reliable)
    venueCondition = sql`TRUE`;
  }

  const matches = await db
    .select({ id: events.id, startDate: events.startDate })
    .from(events)
    .where(
      and(
        ne(events.id, eventId),
        sql`LOWER(TRIM(${events.title})) = ${normalizedTitle}`,
        venueCondition,
        gte(events.startDate, lookbackDate),
        lte(events.startDate, endDate)
      )
    );

  // If no venue/organizer info, require more matches to be confident
  const threshold = (!normalizedLocation && !normalizedOrganizer) ? 3 : 2;

  return {
    isWeeklyRecurring: matches.length >= threshold,
    matchCount: matches.length,
    matchingEventIds: matches.map(m => m.id)
  };
}
```

**Batch Processing:**
```typescript
export async function checkWeeklyRecurringBatch(
  eventsToCheck: Array<{
    id: string;
    title: string;
    location: string | null;
    organizer: string | null;
    startDate: Date;
  }>
): Promise<Map<string, WeeklyRecurringCheck>> {
  // Process in batches of 10 with parallelization
  const batchSize = 10;
  for (let i = 0; i < eventsToCheck.length; i += batchSize) {
    const batch = eventsToCheck.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        const result = await checkWeeklyRecurring(
          event.title,
          event.location,
          event.organizer,
          event.id,
          event.startDate
        );
        return { id: event.id, result };
      })
    );
  }
}
```

**Return Interface:**
```typescript
export interface WeeklyRecurringCheck {
  isWeeklyRecurring: boolean;
  matchCount: number;
  matchingEventIds: string[];
}
```

### Fixed Recurring Score

```typescript
{
  score: 5,
  rarity: 1,      // Very low - happens frequently
  unique: 2,      // Low - common activity type
  magnitude: 2,   // Low - typically local/community level
  reason: "Weekly recurring event - happens every week."
}
```

### Usage in Scoring Pipeline

From `/api/cron/ai/route.ts`:

```typescript
for (const event of eventsNeedingScores) {
  // Check if daily recurring (existing field)
  if (event.recurringType === 'daily') {
    const recurringScore = getRecurringEventScore('daily');
    await db.update(events).set({
      score: recurringScore.score,
      scoreRarity: recurringScore.rarity,
      scoreUnique: recurringScore.unique,
      scoreMagnitude: recurringScore.magnitude,
      scoreReason: recurringScore.reason,
    }).where(eq(events.id, event.id));

    stats.scoring.skippedRecurring++;
    continue; // Skip AI scoring
  }

  // Check if weekly recurring
  const recurringCheck = await checkWeeklyRecurring(
    event.title,
    event.location,
    event.organizer,
    event.id,
    event.startDate
  );

  if (recurringCheck.isWeeklyRecurring) {
    const recurringScore = getRecurringEventScore('weekly');
    await db.update(events).set({ /* ... */ });
    stats.scoring.skippedRecurring++;
    continue; // Skip AI scoring
  }

  // Otherwise, use AI scoring with similar events context
  // ...
}
```

This approach saves ~50% of AI scoring API calls by catching recurring events early.

---

## 9. AI Cron Job Orchestration

**File:** `app/api/cron/ai/route.ts`
**Model:** Azure OpenAI + Google Gemini
**Trigger:** Every 6 hours at :10 (10 minutes after scrape job)
**Max Duration:** 800 seconds (13+ minutes, requires Vercel Fluid Compute)

### Job Architecture

The AI cron job runs in 4 sequential passes to process newly scraped events:

```typescript
export async function GET(request: Request) {
  const jobStartTime = Date.now();

  const stats = {
    combined: { duration: 0, success: 0, failed: 0, total: 0 },
    embeddings: { duration: 0, success: 0, failed: 0, total: 0 },
    scoring: { duration: 0, success: 0, failed: 0, total: 0, skippedRecurring: 0 },
    images: { duration: 0, success: 0, failed: 0, total: 0 },
  };

  // PASS 1: Tags + Summary (combined)
  // PASS 2: Embeddings
  // PASS 3: Scoring
  // PASS 4: Images

  return NextResponse.json({ success: true, duration, stats });
}
```

### Pass 1: Combined Tags + Summary

**Query:**
```typescript
const eventsNeedingProcessing = await db
  .select(/* ... */)
  .from(events)
  .where(
    and(
      or(
        sql`${events.tags} = '{}'::text[] OR ${events.tags} IS NULL`,
        isNull(events.aiSummary)
      ),
      sql`${events.startDate} >= ${now.toISOString()}`,
      sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
    )
  )
  .limit(100); // Max 100 per run
```

**Processing:**
- Batch size: 5 events
- Delay: 1 second between batches
- Single API call generates both tags and summary
- Validates official tags against whitelist
- Updates database only if results received

### Pass 2: Embeddings

**Query:**
```typescript
const eventsNeedingEmbeddings = await db
  .select(/* ... */)
  .from(events)
  .where(
    and(
      isNotNull(events.aiSummary),  // Requires summary from Pass 1
      isNull(events.embedding),
      sql`${events.startDate} >= ${now.toISOString()}`,
      sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
    )
  )
  .limit(100);
```

**Processing:**
- Batch size: 10 events
- Delay: 500ms between batches
- Uses Google Gemini `gemini-embedding-001`
- Format: `"{title}: {aiSummary}"`
- Stores 1536-dim vector in database

### Pass 3: Scoring

**Query:**
```typescript
const eventsNeedingScores = await db
  .select(/* ... */)
  .from(events)
  .where(
    and(
      isNull(events.score),
      isNotNull(events.embedding),     // Requires embedding from Pass 2
      isNotNull(events.aiSummary),     // Requires summary from Pass 1
      sql`${events.startDate} >= ${now.toISOString()}`,
      sql`${events.startDate} <= ${threeMonthsFromNow.toISOString()}`
    )
  )
  .limit(50); // Smaller batch - more expensive
```

**Processing Logic:**
```typescript
for (const event of eventsNeedingScores) {
  // 1. Check daily recurring (existing field)
  if (event.recurringType === 'daily') {
    await autoScoreRecurring('daily');
    stats.scoring.skippedRecurring++;
    continue;
  }

  // 2. Check weekly recurring (database query)
  const recurringCheck = await checkWeeklyRecurring(/* ... */);
  if (recurringCheck.isWeeklyRecurring) {
    await autoScoreRecurring('weekly');
    stats.scoring.skippedRecurring++;
    continue;
  }

  // 3. Query similar events for context
  const similarEvents = await findSimilarEvents(event.id, {
    limit: 20,
    minSimilarity: 0.4,
    futureOnly: true,
    orderBy: 'similarity'
  });

  // 4. Generate AI score with context
  const scoreResult = await generateEventScore(event, similarEvents);

  // 5. Update database
  await db.update(events).set({
    score: scoreResult.score,
    scoreRarity: scoreResult.rarity,
    scoreUnique: scoreResult.unique,
    scoreMagnitude: scoreResult.magnitude,
    scoreReason: scoreResult.reason,
  });

  // 6. Rate limit delay
  await new Promise(r => setTimeout(r, 500));
}
```

**Cost Optimization:**
- ~50% of events auto-scored as recurring (5/30)
- Only non-recurring events use AI scoring API
- Similar events context helps AI assess rarity

### Pass 4: Images

**Query:**
```typescript
const eventsNeedingImages = await db
  .select({ id: events.id, title: events.title })
  .from(events)
  .where(
    or(
      isNull(events.imageUrl),
      eq(events.imageUrl, ""),
      like(events.imageUrl, "%/images/fallbacks/%"),
      like(events.imageUrl, "%group-cover%"),
      like(events.imageUrl, "%default_photo%")
    )
  )
  .limit(500);
```

**Processing:**
- Batch update: all events at once
- Sets default fallback image: `/asheville-default.jpg`
- No AI calls (just database update)

### Job Completion

```typescript
const totalDuration = Date.now() - jobStartTime;
console.log(`[AI] JOB COMPLETE in ${formatDuration(totalDuration)}`);
console.log(`[AI] Combined (tags+summary): ${stats.combined.success}/${stats.combined.total}`);
console.log(`[AI] Embeddings: ${stats.embeddings.success}/${stats.embeddings.total}`);
console.log(`[AI] Scoring: ${stats.scoring.success}/${stats.scoring.total} (${stats.scoring.skippedRecurring} recurring)`);
console.log(`[AI] Images: ${stats.images.success}/${stats.images.total}`);

invalidateEventsCache(); // Refresh home page cache

return NextResponse.json({ success: true, duration: totalDuration, stats });
```

**Helper Functions:**
```typescript
// Format duration for logs
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Chunk arrays for batch processing
const chunk = <T>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
```

### Error Handling

- Each pass wrapped in try/catch
- Individual event failures logged but don't stop job
- Stats track success/failed counts per pass
- Returns 500 with error details if job crashes

### Cache Invalidation

After all passes complete:
```typescript
invalidateEventsCache(); // Revalidates Next.js cache tags
// Home page will show updated events on next request
```

---

## Processing Flow

```
[Scraper Sources] ──────────────────────────────────────────────────────────────
    │
    ├── AVL Today, Eventbrite, Meetup, Facebook*, Harrah's,
    │   Orange Peel, Grey Eagle, etc.
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         /api/cron/scrape (every 6h at :00)                  │
│                                                                             │
│  Scrape all sources → Location filter (NC only) → Upsert to DB             │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼ (10 minutes later)
┌─────────────────────────────────────────────────────────────────────────────┐
│                         /api/cron/ai (every 6h at :10)                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PASS 1: Tags + Summary (Azure OpenAI)                               │   │
│  │ - Find events missing tags OR summary (max 100)                     │   │
│  │ - Single API call generates both                                    │   │
│  │ - Validate official tags against whitelist                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PASS 2: Embeddings (Google Gemini)                                  │   │
│  │ - Find events WITH summary but WITHOUT embedding (max 100)          │   │
│  │ - Format: "Title - Summary - Tags - Organizer"                      │   │
│  │ - Generate 1536-dim vector                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PASS 3: Scoring (Azure OpenAI)                                      │   │
│  │ - Find events WITH embedding+summary but WITHOUT score (max 50)     │   │
│  │ - Check if daily/weekly recurring → auto-score 5/30                 │   │
│  │ - Otherwise: fetch similar events, send to AI                       │   │
│  │ - Score on 3 dimensions: Rarity, Unique, Magnitude (0-10 each)     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PASS 4: Images                                                      │   │
│  │ - Set default fallback image for events without images              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼ (daily at 5 AM ET)
┌─────────────────────────────────────────────────────────────────────────────┐
│                         /api/cron/dedup                                     │
│                                                                             │
│  - Group events by date                                                    │
│  - Send each day's events to AI for semantic duplicate detection           │
│  - Delete identified duplicates                                            │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Real-Time User Requests                             │
│                                                                             │
│  /api/chat:                                                                │
│  - Extract date range from user query                                      │
│  - Filter events, format for AI                                            │
│  - Stream curated recommendations                                          │
│                                                                             │
│  Feed personalization:                                                     │
│  - Compute user centroids from like/dislike history                        │
│  - Score events by cosine similarity                                       │
│  - Show "Great Match" / "Good Match" badges                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cost Optimization Notes

1. **Combined Tagging + Summary:** Single API call instead of two
2. **Recurring Detection:** Database query skips AI scoring for ~50% of events
3. **Batch Processing:** Groups of 5-10 events with delays to avoid rate limits
4. **3-Month Window:** Only processes events in near future
5. **Max Limits:** 100 events for tags/embeddings, 50 for scoring per run
6. **Cached Centroids:** User personalization centroids cached for 1 hour
7. **Date Re-Extraction:** Only re-extracts dates when user mentions date phrases
8. **Similarity Search:** Uses HNSW index on pgvector for fast queries

---

## Complete AI System Summary

### AI Models Used

| Feature | Provider | Model | Cost |
|---------|----------|-------|------|
| Tags & Summary | Azure OpenAI | gpt-5-mini | Low |
| Embeddings | Google Gemini | gemini-embedding-001 | Very Low |
| Scoring | Azure OpenAI | gpt-5-mini | Low |
| Deduplication | Azure OpenAI | gpt-5-mini | Low |
| Enrichment | Azure OpenAI | gpt-5-mini | Low |
| Chat | Azure OpenAI + OpenRouter | gpt-5-mini / gemini-2.0-flash | Low |
| Personalization | None | Math only | Free |
| Recurring Detection | None | DB query only | Free |

### Processing Pipeline

```
Raw Events → Tags/Summary → Embeddings → Scoring → User Feed
                                ↓
                        Similarity Search
                                ↓
                    (Used for scoring context
                     and personalization)
```

### Key Technologies

- **Vector Database:** pgvector with HNSW indexing
- **ORM:** Drizzle ORM for type-safe queries
- **Streaming:** Server-Sent Events (SSE) for chat
- **Caching:** Database-backed centroid caching (1 hour TTL)
- **Rate Limiting:** In-memory IP-based throttling
- **Error Handling:** Provider fallbacks (Azure → OpenRouter)

### Database Schema Additions for AI

```sql
-- events table
tags text[],
aiSummary text,
embedding vector(1536),  -- HNSW index for fast similarity
score integer,
scoreRarity integer,
scoreUnique integer,
scoreMagnitude integer,
scoreReason text,

-- userPreferences table
positiveCentroid vector(1536),
negativeCentroid vector(1536),
centroidUpdatedAt timestamp,
positiveSignals jsonb,
negativeSignals jsonb,
```

### API Endpoints

**Automated (Cron):**
- `/api/cron/ai` - Tags, embeddings, scoring (every 6h)
- `/api/cron/dedup` - Semantic deduplication (daily)

**User-Triggered:**
- `/api/chat` - Conversational event discovery
- `/api/events/submit` - Event submission with enrichment

**Real-Time:**
- Personalization scoring (computed per request)
- Similarity search (via database queries)

### Cost Breakdown (Estimated per 1000 Events)

| Operation | AI Calls | Est. Cost |
|-----------|----------|-----------|
| Tags + Summary | 1000 | $0.10 |
| Embeddings | 1000 | $0.02 |
| Scoring | ~500 (50% auto-scored) | $0.05 |
| Deduplication | ~50 days × 1 call | $0.01 |
| **Total** | | **~$0.18** |

*Note: Actual costs vary based on token usage and provider pricing*

### Performance Optimizations

1. **Parallel Batch Processing:** Events processed in batches with Promise.all
2. **Incremental Updates:** Only process events missing AI fields
3. **3-Month Window:** Limits scope to relevant future events
4. **Recurring Detection First:** Skips expensive AI calls for ~50% of events
5. **Cached Centroids:** Avoids recomputing user profiles on every request
6. **HNSW Index:** Fast approximate nearest neighbor search
7. **Streaming Responses:** Chat responses start immediately
8. **Provider Fallbacks:** Ensures high availability

This system processes 100-200 events per 6-hour cycle with minimal latency impact on users.
