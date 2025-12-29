import { AzureOpenAI } from "openai";
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { env, isAIEnabled as checkAIEnabled } from "../config/env";

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
    geminiModel = geminiClient.getGenerativeModel({ model: "gemini-2.5-flash" });
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
      model: "gemini-embedding-001",
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
  return process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_KEY_1;
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
  return process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini";
}

/**
 * Get the Azure OpenAI API version.
 */
function getAzureApiVersion(): string {
  return process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";
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
    console.warn("[Azure AI] Client not configured");
    return null;
  }

  const response = await client.chat.completions.create({
    model: getAzureDeployment(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: options?.maxTokens ?? 2000,
    // Note: GPT-5-mini doesn't support temperature parameter
  });

  const usage = response.usage;
  const content = response.choices[0]?.message?.content || "";

  // Debug log to help troubleshoot empty responses
  if (!content) {
    console.warn("[Azure AI] Response details:", {
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
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: {
    maxTokens?: number;
  }
): Promise<AsyncIterable<string> | null> {
  const client = getAzureClient();
  if (!client) {
    console.warn("[Azure AI] Client not configured");
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
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: {
    maxTokens?: number;
  }
): Promise<string | null> {
  const client = getAzureClient();
  if (!client) {
    console.warn("[Azure AI] Client not configured");
    return null;
  }

  const response = await client.chat.completions.create({
    model: getAzureDeployment(),
    messages,
    max_completion_tokens: options?.maxTokens ?? 2000,
  });

  return response.choices[0]?.message?.content || null;
}
