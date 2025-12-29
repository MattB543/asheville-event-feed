# AI Processing Pipeline Documentation

This document describes how the Asheville Event Feed processes events through AI to generate summaries, tags, embeddings, and scores.

---

## Overview

The AI processing runs as a cron job every 6 hours (at :10 past the hour, 10 minutes after scraping). It processes events in four sequential phases:

1. **Combined Pass**: Tags + Summary generation (Azure OpenAI)
2. **Embeddings Pass**: Vector embedding generation (Google Gemini)
3. **Scoring Pass**: Event quality scoring with AI reasoning (Azure OpenAI)
4. **Images Pass**: Default fallback image assignment

**Configuration:**
- Max duration: 800 seconds (using Vercel Fluid Compute)
- Processes up to 100 events per run for tags/summaries/embeddings
- Processes up to 50 events per run for scoring
- Only processes events in the next 3 months

---

## Phase 1: Tags + Summary Generation

**File:** `lib/ai/tagAndSummarize.ts`

**Model:** Azure OpenAI (`gpt-5-mini` by default)

**Purpose:** Generate both official tags and a structured summary in a single API call.

### System Prompt

```
You are an expert event analyzer for Asheville, NC. You will analyze events and provide two things:

1. TAGS - Assign tags in two categories:
   - OFFICIAL TAGS (1-4 tags): Select ONLY from the allowed list below
   - CUSTOM TAGS (1-5 tags): Create descriptive tags for genre, vibe, skill level, venue type, etc.

2. SUMMARY - Generate a 1-2 sentence structured summary for semantic search.

## ALLOWED OFFICIAL TAGS (use ONLY these exact tags):

Entertainment:
- Live Music – concerts, bands, open mics
- Comedy – stand-up, improv, showcases
- Theater & Film – plays, performances, movie nights
- Dance – lessons, parties, social dance nights
- Trivia – pub trivia, game nights

Food & Drink:
- Dining – special dinners, brunches, prix fixe meals
- Beer – brewery events, tastings
- Wine & Spirits – wine tastings, cocktail events
- Food Classes – cooking, baking, cocktail-making workshops

Activities:
- Art – galleries, exhibits, visual art events
- Crafts – pottery, jewelry, DIY workshops
- Fitness – yoga, exercise, climbing, general fitness
- Sports – team sports, athletic events, competitions
- Wellness – sound healing, holistic health, self-care
- Spiritual – meditation, ceremonies, religious gatherings
- Outdoors – hiking, nature, parks
- Tours – walking tours, ghost tours, historical
- Gaming – board games, D&D, video games
- Education – classes, workshops, lectures, learning events
- Book Club – book discussions, reading groups, literary meetups

Audience/Social:
- Family – kid-friendly, all-ages
- Dating – singles events, speed dating
- Networking – business, professional meetups
- Nightlife – 21+, bar events, late-night
- LGBTQ+ – pride, queer-specific events
- Pets – dog-friendly, goat yoga, cat lounges
- Community – neighborhood events, local meetups
- Civic – government meetings, town halls, public forums, political events
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
- Format: "[Event type] at [venue name] featuring [key details]. [Target audience if relevant]."
- Be factual and specific
- Include venue name if provided, but do NOT include city name (e.g., "Asheville")
- Keep under 50 words
- Use present tense
- Do not include dates, times, or prices
- Do not start with "This event" or similar phrases

Return ONLY valid JSON in this format:
{"official": ["Tag1", "Tag2"], "custom": ["tag1", "tag2"], "summary": "Your summary here."}
```

### User Prompt Format

```
Analyze this event:

Title: {event.title}
Description: {first 500 chars of description}
Location: {event.location}
Organizer: {event.organizer}
Date: {ISO string}
```

### Processing Details

