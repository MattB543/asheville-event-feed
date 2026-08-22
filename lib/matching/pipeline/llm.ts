import {
  getAzureClient,
  getAzureDeploymentName,
  isAzureAIEnabled,
  parseJsonFromModel,
  shouldRetryAzureError,
} from '@/lib/ai/provider-clients';
import { withRetry } from '@/lib/utils/retry';
import { isRecord, isString } from '@/lib/utils/validation';

interface AzureJsonCallOptions {
  systemPrompt: string;
  userPrompt: string;
  maxCompletionTokens?: number;
  maxRetries?: number;
}

function responseContentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => responsePartToString(part)).join('');
  }

  return '';
}

function responsePartToString(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }

  if (isRecord(part) && isString(part.text)) {
    return part.text;
  }

  return '';
}

export async function callAzureJson<T>(options: AzureJsonCallOptions): Promise<T> {
  if (!isAzureAIEnabled()) {
    throw new Error(
      'Azure OpenAI is not configured (AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT)'
    );
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

  const parsed = parseJsonFromModel<T>(responseText, 'object');
  if (parsed === null) {
    throw new Error('No JSON object found in model response');
  }
  return parsed;
}
