import OpenAI from 'openai';
import { getAzureClient, getAzureDeploymentName } from '@/lib/ai/provider-clients';
import { CHAT_TOOLS } from './tools';
import type { ChatModel } from './runner';

export function createChatModel(provider: 'azure' | 'openrouter', signal: AbortSignal): ChatModel {
  const client =
    provider === 'azure'
      ? getAzureClient()
      : new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': 'https://www.avlgo.com',
            'X-Title': 'AVL GO Event Finder',
          },
          maxRetries: 0,
        });
  if (!client) throw new Error('Chat provider is not configured.');
  const model =
    provider === 'azure'
      ? getAzureDeploymentName()
      : process.env.OPENROUTER_CHAT_MODEL || 'google/gemini-2.5-flash';
  const requestOptions = { signal, timeout: 60_000, maxRetries: 0 };
  return {
    async plan(messages, requireTool) {
      const result = await client.chat.completions.create(
        {
          model,
          messages,
          tools: CHAT_TOOLS,
          tool_choice: requireTool ? 'required' : 'auto',
          parallel_tool_calls: false,
          max_completion_tokens: 4000,
          // GPT-6 Luna requires non-reasoning mode for Chat Completions tools.
          ...(provider === 'azure' && model.startsWith('gpt-6')
            ? { reasoning_effort: 'none' as const }
            : {}),
        },
        requestOptions
      );
      const message = result.choices[0]?.message;
      if (!message) throw new Error('Chat provider returned no message.');
      return message;
    },
    async stream(messages) {
      const result = await client.chat.completions.create(
        {
          model,
          messages,
          stream: true,
          max_completion_tokens: 5000,
        },
        requestOptions
      );
      return (async function* () {
        let emitted = false;
        for await (const chunk of result) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            emitted = true;
            yield content;
          }
        }
        if (!emitted) throw new Error('Chat provider returned an empty reply.');
      })();
    },
  };
}
