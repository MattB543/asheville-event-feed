/**
 * Article embeddings for clustering (docs/news/05-v1-plan.md §6.2 step 2).
 * We embed our own neutral headline and "what happened" line rather than the
 * outlet's text: it drops the outlet's voice and boilerplate and keeps the
 * specifics.
 */

import { TaskType } from '@google/generative-ai';
import { generateEmbedding } from '@/lib/ai/embedding';

export function newsEmbeddingText(headline: string, whatHappened: string): string {
  return `${headline.trim().replace(/[.!?]+$/, '')}. ${whatHappened.trim()}`;
}

/** A RETRIEVAL_DOCUMENT vector, or null when Gemini is unavailable or the call failed. */
export function embedNewsText(text: string): Promise<number[] | null> {
  return generateEmbedding(text, { taskType: TaskType.RETRIEVAL_DOCUMENT });
}