- Processes in batches of 5 events with 1000ms delays between batches
- Validates official tags against allowed list; filters invalid ones with warnings
- Custom tags accepted as-is (just ensures they're strings)
- Summary cleanup: removes quotes, replaces newlines with spaces
- Max tokens: 20,000 (supports reasoning models)

---

## Phase 2: Embedding Generation

**File:** `lib/ai/embedding.ts`

**Model:** Google Gemini (`gemini-embedding-001`)

**Purpose:** Generate 1536-dimensional vectors for semantic search and similarity matching.

### Input Format

The embedding is generated from concatenated text:
```
"${title}: ${aiSummary}"
```

### Configuration

```typescript
const EMBEDDING_DIMENSIONS = 1536;
const taskType = TaskType.RETRIEVAL_DOCUMENT; // For stored event documents
```

### Processing Details

- Processes in batches of 10 with 100ms delays
- Uses `outputDimensionality: 1536` for fixed-size embeddings
- Task type: RETRIEVAL_DOCUMENT (optimized for stored documents)
- Separate function exists for search queries using `TaskType.RETRIEVAL_QUERY`

---

## Phase 3: Event Scoring

**File:** `lib/ai/scoring.ts`

**Model:** Azure OpenAI (`gpt-5-mini`)

**Purpose:** Score events on three dimensions (0-10 each) to help users discover interesting events.

### Output Structure

```typescript
{
  score: number;      // Total 0-30
  rarity: number;     // 0-10 (uniqueness/frequency)
  unique: number;     // 0-10 (novelty/interest factor)
  magnitude: number;  // 0-10 (scale/talent caliber)
  reason: string;     // One sentence explanation
}
```

### System Prompt

```
You are an expert Event Curator scoring events for a local events calendar in Asheville, NC. Score each event on THREE dimensions (0-10 each) to help users discover the most interesting events.

## DIMENSION 1 - Rarity & Urgency (How often does this happen?)

IMPORTANT: Determine if this event is recurring BEFORE scoring:
- Weekly recurring: rarity 0-2 (even if it's at a nice venue)
- Monthly recurring: rarity 2-3
- Annual recurring (including holiday events): rarity 3-4
- True one-offs (tours, festivals, special collaborations): rarity 5-10

Score guide:
- 0-2: Daily/weekly recurring (trivia nights, open mics, weekly classes)
- 3-4: Monthly events OR annual recurring (monthly showcases, annual Christmas parties)
- 5-6: Limited runs (3-week theater run, seasonal exhibit)
- 7-8: One-time special events (specific tour dates, unique collaborations)
- 9-10: Major one-offs (legendary artist tour, major festival)

HOLIDAY RULE: Holiday timing (Christmas, NYE) does NOT automatically increase rarity. An annual Christmas event = rarity 3-4, not 6-8.

## DIMENSION 2 - Cool & Unique Factor (How novel/interesting is this?)

IMPORTANT: If there are 10+ similar events with >70% similarity, uniqueness should rarely exceed 5.

Score guide:
- 0-2: Standard/utility (support groups, basic classes, city meetings)
- 3-4: Common entertainment (cover bands, standard yoga, regular comedy)
- 5-6: Somewhat distinctive (themed events, niche interests)
- 7-8: Genuinely creative (unusual format, specialized skills, immersive)
- 9-10: Truly exceptional ("GWAR", mini wrestling, major art installations)

SIMILARITY RULE: A creatively-produced event that's similar to many others still has LOW uniqueness. Novel format + common type = moderate uniqueness (4-6), not high (7+).

## DIMENSION 3 - Talent & Production Magnitude (What's the scale/caliber?)

IMPORTANT: Venue prestige alone doesn't determine magnitude. A bar cover band at Orange Peel is still magnitude 3-4.

Score guide:
- 1-2: Casual, minimal production (meetups, group walks, peer-led)
- 3-4: Local professional (bar bands, small workshops, local instructors)
- 5-6: Established local production (monthly showcases, established series, local theater)
- 7-8: Regional draw or major local production (touring regional acts, symphony, professional theater)
- 9-10: National/international (Bob Dylan, arena acts, legendary status)

COVER BAND RULE: Cover bands at bars = magnitude 3-4 max, regardless of venue.

## SIMILAR EVENTS CONTEXT

Use the similar events list to calibrate your scores:
- 15+ similar events at 80%+ similarity = this is a COMMON event type, lower rarity and uniqueness
- 5-15 similar events = moderate commonality
- <5 similar events = potentially unique

## OUTPUT FORMAT

Return ONLY valid JSON:
{"rarity": N, "unique": N, "magnitude": N, "reason": "One sentence explaining the total score."}

Where N is an integer from 0-10. Be conservative - most events should score 8-18 total, not 20+.
```

### User Prompt Format

```
Score this event:

Title: {event.title}
Description: {first 300 chars}
Location: {event.location}
Organizer: {event.organizer}
Tags: {tags joined by comma}
Summary: {event.aiSummary}
Date: {formatted date}
Price: {event.price}

Similar upcoming events (by semantic similarity):
1. "{title}" at {location/organizer} on {date} ({similarity}% similar)
2. ...
[up to 20 similar events with >40% cosine similarity]
```

### Recurring Event Detection

**File:** `lib/ai/recurringDetection.ts`

Before scoring, the system checks if an event is recurring:

1. **Daily Recurring**: Events with `recurringType === 'daily'` get automatic score of 5/30
2. **Weekly Recurring Detection**: Queries database ±4 weeks around event date
   - Matches same title AND (same location OR same organizer)
   - Requires 2+ matches to confirm (3+ if no venue info)
   - If confirmed, applies fixed score: rarity=1, unique=2, magnitude=2

### Processing Details

- Processes 1 event at a time with 500ms delays
- Fetches up to 20 similar events via semantic search (cosine similarity > 0.4)
- Scores clamped to 0-10 per dimension
- Reason capped at 500 characters

---

## Phase 4: Image Assignment

**Current Implementation:** Sets default fallback image for events without images.

Uses static `/asheville-default.jpg` and batch updates events with:
- null/empty imageUrl
- URLs containing `/images/fallbacks/`, `group-cover`, or `default_photo`

### Image Generation Prompt (Not Currently Used in Cron)

```
Create a visually appealing promotional image for this event:

Title: {event.title}
Description: {first 200 chars}
Location: {event.location or 'Asheville, NC'}
Tags: {tags joined}

Style guidelines:
- Generate a 4:3 aspect ratio image
- Create a modern, eye-catching event promotional graphic
- Use vibrant colors that match the event theme
- The image should feel welcoming and professional
- Include visual elements that represent the event type (music notes for concerts, food for dining events, etc.)
- Asheville, NC mountain/artistic vibe when appropriate
- Do NOT include any text in the image - only visual elements
- Make it suitable for an event listing card/thumbnail

Generate an image only, no text response needed.
```

**Model:** Google Gemini (`gemini-2.5-flash-image`)

---

## Auxiliary: Data Enrichment

**File:** `lib/ai/dataEnrichment.ts`

**Purpose:** Extract missing price and time information from event pages (not currently in cron).

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

---

## Auxiliary: AI Deduplication

**File:** `lib/ai/aiDeduplication.ts`

**Runs:** Daily at 5 AM ET via cleanup cron (separate from AI cron)

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

---

## Models & Configuration

| Component | Model | Provider |
|-----------|-------|----------|
| Tags + Summary | `gpt-5-mini` (configurable) | Azure OpenAI |
| Embeddings | `gemini-embedding-001` | Google Gemini |
| Scoring | `gpt-5-mini` (configurable) | Azure OpenAI |
| Images | `gemini-2.5-flash-image` | Google Gemini |
| Enrichment | `gpt-5-mini` | Azure OpenAI |
| Deduplication | `gpt-5-mini` | Azure OpenAI |

### Environment Variables

```bash
# Google Gemini (for embeddings, images)
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

# Azure OpenAI (for tags, summaries, scoring, enrichment, dedup)
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=gpt-5-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
```

---

## Database Fields Updated

```typescript
// Events table
tags: text[]                    // Official + custom tags combined
aiSummary: text                 // 1-2 sentence structured summary
embedding: vector(1536)         // Gemini embedding for semantic search
score: integer                  // Total score 0-30
scoreRarity: integer            // Rarity dimension 0-10
scoreUnique: integer            // Uniqueness dimension 0-10
scoreMagnitude: integer         // Magnitude dimension 0-10
scoreReason: text               // One-sentence explanation
imageUrl: text                  // Default fallback or generated image
```

---

## Processing Flow Diagram

```
[Scraper Cron] (every 6h at :00)
    |
    v
[Upsert Events to DB]
    |
    v
[AI Cron] (every 6h at :10)
    |
    +---> Phase 1: Combined Pass (100 events max)
    |     - Query events needing tags OR summary
    |     - Call Azure OpenAI for each batch of 5
    |     - Update tags + aiSummary fields
    |
    +---> Phase 2: Embeddings Pass (100 events max)
    |     - Query events with summary but no embedding
    |     - Call Gemini for each batch of 10
    |     - Update embedding field
    |
    +---> Phase 3: Scoring Pass (50 events max)
    |     - Check for recurring (auto-score if true)
    |     - Fetch 20 similar events via semantic search
    |     - Call Azure OpenAI for each event
    |     - Update score, scoreRarity, scoreUnique, scoreMagnitude, scoreReason
    |
    +---> Phase 4: Images Pass (500 events max)
          - Find events with missing/broken images
          - Batch update to default fallback
    |
    v
[Invalidate Cache]
    |
    v
[Return Stats JSON]
```

---

## Performance

| Phase | Batch Size | Delay | Max Events | Typical Duration |
|-------|------------|-------|------------|------------------|
| Combined | 5 | 1000ms | 100 | 60-90 seconds |
| Embeddings | 10 | 500ms | 100 | 30-50 seconds |
| Scoring | 1 | 500ms | 50 | 40-60 seconds |
| Images | All | N/A | 500 | 5-10 seconds |

**Total typical run:** 2-4 minutes
