import { getAzureClient, getAzureDeploymentName, isAzureAIEnabled } from '@/lib/ai/provider-clients';
import { withRetry } from '@/lib/utils/retry';

interface AzureJsonCallOptions {
  systemPrompt: string;
  userPrompt: string;
  maxCompletionTokens?: number;
  maxRetries?: number;
}

function getErrorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  return null;
}

function shouldRetryAzureError(error: unknown): boolean {
  const status = getErrorStatusCode(error);
  if (status === null) {
    return true;
  }

  // Retry throttling and transient server-side failures.
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return true;
  }

  // 4xx auth/validation errors are not retryable.
  return false;
}

function responseContentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }

  return '';
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty JSON response');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('No JSON object found in model response');
    }
    return JSON.parse(match[0]);
  }
}

export async function callAzureJson<T>(options: AzureJsonCallOptions): Promise<T> {
  if (!isAzureAIEnabled()) {
    throw new Error('Azure OpenAI is not configured (AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT)');
  }

  const client = getAzureClient();
  if (!client) {
    throw new Error('Failed to initialize Azure OpenAI client');
  }

  const responseText = await withRetry(
    async () => {
      const response = await client.chat.completions.create({
        model: getAzureDeploymentName(),
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: options.userPrompt },
        ],
        max_completion_tokens: options.maxCompletionTokens ?? 4000,
        response_format: { type: 'json_object' } as { type: 'json_object' },
      });

      const rawContent = response.choices[0]?.message?.content;
      const text = responseContentToString(rawContent);
      if (!text.trim()) {
        throw new Error('Azure returned empty content');
      }
      return text;
    },
    {
      maxRetries: options.maxRetries ?? 3,
      baseDelay: 2000,
      maxDelay: 20000,
      shouldRetry: shouldRetryAzureError,
    }
  );

  return extractJsonObject(responseText) as T;
}
