/**
 * Event embedding generation using Google Gemini.
 *
 * Uses gemini-embedding-001 to generate 1536-dimensional embeddings
 * for semantic search and similarity matching.
 */

import { TaskType } from "@google/generative-ai";
import { getEmbeddingModel, isAIEnabled } from "./provider-clients";

// Embedding configuration
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingOptions {
  taskType?: TaskType;
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
    console.warn('[Embedding] AI not enabled, skipping embedding generation');
    return null;
  }

  const model = getEmbeddingModel();
  if (!model) {
    console.warn('[Embedding] Embedding model not available');
    return null;
  }

  try {
    // Using type assertion because SDK types don't include outputDimensionality yet
    // but the API supports it (tested and working)
    const result = await model.embedContent({
      content: { role: "user", parts: [{ text }] },
      taskType: options?.taskType ?? TaskType.RETRIEVAL_DOCUMENT,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    } as Parameters<typeof model.embedContent>[0]);

    const embedding = result.embedding.values;
    console.log(`[Embedding] Generated ${embedding.length}-dim embedding for: ${text.slice(0, 50)}...`);
    return embedding;
  } catch (error) {
    console.error('[Embedding] Error generating embedding:', error);
    return null;
  }
}

/**
 * Generate an embedding for a search query.
 * Uses RETRIEVAL_QUERY task type for optimal search performance.
 * Returns 1536-dimensional embeddings (same as document embeddings).
 */
export async function generateQueryEmbedding(
  query: string
): Promise<number[] | null> {
  return generateEmbedding(query, { taskType: TaskType.RETRIEVAL_QUERY });
}

/**
 * Generate embeddings for multiple texts in batch.
 * Processes sequentially to avoid rate limits.
 */
export async function generateEmbeddings(
  texts: string[],
  options?: {
    taskType?: TaskType;
    delayMs?: number;
    onProgress?: (current: number, total: number) => void;
  }
): Promise<(number[] | null)[]> {
  const { taskType = TaskType.RETRIEVAL_DOCUMENT, delayMs = 100, onProgress } = options || {};
  const results: (number[] | null)[] = [];

  for (let i = 0; i < texts.length; i++) {
    const embedding = await generateEmbedding(texts[i], { taskType });
    results.push(embedding);

    onProgress?.(i + 1, texts.length);

    // Add delay between requests to avoid rate limits
    if (i < texts.length - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
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
