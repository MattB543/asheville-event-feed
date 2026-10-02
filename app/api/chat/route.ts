import type { NextRequest } from 'next/server';
import { isAzureAIEnabled } from '@/lib/ai/provider-clients';
import { createChatModel } from '@/lib/ai/chat/model';
import { runEventChat } from '@/lib/ai/chat/runner';
import {
  isCalendarDate,
  parseChatFilters,
  parseChatSearchState,
  type ChatMessage,
} from '@/lib/ai/chat/types';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord } from '@/lib/utils/validation';

export const maxDuration = 300;

function parseRequest(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.messages) ||
    value.messages.length === 0 ||
    value.messages.length > 60
  )
    return null;
  const messages: ChatMessage[] = [];
  for (const message of value.messages) {
    if (
      !isRecord(message) ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      message.content.length > 16000
    )
      return null;
    messages.push({ role: message.role, content: message.content });
  }
  if (messages[messages.length - 1].role !== 'user') return null;
  const filters = parseChatFilters(value.filters);
  const previousState = parseChatSearchState(value.currentSearch);
  // Compatibility with tabs opened before the richer search state was introduced.
  if (
    !previousState &&
    isRecord(value.currentDateRange) &&
    isCalendarDate(value.currentDateRange.startDate) &&
    isCalendarDate(value.currentDateRange.endDate)
  ) {
    filters.dateFilter = 'custom';
    filters.dateStart = value.currentDateRange.startDate;
    filters.dateEnd = value.currentDateRange.endDate;
  }
  return { messages, filters, previousState };
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (isRateLimited(`chat:${ip}`, 1, 2000)) {
    return Response.json(
      { error: 'Please wait a moment before sending another message.' },
      { status: 429 }
    );
  }
  const azureEnabled = isAzureAIEnabled();
  if (!azureEnabled && !process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'Chat feature is not configured' }, { status: 503 });
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = parseRequest(value);
  if (!body) return Response.json({ error: 'Invalid request body' }, { status: 400 });

  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    cancellation.signal,
    AbortSignal.timeout(240_000),
  ]);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentTokens = false;
      const send = (frame: unknown) => {
        if (!signal.aborted)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };
      try {
        const providers = azureEnabled
          ? ['azure' as const, ...(process.env.OPENROUTER_API_KEY ? ['openrouter' as const] : [])]
          : ['openrouter' as const];
        let succeeded = false;
        for (const provider of providers) {
          try {
            await runEventChat({
              ...body,
              model: createChatModel(provider, signal),
              onSearch: (state, count) => {
                send({
                  type: 'searchState',
                  data: {
                    ...state,
                    eventCount: count,
                    displayMessage:
                      state.filters.dateStart || state.filters.dateEnd
                        ? `Checking events ${state.filters.dateStart || 'today'} through ${state.filters.dateEnd || 'all upcoming dates'}`
                        : state.filters.dateFilter === 'today' ||
                            state.filters.dateFilter === 'tomorrow'
                          ? `Searching events ${state.filters.dateFilter}`
                          : state.filters.dateFilter === 'weekend'
                            ? 'Searching events this weekend'
                            : 'Searching all upcoming events',
                  },
                });
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
            console.error(`[Chat API] ${provider} failed:`, error);
            // Switching providers after output starts would append a second answer.
            if (sentTokens || signal.aborted) break;
          }
        }
        if (!succeeded && !signal.aborted)
          send({ type: 'error', data: 'Unable to complete the event search. Please try again.' });
        if (!signal.aborted) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        console.error('[Chat API] Stream error:', error);
        if (!signal.aborted) send({ type: 'error', data: 'An unexpected error occurred' });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      cancellation.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
