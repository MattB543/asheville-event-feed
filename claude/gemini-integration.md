# Gemini API Integration Report - Asheville Event Feed

## Overview

The application uses **Google Gemini** for two core functions: **vector embeddings** (semantic search) and **image generation**. Tagging and summaries use Azure OpenAI, not Gemini.

---

## 1. Gemini Models Used

| Model | Purpose | Dimensions |
|-------|---------|------------|
| `gemini-2.5-flash` | General-purpose (reserved, currently unused) | N/A |
| `gemini-embedding-001` | Vector embeddings for semantic search | 1536 |
| `gemini-2.5-flash-image` | Event image generation (configurable) | N/A |

---

## 2. Files Referencing Gemini

| File Path | Purpose |
|-----------|---------|
| `lib/config/env.ts` | Environment variable definitions |
| `lib/ai/provider-clients.ts` | Gemini client initialization |
| `lib/ai/embedding.ts` | Embedding generation functions |
| `lib/ai/imageGeneration.ts` | Image generation and upload |
| `app/api/cron/ai/route.ts` | Cron job using embeddings |
| `scripts/ai/backfill-embeddings.ts` | Batch backfill script |
| `package.json` | Dependency: `@google/generative-ai@^0.24.1` |

---

## 3. Client Configuration

**File:** `lib/ai/provider-clients.ts`

### Lazy Loading Pattern
```typescript
let geminiClient: GoogleGenerativeAI | null = null;
let geminiEmbeddingModel: GenerativeModel | null = null;

export function getEmbeddingModel(): GenerativeModel | null {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return null;

  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  if (!geminiEmbeddingModel) {
    geminiEmbeddingModel = geminiClient.getGenerativeModel({
      model: 'gemini-embedding-001',
    });
  }
  return geminiEmbeddingModel;
}
```

### Availability Check
```typescript
export function isAIEnabled(): boolean {
  return !!env.GEMINI_API_KEY;
}
```

---

## 4. Functionality Relying on Gemini

### A. Vector Embeddings (`lib/ai/embedding.ts`)

**Model:** `gemini-embedding-001`
**Dimensions:** 1536 (custom output dimensionality)

**Core Functions:**
- `generateEmbedding(text)` - Single embedding for stored documents
- `generateQueryEmbedding(query)` - Embedding optimized for search queries
- `generateEmbeddings(texts[])` - Batch generation with delays
- `createEmbeddingText(title, summary, tags, organizer)` - Format text for embedding

**Task Types:**
- `TaskType.RETRIEVAL_DOCUMENT` - For storing event documents
- `TaskType.RETRIEVAL_QUERY` - For search queries

**Usage Example:**
```typescript
const result = await model.embedContent({
  content: { role: 'user', parts: [{ text }] },
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  outputDimensionality: 1536,
});
```

### B. Image Generation (`lib/ai/imageGeneration.ts`)

**Model:** `gemini-2.5-flash-image` (configurable via `GEMINI_IMAGE_MODEL`)

**Functions:**
- `generateEventImage(event)` - Returns base64 data URL
- `generateAndUploadEventImage(event, eventId)` - Generates and uploads to Supabase Storage

**Image Processing:**
- Resized to 512px width
- JPEG at 80% quality
- 4:3 aspect ratio
- Size validation: Rejects images > 10MB base64

**Prompt Style:**
- Visual elements only (no text overlay)
- Asheville mountain/artistic aesthetic
- Suitable for event listing cards/thumbnails

---

## 5. Environment Variables

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | Yes* | None |
| `GEMINI_IMAGE_MODEL` | Image generation model | No | `gemini-2.5-flash-image` |

*Required for embeddings and image generation

---

## 6. Embedding Text Format

```typescript
// Format: "Title - Summary - tag1, tag2 - Organizer"
export function createEmbeddingText(
  title: string,
  aiSummary: string,
  tags?: string[] | null,
  organizer?: string | null
): string
```

**Example Output:**
```
Live Jazz at The Orange Peel - Jazz performance featuring local musicians at downtown venue. - Music, Live Performance, Nightlife - The Orange Peel
```

---

## 7. Rate Limiting

| Task | Batch Size | Delay |
|------|-----------|-------|
| Single Embedding | 1 | 100ms |
| Batch Embeddings | 10 (default) | 500ms between batches |
| Image Generation | 1 | N/A |

**Batch Processing Example:**
```typescript
for (let i = 0; i < texts.length; i++) {
  const embedding = await generateEmbedding(texts[i], { taskType });
  results.push(embedding);

  if (i < texts.length - 1 && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
```

---

## 8. Error Handling

### Graceful Degradation
```typescript
try {
  const result = await model.embedContent({ ... });
  return result.embedding.values;
} catch (error) {
  console.error('[Embedding] Error generating embedding:', error);
  return null;  // Returns null, event proceeds without embedding
}
```

### Configuration Validation
```typescript
if (!isAIEnabled()) {
  console.warn('[Embedding] AI not enabled, skipping embedding generation');
  return null;
}
```

### Image Size Validation
```typescript
if (data.length > 10_000_000) {
  console.warn(`[ImageGen] Image too large...`);
  return null;
}
```

---

## 9. Database Integration

**Table:** `events`
**Column:** `embedding` (vector(1536))
**Index:** HNSW for cosine similarity search

**Similarity Search:** `lib/db/similaritySearch.ts`
- Uses pgvector for fast similarity queries
- Powers AI chat semantic search
- Enables "similar events" features

---

## 10. Cron Job Integration

**Schedule:** Every 6 hours at :20 (via `/api/cron/ai`)
**Max Duration:** 800 seconds (Fluid Compute)

**Processing Order:**
1. Tags + Summary (Azure, not Gemini)
2. **Embeddings** (Gemini) - 10 events/batch, 500ms delay
3. Scoring (Azure)
4. Images (static fallback currently)

---

## 11. Key Differences: Gemini vs Azure

| Feature | Provider | Notes |
|---------|----------|-------|
| Tagging | Azure OpenAI | NOT Gemini |
| Summaries | Azure OpenAI | NOT Gemini |
| Embeddings | **Gemini** | Core to semantic search |
| Image Generation | **Gemini** | Optional, configurable model |
| Deduplication | Azure OpenAI | NOT Gemini |
| Scoring | Azure OpenAI | NOT Gemini |
| Chat | Azure (primary) | OpenRouter fallback |

---

## 12. SDK Information

**Package:** `@google/generative-ai@^0.24.1`

**Imports:**
```typescript
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { TaskType } from '@google/generative-ai';
```
