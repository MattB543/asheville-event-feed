/**
 * Azure OpenAI client for AI-powered deduplication.
 *
 * Uses lazy initialization and singleton pattern.
 * Supports both standard Azure OpenAI env vars and user's existing vars.
 */

import { AzureOpenAI } from "openai";

let client: AzureOpenAI | null = null;

/**
 * Get Azure OpenAI API key from environment.
 * Supports multiple variable names for flexibility.
 */
function getApiKey(): string | undefined {
  return (
    process.env.AZURE_OPENAI_API_KEY ||
    process.env.AZURE_KEY_1
  );
}

/**
 * Get Azure OpenAI endpoint from environment.
 * Supports multiple variable names for flexibility.
 */
function getEndpoint(): string | undefined {
  return (
    process.env.AZURE_OPENAI_ENDPOINT ||
    process.env.AZURE_ENDPOINT
  );
}

/**
 * Get the Azure OpenAI deployment name.
 */
function getDeployment(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini";
}

/**
 * Get the Azure OpenAI API version.
 */
function getApiVersion(): string {
  return process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";
}

/**
 * Check if Azure OpenAI is configured and available.
 */
export function isAzureAIEnabled(): boolean {
  const apiKey = getApiKey();
  const endpoint = getEndpoint();
  return !!(apiKey && endpoint);
}

/**
 * Get or create the Azure OpenAI client.
 * Returns null if not configured.
 */
export function getAzureClient(): AzureOpenAI | null {
  if (client) return client;

  const apiKey = getApiKey();
  const endpoint = getEndpoint();

  if (!apiKey || !endpoint) {
    return null;
  }

  client = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion: getApiVersion(),
    deployment: getDeployment(),
  });

  return client;
}

/**
 * Get the deployment name for use in API calls.
 */
export function getAzureDeployment(): string {
  return getDeployment();
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
  const azureClient = getAzureClient();
  if (!azureClient) {
    console.warn("[Azure AI] Client not configured");
    return null;
  }

  const response = await azureClient.chat.completions.create({
    model: getDeployment(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: options?.maxTokens ?? 2000,
    // Note: GPT-5-mini doesn't support temperature parameter
  });

  const usage = response.usage;

  return {
    content: response.choices[0]?.message?.content || "",
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
  const azureClient = getAzureClient();
  if (!azureClient) {
    console.warn("[Azure AI] Client not configured");
    return null;
  }

  const stream = await azureClient.chat.completions.create({
    model: getDeployment(),
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
  const azureClient = getAzureClient();
  if (!azureClient) {
    console.warn("[Azure AI] Client not configured");
    return null;
  }

  const response = await azureClient.chat.completions.create({
    model: getDeployment(),
    messages,
    max_completion_tokens: options?.maxTokens ?? 2000,
  });

  return response.choices[0]?.message?.content || null;
}
