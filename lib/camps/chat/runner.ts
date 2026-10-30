/**
 * The camps chat's tool loop and its SSE stream (docs/camps/06-ai-chat-plan.md §5.1), adapted
 * from the events chat (lib/ai/chat/runner.ts, app/api/chat/route.ts). The route only reads and
 * checks the request; everything after that is here, so the offline tests can drive it with fake
 * models and sessions.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ChatModel } from '@/lib/ai/chat/runner';
import { isRecord } from '@/lib/utils/validation';
import { parseCampSearchFilters } from './validation';
import {
  CAMP_MAX_PLANNING_ROUNDS,
  CAMP_MAX_TOOL_CALLS,
  type CampChatFrame,
  type CampChatRequest,
  type CampDetailsResult,
  type CampToolSession,
  type CampTurnEvidence,
  type ChatMessage,
} from './types';

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_CONVERSATION_CHARS = 32_000;
export const MAX_DIRECTORY_CHARS = 4_000;

const MODEL_OMITS = new Set(['id', 'slug', 'tone', 'sortDate']);

/**
 * What the model reads of a tool result: the browser gets it whole, but ids and slugs (the url
 * carries the slug), display-only fields and empty values (null, [], false) are left out, which
 * cuts a search page by a fifth to a third. A field left out is unknown, as the prompt says.
 */
function forModel(key: string, value: unknown): unknown {
  if (MODEL_OMITS.has(key)) return undefined;
  if (value === null || (Array.isArray(value) && value.length === 0)) return undefined;
  if (value === false && key !== 'hasMore') return undefined;
  return key === 'checkedAt' && typeof value === 'string' ? value.slice(0, 10) : value;
}

/** The request body, or null when it isn't one. A stale or invalid lastSearch is dropped. */
export function parseCampChatRequest(value: unknown): CampChatRequest | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  if (value.messages.length === 0 || value.messages.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  let total = 0;
  for (const message of value.messages) {
    if (
      !isRecord(message) ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      message.content.length > MAX_MESSAGE_CHARS ||
      (message.role === 'user' && !message.content.trim())
    )
      return null;
    total += message.content.length;
    messages.push({ role: message.role, content: message.content });
  }
  if (total > MAX_CONVERSATION_CHARS || messages[messages.length - 1].role !== 'user') return null;

  const directory = value.directory ?? '';
  if (typeof directory !== 'string' || directory.length > MAX_DIRECTORY_CHARS) return null;

  let lastSearch = null;
  if (value.lastSearch != null) {
    try {
      lastSearch = parseCampSearchFilters(value.lastSearch);
    } catch {
      // Saved by an older version, or tampered with: start the next search fresh.
    }
  }
  return { messages, directory, lastSearch };
}

const PLANNING_INSTRUCTION: ChatCompletionMessageParam = {
  role: 'system',
  content:
    'Gather evidence with the tools before answering. Do not write the reply to the parent in this planning step. When you have enough evidence, respond READY. Recommendations need a search_camps call; a question about a specific camp may use get_camp_details directly.',
};

