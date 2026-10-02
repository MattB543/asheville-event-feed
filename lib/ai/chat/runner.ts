import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { createChatToolSession } from './tools';
import { buildChatSystemPrompt } from './prompt';
import type { ChatFilters, ChatMessage, ChatSearchState } from './types';

export interface ChatModel {
  plan: (
    messages: ChatCompletionMessageParam[],
    requireTool: boolean
  ) => Promise<ChatCompletionMessage>;
  stream: (messages: ChatCompletionMessageParam[]) => Promise<AsyncIterable<string>>;
}

/** Provider-agnostic tool loop; neither provider can bypass validated database tools. */
export async function runEventChat(options: {
  messages: ChatMessage[];
  filters: ChatFilters;
  previousState?: ChatSearchState;
  model: ChatModel;
  session?: ReturnType<typeof createChatToolSession>;
  onSearch: (state: ChatSearchState, count: number) => Promise<void>;
  onToken: (token: string) => Promise<void>;
}) {
  const session = options.session ?? createChatToolSession(options.filters, options.previousState);
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildChatSystemPrompt(options.filters, session.state.filters) },
    ...options.messages,
  ];
  const planningInstruction: ChatCompletionMessageParam = {
    role: 'system',
    content:
      'Gather evidence using the tools before answering. Do not write the user-facing reply in this planning step. When enough evidence is collected, respond READY. For recommendations you must search events. For a specific event detail question you may use get_event_details directly.',
  };
  let usedEvidenceTool = false;
  let toolCount = 0;

  for (let round = 0; round < 5; round++) {
    const response = await options.model.plan(
      [...messages, planningInstruction],
      !usedEvidenceTool
    );
    const calls = response.tool_calls;
    if (!calls?.length) break;
    messages.push({ role: 'assistant', content: response.content, tool_calls: calls });
    // Stateful searches must run sequentially, even if a provider returns several calls.
    for (const call of calls) {
      let result: unknown;
      try {
        if (++toolCount > 8)
          throw new Error('Tool call budget exhausted. Explain any remaining limitation.');
        if (call.type !== 'function') throw new Error('Only function tools are supported.');
        const args: unknown = JSON.parse(call.function.arguments);
        result = await session.execute(call.function.name, args);
        if (call.function.name === 'search_events' || call.function.name === 'get_event_details')
          usedEvidenceTool = true;
        if (call.function.name === 'search_events') {
          const count =
            typeof result === 'object' &&
            result !== null &&
            'events' in result &&
            Array.isArray(result.events)
              ? result.events.length
              : 0;
          await options.onSearch(session.state, count);
        }
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : 'The event tool failed.',
          instruction:
            'Correct the arguments or explain that the search could not be completed. Do not invent matches.',
        };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  messages.push({
    role: 'system',
    content: usedEvidenceTool
      ? 'Now answer the latest user request using only the verified tool results above. The search budget is complete. If results were truncated or tools failed, state the limitation; never claim completeness or invent matches.'
      : 'No event lookup completed successfully. Explain that you could not complete the search and ask the user to retry. Do not recommend events or claim there are no matching events.',
  });
  for await (const token of await options.model.stream(messages)) await options.onToken(token);
}
