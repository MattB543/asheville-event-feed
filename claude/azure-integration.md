# Azure Integration Report - Asheville Event Feed

## Overview

The application uses **Azure OpenAI** as its primary AI provider for text generation tasks including tagging, summaries, deduplication, scoring, verification, and chat.

---

## 1. Azure Services Used

**Primary Service:** Azure OpenAI API
- **Default Model:** `gpt-5-mini` (configurable via `AZURE_OPENAI_DEPLOYMENT`)
- **API Version:** `2024-12-01-preview` (configurable)
- **Capabilities:** Chat completions (streaming and non-streaming), text analysis, JSON output generation

---

## 2. Files Referencing Azure

| File Path | Purpose |
|-----------|---------|
| `lib/ai/provider-clients.ts` | Core Azure OpenAI client initialization and wrapper functions |
| `lib/ai/tagAndSummarize.ts` | Combined tags + summary generation |
| `lib/ai/aiDeduplication.ts` | Semantic duplicate detection |
| `lib/ai/eventVerification.ts` | Event status verification (Azure + Jina API) |
| `lib/ai/scoring.ts` | Event quality scoring |
| `app/api/chat/route.ts` | AI chat API (Azure primary, OpenRouter fallback) |
| `app/api/cron/ai/route.ts` | Main AI processing cron job |
| `app/api/cron/dedup/route.ts` | Daily AI deduplication cron |
| `app/api/cron/verify/route.ts` | Event verification cron |
| `scripts/ai/run-ai-processing.ts` | Standalone batch AI processing script |
| `scripts/ai/tag-events.ts` | Script for tagging untagged events |
| `scripts/verify-event.ts` | Script for on-demand event verification |

---

## 3. Client Configuration

**File:** `lib/ai/provider-clients.ts`

### Initialization Pattern
```typescript
let azureClient: AzureOpenAI | null = null;

export function getAzureClient(): AzureOpenAI | null {
  const apiKey = getAzureApiKey();
  const endpoint = getAzureEndpoint();

  if (!apiKey || !endpoint) return null;

  azureClient = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: getAzureApiVersion(),
    deployment: getAzureDeployment(),
  });

  return azureClient;
}
```

### Availability Check
```typescript
export function isAzureAIEnabled(): boolean {
  const apiKey = getAzureApiKey();
  const endpoint = getAzureEndpoint();
  return !!(apiKey && endpoint);
}
```

---

## 4. Core Azure Functions

### `azureChatCompletion()`
- **Purpose:** Non-streaming chat completion
- **Returns:** Content, input tokens, output tokens, total tokens
- **Usage:** Tagging, summaries, deduplication, scoring, verification

### `azureChatCompletionStream()`
- **Purpose:** Streaming chat completion for real-time responses
- **Returns:** Async iterable of content chunks
- **Usage:** AI chat API

### `azureChatCompletionMessages()`
- **Purpose:** Non-streaming with multiple messages (conversation history)
- **Returns:** Content string or null
- **Usage:** Date extraction, multi-turn conversations

---

## 5. Functionality Relying on Azure

### A. Event Tagging & Summaries (`lib/ai/tagAndSummarize.ts`)
- Generates official tags (from 33-item allowed list) + custom tags (1-5)
- Creates 1-2 sentence AI summary optimized for semantic search
- Batch processing with 500ms delay between requests

### B. AI Deduplication (`lib/ai/aiDeduplication.ts`)
- Groups events by date, identifies semantic duplicates
- Daily cron at 5 AM ET via `/api/cron/dedup`
- Processes today + next 10 days

### C. Event Scoring (`lib/ai/scoring.ts`)
- **Primary Dimensions (0-10 each, total 0-30):**
  - Rarity & Urgency
  - Cool & Unique Factor
  - Magnitude & Caliber
- **Secondary Dimensions (1-10 each):**
  - Asheville Weird
  - Social Factor
- Max 50 events per cron run

### D. Event Verification (`lib/ai/eventVerification.ts`)
- Fetches event page via Jina Reader API
- Determines: Keep, Hide (cancelled), or Update
- Max 30 events per cron run (every 3 hours)

### E. AI Chat (`app/api/chat/route.ts`)
- Date extraction from user messages
- Event recommendations with streaming
- 2-second rate limit per IP
- OpenRouter fallback if Azure fails

---

## 6. Environment Variables

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | Yes* | None |
| `AZURE_KEY_1` | Alternative key name | No | None |
| `AZURE_OPENAI_ENDPOINT` | Azure endpoint URL | Yes* | None |
| `AZURE_ENDPOINT` | Alternative endpoint name | No | None |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name | No | `gpt-5-mini` |
| `AZURE_OPENAI_API_VERSION` | API version | No | `2024-12-01-preview` |

*Required for AI features to work

---

## 7. Fallback Mechanisms

### Chat API
```typescript
// Try Azure first, fall back to OpenRouter
if (isAzureAIEnabled()) {
  streamSuccess = await streamWithAzure(...);
}

if (!streamSuccess && openRouterApiKey) {
  streamSuccess = await streamWithOpenRouter(...);
}
```

### Cron Jobs
- **AI Processing:** Returns 400 error if Azure not enabled
- **Deduplication:** Skips gracefully with `skipped: true`
- **Verification:** Skips if Jina or Azure not configured

### Date Extraction
1. Try Azure first
2. Fall back to OpenRouter
3. Final fallback: default 14-day range

---

## 8. Rate Limiting & Error Handling

### Rate Limiting Strategy

| Component | Delay | Max per Cron |
|-----------|-------|--------------|
| Tags/Summary | 1000ms between batches | 100 events |
| Scoring | 500ms between events | 50 events |
| Deduplication | 300ms between days | 11 days |
| Verification | 100ms + 120ms (Jina) | 30 events |
| Chat | 2 seconds per IP | N/A |

### Error Handling Patterns

**Graceful Degradation:**
```typescript
if (!response) {
  return { tags: [], summary: null };
}
```

**Content Filter Handling:**
```typescript
if (errMsg.includes('content_filter')) {
  updateData.aiSummary = '[Content filtered by AI safety policy]';
}
```

**Token Usage Tracking:**
```typescript
console.log(`[TagAndSummarize] Generated... (${result.usage.totalTokens} tokens)`);
```

---

## 9. Integration Flow

```
[Event Sources]
       ↓
[Scrape/Upsert]
       ↓
[Verification via Azure + Jina] (optional)
       ↓
[Azure Tagging + Summaries]
       ↓
[Gemini Embeddings] (not Azure)
       ↓
[Azure Scoring] (optional)
       ↓
[Azure Deduplication] (daily)
       ↓
[Chat API] → [Azure primary, OpenRouter fallback]
```

---

## 10. Key Statistics

- **13 files** directly reference Azure
- **4 main Azure functions** in `provider-clients.ts`
- **5 major AI features** rely on Azure
- **33 allowed event tags** for categorization
- **800 seconds max duration** for AI cron (requires Fluid Compute)
