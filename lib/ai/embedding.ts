/**
 * Event embedding generation using Google Gemini.
 *
 * Uses gemini-embedding-001 to generate 1536-dimensional embeddings
 * for semantic search and similarity matching.
 */

import { GoogleGenerativeAIAbortError, TaskType } from '@google/generative-ai';
import { getEmbeddingModel, isAIEnabled } from './provider-clients';
import { withRetry } from '../utils/retry';

// Embedding configuration
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Deadline for a single embed call. The AI cron fires these ten at a time via
 * Promise.all, so one hung request used to block its whole batch until the
 * function was killed.
 */
export const EMBEDDING_TIMEOUT_MS = 30_000;

export interface EmbeddingOptions {
  taskType?: TaskType;
}

/**
 * A timed-out request is aborted client-side only - the call may still be
 * running (and billable) at Google, so retrying it would stack concurrent
 * paid calls. Retry settled failures only.
 */
function isAbortFailure(error: unknown): boolean {
  return (
    error instanceof GoogleGenerativeAIAbortError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

/**
 * Generate an embedding for a single text string.
 * Uses RETRIEVAL_DOCUMENT task type by default for stored documents.
 * Returns 1536-dimensional embeddings.
 */
export async function generateEmbedding(
  text: string,
  options?: EmbeddingOptions
): Promise<number[] | null> {
  if (!isAIEnabled()) {
    console.warn('[AI:Embed] Gemini AI not enabled (GEMINI_API_KEY missing), returning null');
    return null;
  }

  const model = getEmbeddingModel();
  if (!model) {
    console.warn(
      '[AI:Embed] Embedding model not available (getEmbeddingModel returned null), returning null'
    );
    return null;
  }

  try {
    const result = await withRetry(
      () =>
        // Using type assertion because SDK types don't include outputDimensionality yet
        // but the API supports it (tested and working)
        model.embedContent(
          {
            content: { role: 'user', parts: [{ text }] },
            taskType: options?.taskType ?? TaskType.RETRIEVAL_DOCUMENT,
            outputDimensionality: EMBEDDING_DIMENSIONS,
          } as Parameters<typeof model.embedContent>[0],
          { timeout: EMBEDDING_TIMEOUT_MS }
        ),
      {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 8000,
        shouldRetry: (error) => !isAbortFailure(error),
      }
    );

    const embedding = result.embedding.values;
    return embedding;
  } catch (error) {
    console.error(
      `[AI:Embed] API error for text "${text.slice(0, 50)}...":`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Create the embedding text from event title, summary, tags, and organizer.
 * Format: "Title - Summary - tag1, tag2 - Organizer"
 */
export function createEmbeddingText(
  title: string,
  aiSummary: string,
  tags?: string[] | null,
  organizer?: string | null
): string {
  const parts: string[] = [];
  const cleanTitle = title.trim();
  if (cleanTitle) parts.push(cleanTitle);

  const cleanSummary = aiSummary?.trim();
  if (cleanSummary) parts.push(cleanSummary);

  const cleanTags = (tags || []).map((tag) => tag.trim()).filter(Boolean);
  if (cleanTags.length > 0) parts.push(cleanTags.join(', '));

  const cleanOrganizer = organizer?.trim();
  if (cleanOrganizer) parts.push(cleanOrganizer);

  return parts.join(' - ');
}

/**
 * Calculate cosine similarity between two embeddings.
 * Returns a value between -1 and 1, where 1 means identical.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions must match: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
