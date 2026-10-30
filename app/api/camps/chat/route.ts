import type { NextRequest } from 'next/server';
import { isAzureAIEnabled } from '@/lib/ai/provider-clients';
import { createChatModel } from '@/lib/ai/chat/model';
import { directoryContext } from '@/lib/camps/chat/context';
import { buildCampChatPrompt } from '@/lib/camps/chat/prompt';
import { campChatStream, parseCampChatRequest, runCampChat } from '@/lib/camps/chat/runner';
import { CAMP_CHAT_TOOLS, createCampToolSession } from '@/lib/camps/chat/tools';
import { isRateLimited, clientIp } from '@/lib/utils/rate-limit';

export const maxDuration = 300;

const MAX_BODY_BYTES = 128 * 1024;

/** The body as text, or null past MAX_BODY_BYTES (counted as read, not from Content-Length). */
async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function POST(request: NextRequest) {
  // Per server instance, like the events chat: a brake, not a spending cap.
  const ip = clientIp(request);
  if (isRateLimited(`camps-chat:${ip}`, 1, 2000)) {
    return Response.json(
      { error: 'Please wait a moment before sending another message.' },
      { status: 429 }
    );
  }
  if (isRateLimited(`camps-chat-hour:${ip}`, 60, 60 * 60 * 1000)) {
    return Response.json({ error: 'Please try again later.' }, { status: 429 });
  }
  const azureEnabled = isAzureAIEnabled();
  if (!azureEnabled && !process.env.OPENROUTER_API_KEY) {
    return Response.json({ error: 'Chat feature is not configured' }, { status: 503 });
  }
  const text = await readBody(request);
  if (text === null) return Response.json({ error: 'Request too large' }, { status: 413 });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = parseCampChatRequest(value);
  if (!body) return Response.json({ error: 'Invalid request body' }, { status: 400 });

  // One clock for the prompt, every search and the fallback.
  const now = new Date();
  const systemPrompt = buildCampChatPrompt({
    now,
    directory: directoryContext(body.directory),
    lastSearch: body.lastSearch,
  });
  const stream = campChatStream({
    providers: azureEnabled
      ? ['azure', ...(process.env.OPENROUTER_API_KEY ? (['openrouter'] as const) : [])]
      : ['openrouter'],
    requestSignal: request.signal,
    attempt: (provider, signal, callbacks) =>
      runCampChat({
        messages: body.messages,
        systemPrompt,
        model: createChatModel(provider, signal, {
          tools: CAMP_CHAT_TOOLS,
          title: 'AVL GO Camp Finder',
        }),
        // A fresh session each attempt: a failed provider's searches never reach the cards.
        session: createCampToolSession({ now, previousSearch: body.lastSearch }),
        signal,
        ...callbacks,
      }),
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  });
}
