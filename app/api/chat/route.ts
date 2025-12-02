import { NextRequest } from 'next/server';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  events: string;
  filters: {
    search?: string;
    dateFilter?: string;
    priceFilter?: string;
    tagsInclude?: string[];
    tagsExclude?: string[];
    locations?: string[];
  };
  eventCount: number;
}

function buildSystemPrompt(
  events: string,
  filters: ChatRequest['filters'],
  eventCount: number
): string {
  const now = new Date();
  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
  const currentTime = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });

  const filterLines: string[] = [];
  if (filters.search) filterLines.push(`- Search: "${filters.search}"`);
  if (filters.dateFilter && filters.dateFilter !== 'all') {
    filterLines.push(`- Date: ${filters.dateFilter}`);
  }
  if (filters.priceFilter && filters.priceFilter !== 'any') {
    filterLines.push(`- Price: ${filters.priceFilter}`);
  }
  if (filters.tagsInclude && filters.tagsInclude.length > 0) {
    filterLines.push(`- Tags (included): ${filters.tagsInclude.join(', ')}`);
  }
  if (filters.tagsExclude && filters.tagsExclude.length > 0) {
    filterLines.push(`- Tags (excluded): ${filters.tagsExclude.join(', ')}`);
  }
  if (filters.locations && filters.locations.length > 0) {
    filterLines.push(`- Locations: ${filters.locations.join(', ')}`);
  }

  const filtersSection =
    filterLines.length > 0
      ? `## Current Filters Applied:\n${filterLines.join('\n')}`
      : '## No filters currently applied (showing all events)';

  return `You are an AI assistant helping users find events in Asheville, NC. Today is ${today} and the current time in Asheville is ${currentTime}. IMPORTANT: Always include today's events unless the user specifically asks for future events only.

${filtersSection}

## Available Events (${eventCount} events):

${events}

## Response Format Instructions:
- Use markdown formatting for clear, readable responses
- Group events by date using **bold headings** (e.g., "**Tuesday, December 3**")
- Use horizontal rules (---) to separate different days
- For each event, use this exact structure:
  1. Event title as a clickable markdown link: [**Event Title**](event_url)
  2. Date and time
  3. Location / Venue
  4. Price: $X (or "Price: ?" if unknown)
- IMPORTANT: Always make the event title a clickable link using the URL provided for that event
- Use numbered lists within each day
- Be thorough - list ALL matching events, don't skip any
- Do NOT include tags or descriptions unless specifically asked
- Keep responses friendly but comprehensive
- If user asks about events not in the list, explain those may be filtered out

Example format:
**Tuesday, December 3**

1. [**Jazz Night**](https://example.com/jazz-night)
   Tue, Dec 3 at 8:00 PM
   The Grey Eagle
   Price: $15

2. [**Open Mic**](https://example.com/open-mic)
   Tue, Dec 3 at 9:00 PM
   Fleetwood's
   Price: Free

---

**Wednesday, December 4**

1. [**Trivia Night**](https://example.com/trivia)
   Wed, Dec 4 at 7:00 PM
   Wicked Weed
   Price: Free`;
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Chat feature is not configured' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body: ChatRequest = await request.json();
    const { messages, events, filters, eventCount } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: messages array required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = buildSystemPrompt(events, filters, eventCount);

    // Build messages for OpenRouter API
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://avlgo.com',
        'X-Title': 'AVL GO Event Finder',
      },
      body: JSON.stringify({
        model: 'x-ai/grok-4.1-fast:free',
        messages: apiMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Chat API] OpenRouter error:', response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'AI is busy right now. Please wait a moment and try again.' }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Failed to get response from AI' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Pass through the stream directly to the client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
