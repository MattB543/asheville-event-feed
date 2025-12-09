# AI-Powered Deduplication Plan

## Overview

Add a final AI-powered deduplication step using Azure OpenAI (gpt-5-mini) to catch duplicates that rule-based methods miss. This is especially useful for:
- Events with completely different titles but same content
- Events where organizer/venue naming varies significantly
- Subtle duplicates that require semantic understanding

## Architecture

```
[Rule-Based Deduplication]
         │
         ▼
   [AI Deduplication]  ←── Groups events by DATE
         │                  Sends each day's events to GPT-5-mini
         ▼                  Gets back IDs to remove
   [Final Clean DB]
```

## Key Design Decisions

### 1. Process by Date
Events on different days cannot be duplicates, so we:
- Group all events by date (ignoring time)
- Only process days with 2+ events
- Keep token usage manageable

### 2. Minimal Context Per Event
Send only what's needed for duplicate detection:
```json
{
  "id": "uuid",
  "title": "Event Name",
  "organizer": "Organizer",
  "location": "Venue",
  "time": "7:00 PM",
  "price": "$20"
}
```
Skip description initially (can add truncated version if needed).

### 3. Structured Output
Ask GPT to return JSON array of duplicate groups:
```json
{
  "duplicates": [
    {
      "keep": "uuid-to-keep",
      "remove": ["uuid-1", "uuid-2"],
      "reason": "Same concert at Orange Peel"
    }
  ]
}
```

### 4. Conservative Approach
- Only remove if AI is confident (high threshold)
- Log all AI decisions for review
- Make it optional (only runs if Azure credentials present)
- Can run as standalone script OR in cron

## Environment Variables

Map existing variables:
```env
# User's existing
AZURE_KEY_1=xxx
AZURE_ENDPOINT=https://xxx.openai.azure.com

# We'll also support standard names
AZURE_OPENAI_API_KEY=xxx  (fallback to AZURE_KEY_1)
AZURE_OPENAI_ENDPOINT=xxx (fallback to AZURE_ENDPOINT)
AZURE_OPENAI_DEPLOYMENT=gpt-5-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
```

## Files to Create/Modify

### New Files
1. **`lib/ai/azure-client.ts`** - Azure OpenAI client (lazy init, singleton)
2. **`lib/ai/aiDeduplication.ts`** - AI deduplication logic
3. **`scripts/ai-deduplicate.ts`** - Standalone script for manual runs

### Modified Files
4. **`lib/config/env.ts`** - Add Azure env vars
5. **`app/api/cron/route.ts`** - (Optional) Add as final step

## Implementation Details

### Azure Client (`lib/ai/azure-client.ts`)
```typescript
import { AzureOpenAI } from "openai";

let client: AzureOpenAI | null = null;

export function getAzureClient(): AzureOpenAI | null {
  if (client) return client;

  const apiKey = process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_KEY_1;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_ENDPOINT;

  if (!apiKey || !endpoint) return null;

  client = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview",
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini",
  });

  return client;
}

export function isAzureAIEnabled(): boolean {
  const apiKey = process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_KEY_1;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_ENDPOINT;
  return !!(apiKey && endpoint);
}
```

### AI Deduplication Prompt
```
You are analyzing events to find duplicates. Events are duplicates if they are the same real-world event listed multiple times.

Consider events duplicates if:
- Same event at same venue on same day, even with different titles
- Same performer/organizer at same venue, even if titles vary
- Same event listed by venue vs promoter vs ticketing site

Do NOT consider duplicates if:
- Different events at same venue on same day (e.g., matinee vs evening show)
- Recurring events on different days
- Similar but distinct events (e.g., "Jazz Night" every week)

For each duplicate group, keep the event with:
1. Known price (not "Unknown")
2. More complete information
3. More recognizable organizer

Return JSON only, no explanation:
{
  "duplicates": [
    {
      "keep": "id-to-keep",
      "remove": ["id-to-remove-1", "id-to-remove-2"],
      "reason": "brief reason"
    }
  ]
}

If no duplicates found, return: {"duplicates": []}
```

### Cost Estimation
- ~100 tokens per event (id, title, organizer, location, time, price)
- Average day might have 20-50 events = 2,000-5,000 tokens input
- 30 days to check = 60,000-150,000 input tokens
- GPT-4-mini pricing: ~$0.15-0.40 per full run
- Very affordable for daily/weekly runs

## Execution Flow

```
1. Fetch all events from DB
2. Group by date (UTC date only)
3. For each date with 2+ events:
   a. Format events as minimal JSON
   b. Send to GPT-5-mini with dedup prompt
   c. Parse response, validate IDs exist
   d. Collect IDs to remove
4. Delete all collected IDs (with logging)
5. Report summary
```

## Safety Measures

1. **Dry-run mode** - Default to showing what would be removed
2. **Confidence threshold** - Only act on clear duplicates
3. **Logging** - Record all AI decisions with reasons
4. **Batch limits** - Max events per API call to avoid token limits
5. **Error handling** - Don't fail entire job if one day fails

## Testing Strategy

1. Run as dry-run first, review all proposed deletions
2. Check that rule-based dedup still runs first
3. Verify AI catches cases rule-based misses
4. Monitor token usage and costs
