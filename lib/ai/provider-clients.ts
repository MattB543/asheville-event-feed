import { AzureOpenAI } from 'openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { env, isAIEnabled as checkAIEnabled } from '../config/env';

// ============================================================================
// JSON PARSING UTILITIES
// ============================================================================

/**
 * Parse JSON out of a raw LLM response, tolerating the common ways models wrap
 * or pad their output. Strategy:
 *   1. Strip surrounding markdown code fences (```json ... ``` or ``` ... ```).
 *   2. Try JSON.parse on the cleaned string.
 *   3. On failure, scan for balanced `{...}` and `[...]` values, respecting
 *      quoted strings, and parse the first valid candidate.
 *   4. Return null if nothing parses.
 *
 * This is intentionally more tolerant than any single call site's inline
 * parsing, so callers only gain robustness. Callers keep their own failure
 * handling (logging, defaults, throwing) around a null return.
 */
export function parseJsonFromModel<T>(
  raw: string,
  mode: 'object' | 'array' | 'auto' = 'auto'
): T | null {
  if (!raw) return null;

  // Strip surrounding markdown code fences if present.
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
  }

  // First attempt: parse the cleaned string as-is.
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall through to bracket extraction.
  }

  // Second attempt: scan for balanced JSON values. Using the last closing
  // bracket is unsafe when a model adds prose containing braces afterward.
  const allowedOpeners = mode === 'object' ? '{' : mode === 'array' ? '[' : '{[';
  for (let start = 0; start < cleaned.length; start++) {
    const opener = cleaned[start];
    if (!allowedOpeners.includes(opener)) continue;

    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let index = start; index < cleaned.length; index++) {
      const char = cleaned[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === opener) depth++;
      else if (char === closer && --depth === 0) {
        end = index;
        break;
      }
    }

    if (end === -1) continue;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      // Continue scanning in case the prose contains brackets before the JSON.
    }
  }

  return null;
}

// ============================================================================
// GEMINI CLIENTS
// ============================================================================

let geminiClient: GoogleGenerativeAI | null = null;
let geminiModel: GenerativeModel | null = null;
let geminiEmbeddingModel: GenerativeModel | null = null;

// Lazily get or create the model - reads env var at call time, not module load time
export function getModel(): GenerativeModel | null {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(apiKey);
  }

  if (!geminiModel) {
    geminiModel = geminiClient.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  return geminiModel;
}

// Lazily get or create the embedding model (gemini-embedding-001)
export function getEmbeddingModel(): GenerativeModel | null {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

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

export function isAIEnabled(): boolean {
  return checkAIEnabled();
}

// ============================================================================
// AZURE OPENAI CLIENTS
// ============================================================================

let azureClient: AzureOpenAI | null = null;

/**
 * Get Azure OpenAI API key from environment.
 * Supports multiple variable names for flexibility.
 */
function getAzureApiKey(): string | undefined {
  return process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_API_KEY || process.env.AZURE_KEY_1;
}

/**
 * Get Azure OpenAI endpoint from environment.
 * Supports multiple variable names for flexibility.
 */
function getAzureEndpoint(): string | undefined {
  return process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_ENDPOINT;
}

/**
 * Get the Azure OpenAI deployment name.
 */
function getAzureDeployment(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini';
}

/**
 * Get the Azure OpenAI API version.
 */
function getAzureApiVersion(): string {
  return process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
}

/**
 * Check if Azure OpenAI is configured and available.
 */
export function isAzureAIEnabled(): boolean {
  const apiKey = getAzureApiKey();
  const endpoint = getAzureEndpoint();
  return !!(apiKey && endpoint);
}

/**
 * Get or create the Azure OpenAI client.
 * Returns null if not configured.
 */
export function getAzureClient(): AzureOpenAI | null {
  if (azureClient) return azureClient;

  const apiKey = getAzureApiKey();
  const endpoint = getAzureEndpoint();

  if (!apiKey || !endpoint) {
    return null;
  }

  azureClient = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: getAzureApiVersion(),
    deployment: getAzureDeployment(),
  });

  return azureClient;
}

/**
 * Get the deployment name for use in API calls.
 */
export function getAzureDeploymentName(): string {
  return getAzureDeployment();
}

/**
 * Chat completion with Azure OpenAI.
 * Returns the response content and token usage.
 */
export async function azureChatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    maxTokens?: number;
  }
): Promise<{
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
} | null> {
  const client = getAzureClient();
  if (!client) {
    console.warn('[Azure AI] Client not configured');
    return null;
  }

  const response = await client.chat.completions.create({
    model: getAzureDeployment(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: options?.maxTokens ?? 2000,
    // Note: GPT-5-mini doesn't support temperature parameter
  });

  const usage = response.usage;
  const content = response.choices[0]?.message?.content || '';

  // Debug log to help troubleshoot empty responses
  if (!content) {
    console.warn('[Azure AI] Response details:', {
      finishReason: response.choices[0]?.finish_reason,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      hasMessage: !!response.choices[0]?.message,
      // Check for reasoning model response
      message: JSON.stringify(response.choices[0]?.message),
    });
  }

  return {
    content,
    usage: {
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
  };
}

/**
 * Streaming chat completion with Azure OpenAI.
 * Returns an async iterable of content chunks.
 */
export async function azureChatCompletionStream(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: {
    maxTokens?: number;
  }
): Promise<AsyncIterable<string> | null> {
  const client = getAzureClient();
  if (!client) {
    console.warn('[Azure AI] Client not configured');
    return null;
  }

  const stream = await client.chat.completions.create({
    model: getAzureDeployment(),
    messages,
    max_completion_tokens: options?.maxTokens ?? 4000,
    stream: true,
  });

  // Return an async generator that yields content chunks
  return (async function* () {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  })();
}

/**
 * Non-streaming chat completion with Azure OpenAI (with multiple messages).
 * Used for simpler requests like date extraction.
 *
 * Note: GPT-5-mini does not support temperature parameter (only default 1).
 */
export async function azureChatCompletionMessages(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: {
    maxTokens?: number;
  }
): Promise<string | null> {
  const client = getAzureClient();
  if (!client) {
    console.warn('[Azure AI] Client not configured');
    return null;
  }

  const response = await client.chat.completions.create({
    model: getAzureDeployment(),
    messages,
    max_completion_tokens: options?.maxTokens ?? 2000,
  });

  return response.choices[0]?.message?.content || null;
}

/**
 * Vision chat completion with Azure OpenAI.
 * Sends images as base64 data URLs alongside a text prompt.
 * Returns the response content and token usage.
 */
export async function azureVisionChatCompletion(
  systemPrompt: string,
  textPrompt: string,
  imageDataUrls: string[],
  options?: {
    maxTokens?: number;
    detail?: 'low' | 'high' | 'auto';
  }
): Promise<{
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
} | null> {
  const client = getAzureClient();
  if (!client) {
    console.warn('[Azure AI] Client not configured');
    return null;
  }

  const contentParts: ChatCompletionContentPart[] = [
    { type: 'text', text: textPrompt },
    ...imageDataUrls.map(
      (url) =>
        ({
          type: 'image_url',
          image_url: {
            url,
            detail: options?.detail ?? 'high',
          },
        }) as ChatCompletionContentPart
    ),
  ];

  const response = await client.chat.completions.create({
    model: getAzureDeployment(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contentParts },
    ],
    max_completion_tokens: options?.maxTokens ?? 4000,
  });

  const usage = response.usage;
  const content = response.choices[0]?.message?.content || '';

  return {
    content,
    usage: {
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
  };
}