/** One provider attempt: plan with the tools, then stream one tools-free answer. */
export async function runCampChat(options: {
  messages: ChatMessage[];
  systemPrompt: string;
  model: ChatModel;
  session: CampToolSession;
  signal: AbortSignal;
  onEvidence: (evidence: CampTurnEvidence) => Promise<void>;
  onToken: (token: string) => Promise<void>;
}): Promise<void> {
  const { model, session, signal } = options;
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: options.systemPrompt },
    ...options.messages,
  ];
  let hasEvidence = false;
  let executed = 0;

  for (let round = 0; round < CAMP_MAX_PLANNING_ROUNDS; round++) {
    signal.throwIfAborted();
    const response = await model.plan([...messages, PLANNING_INSTRUCTION], !hasEvidence);
    const calls = response.tool_calls;
    if (!calls?.length) break;
    messages.push({ role: 'assistant', content: response.content, tool_calls: calls });
    // Sequential, even when a provider returns several calls: the session keeps the turn's
    // searches in order. Every call gets an answer, or the next request is rejected.
    for (const call of calls) {
      signal.throwIfAborted();
      let result: unknown;
      try {
        if (executed >= CAMP_MAX_TOOL_CALLS) {
          throw new Error(
            `Tool call budget exhausted (${CAMP_MAX_TOOL_CALLS} a turn). Answer with the evidence gathered and say what could not be checked.`
          );
        }
        if (call.type !== 'function') throw new Error('Only function tools are supported.');
        const args: unknown = JSON.parse(call.function.arguments);
        executed++;
        result = await session.execute(call.function.name, args);
        // An empty search is evidence (there are no candidates); details that found nothing aren't.
        if (
          call.function.name === 'search_camps' ||
          (call.function.name === 'get_camp_details' &&
            ((result as CampDetailsResult).camps?.length ?? 0) > 0)
        )
          hasEvidence = true;
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : 'The camp tool failed.',
          instruction:
            'Correct the arguments, or explain that the lookup could not be completed. Do not invent camps.',
        };
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result, forModel),
      });
    }
    if (executed >= CAMP_MAX_TOOL_CALLS) break;
  }

  messages.push({
    role: 'system',
    content: hasEvidence
      ? 'Now answer the latest message using only the tool results above. The lookup budget is spent. If a tool failed or results were limited, say so; never claim completeness or invent camps.'
      : 'No camp lookup completed successfully. Say you could not complete the search and invite the parent to try again. Do not recommend camps or claim that no camps match.',
  });
  signal.throwIfAborted();
  const tokens = await model.stream(messages);
  let started = false;
  for await (const token of tokens) {
    signal.throwIfAborted();
    // The evidence goes out just before the answer, so a provider that fails first never shows
    // its cards.
    if (!started) {
      started = true;
      await options.onEvidence(session.snapshot());
    }
    await options.onToken(token);
  }
  if (!started) throw new Error('Chat provider returned an empty reply.');
}

export type ChatProvider = 'azure' | 'openrouter';

/**
 * The SSE body: each provider in turn until one answers, switching only before any answer token
 * (a second provider after that would append a second answer). Frames are the events chat's:
 * tokens as `choices[0].delta.content`, `{type: 'error', data}`, then `[DONE]`, plus one
 * `campResults` frame right before the answer.
 */
export function campChatStream(options: {
  providers: ChatProvider[];
  /** The request's own signal: the visitor left. */
  requestSignal: AbortSignal;
  timeoutMs?: number;
  attempt: (
    provider: ChatProvider,
    signal: AbortSignal,
    callbacks: Pick<Parameters<typeof runCampChat>[0], 'onEvidence' | 'onToken'>
  ) => Promise<void>;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 240_000);
  const signal = AbortSignal.any([options.requestSignal, cancellation.signal, timeout]);
  const gone = () => cancellation.signal.aborted || options.requestSignal.aborted;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: unknown) => {
        if (!gone()) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };
      let sentTokens = false;
      let succeeded = false;
      for (const provider of options.providers) {
        if (signal.aborted) break;
        try {
          await options.attempt(provider, signal, {
            onEvidence: (evidence) => {
              send({ type: 'campResults', data: evidence } satisfies CampChatFrame);
              return Promise.resolve();
            },
            onToken: (token) => {
              sentTokens = true;
              send({ choices: [{ delta: { content: token } }] });
              return Promise.resolve();
            },
          });
          succeeded = true;
          break;
        } catch (error) {
          // The error alone: never the conversation, the kids or camp text.
          const message = error instanceof Error ? error.message : String(error);
          if (!gone()) console.error(`[Camps Chat] ${provider} failed: ${message.slice(0, 300)}`);
          if (sentTokens) break;
        }
      }
      if (!succeeded) {
        send({
          type: 'error',
          data: timeout.aborted
            ? 'The camp search took too long. Please try again.'
            : sentTokens
              ? 'The answer was cut off. Please try again.'
              : 'Unable to complete the camp search. Please try again.',
        });
      }
      if (!gone()) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      if (!cancellation.signal.aborted) controller.close();
    },
    cancel() {
      cancellation.abort();
    },
  });
}
