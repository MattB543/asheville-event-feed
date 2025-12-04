import { NextRequest } from "next/server";

// Simple in-memory rate limiter (1 request per 2 seconds per IP)
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 2000; // 2 seconds between requests

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const lastRequest = rateLimitMap.get(ip);

  if (lastRequest && now - lastRequest < RATE_LIMIT_MS) {
    return true;
  }

  rateLimitMap.set(ip, now);

  // Clean up old entries every 100 requests to prevent memory leak
  if (rateLimitMap.size > 1000) {
    const cutoff = now - RATE_LIMIT_MS * 10;
    for (const [key, time] of rateLimitMap.entries()) {
      if (time < cutoff) rateLimitMap.delete(key);
    }
  }

  return false;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface EventData {
  id: string;
  title: string;
  description?: string | null;
  startDate: string; // ISO string
  location?: string | null;
  organizer?: string | null;
  price?: string | null;
  url: string;
  tags?: string[] | null;
}

interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

interface ChatRequest {
  messages: ChatMessage[];
  allEvents: EventData[]; // All events from the database
  filters: {
    search?: string;
    priceFilter?: string;
    tagsInclude?: string[];
    tagsExclude?: string[];
    locations?: string[];
  };
  currentDateRange?: DateRange; // Previous date range from conversation (for follow-ups)
}

// Date-changing phrases that should trigger re-extraction
const DATE_CHANGE_PATTERNS = [
  /\btonight\b/i,
  /\btomorrow\b/i,
  /\btoday\b/i,
  /\bweekend\b/i,
  /\bthis week\b/i,
  /\bnext week\b/i,
  /\bnext month\b/i,
  /\bthis month\b/i,
  /\bfriday\b/i,
  /\bsaturday\b/i,
  /\bsunday\b/i,
  /\bmonday\b/i,
  /\btuesday\b/i,
  /\bwednesday\b/i,
  /\bthursday\b/i,
  /\bdecember\b/i,
  /\bjanuary\b/i,
  /\bfebruary\b/i,
  /\bnew year/i,
  /\bchristmas\b/i,
  /\bholiday\b/i,
];

function shouldReExtractDates(
  userMessage: string,
  hasExistingDateRange: boolean
): boolean {
  // Always extract on first message
  if (!hasExistingDateRange) return true;

  // Check if user mentions date-related phrases
  return DATE_CHANGE_PATTERNS.some((pattern) => pattern.test(userMessage));
}

function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function getDefaultDateRange(): DateRange {
  const now = new Date();
  const start = now.toISOString().split("T")[0];
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  return { startDate: start, endDate: end };
}

async function extractDateRange(
  userMessage: string,
  apiKey: string
): Promise<{ dateRange: DateRange; displayMessage: string }> {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const currentTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  const prompt = `You are a date range extractor for an event search system.

Current date/time: ${today} at ${currentTime} (Eastern Time)

Given the user's query, determine the relevant date range for finding events.

Respond with ONLY a JSON object in this exact format (no markdown, no code blocks):
{"startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "reasoning": "brief explanation"}

Rules:
- "tonight" or "today" = today's date only (${now.toISOString().split("T")[0]})
- "tomorrow" = the next day only
- "this weekend" = upcoming Friday through Sunday (if today is Sat/Sun, use today through Sunday)
- "this week" = today through Sunday
- "next week" = Monday through Sunday of next week
- "next month" = all of the following calendar month
- If no time reference is given, use 14 days from today as the default range
- For specific dates mentioned (e.g., "December 31", "New Year's Eve"), use that specific date
- For day names (e.g., "Friday", "this Saturday"), find the next occurrence of that day

User query: "${userMessage}"`;

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://avlgo.com",
          "X-Title": "AVL GO Event Finder",
        },
        body: JSON.stringify({
          model: "google/gemini-2.0-flash-lite-001",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
        }),
      }
    );

    if (!response.ok) {
      console.error(
        "[Chat API] Date extraction failed:",
        response.status,
        await response.text()
      );
      const defaultRange = getDefaultDateRange();
      return {
        dateRange: defaultRange,
        displayMessage: `Checking events from ${formatDateForDisplay(defaultRange.startDate)} to ${formatDateForDisplay(defaultRange.endDate)}...`,
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle potential markdown code blocks)
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "");
    }

    const parsed = JSON.parse(jsonStr);
    const dateRange: DateRange = {
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };

    // Create display message
    let displayMessage: string;
    if (dateRange.startDate === dateRange.endDate) {
      displayMessage = `Checking events for ${formatDateForDisplay(dateRange.startDate)}...`;
    } else {
      displayMessage = `Checking events from ${formatDateForDisplay(dateRange.startDate)} to ${formatDateForDisplay(dateRange.endDate)}...`;
    }

    return { dateRange, displayMessage };
  } catch (error) {
    console.error("[Chat API] Date extraction error:", error);
    const defaultRange = getDefaultDateRange();
    return {
      dateRange: defaultRange,
      displayMessage: `Checking events from ${formatDateForDisplay(defaultRange.startDate)} to ${formatDateForDisplay(defaultRange.endDate)}...`,
    };
  }
}

function filterEventsByDateRange(
  events: EventData[],
  dateRange: DateRange
): EventData[] {
  const startDate = new Date(dateRange.startDate + "T00:00:00");
  const endDate = new Date(dateRange.endDate + "T23:59:59");

  return events.filter((event) => {
    const eventDate = new Date(event.startDate);
    return eventDate >= startDate && eventDate <= endDate;
  });
}

function formatEventsForAI(events: EventData[]): string {
  return events
    .map((event) => {
      const date = new Date(event.startDate).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      const tags = event.tags?.length ? event.tags.join(", ") : "";
      const desc = event.description || "";

      const lines = [
        event.title,
        `URL: ${event.url}`,
        `When: ${date}`,
        event.location ? `Where: ${event.location}` : null,
        event.price ? `Price: ${event.price}` : `Price: ?`,
        event.organizer ? `Host: ${event.organizer}` : null,
        tags ? `Tags: ${tags}` : null,
        desc ? `Description: ${desc}` : null,
      ].filter(Boolean);

      return lines.join("\n");
    })
    .join("\n---\n");
}

function buildSystemPrompt(
  events: string,
  filters: ChatRequest["filters"],
  eventCount: number,
  dateRange: DateRange
): string {
  const now = new Date();
  const today = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const currentTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  const filterLines: string[] = [];
  filterLines.push(
    `- Date range: ${formatDateForDisplay(dateRange.startDate)} to ${formatDateForDisplay(dateRange.endDate)}`
  );
  if (filters.search) filterLines.push(`- Search: "${filters.search}"`);
  if (filters.priceFilter && filters.priceFilter !== "any") {
    filterLines.push(`- Price: ${filters.priceFilter}`);
  }
  if (filters.tagsInclude && filters.tagsInclude.length > 0) {
    filterLines.push(`- Tags (included): ${filters.tagsInclude.join(", ")}`);
  }
  if (filters.tagsExclude && filters.tagsExclude.length > 0) {
    filterLines.push(`- Tags (excluded): ${filters.tagsExclude.join(", ")}`);
  }
  if (filters.locations && filters.locations.length > 0) {
    filterLines.push(`- Locations: ${filters.locations.join(", ")}`);
  }

  const filtersSection = `## Current Filters Applied:\n${filterLines.join("\n")}`;

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
- If user asks about events not in the list, explain those may be filtered out or outside the date range

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
    // Rate limit by IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({
          error: "Please wait a moment before sending another message.",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Chat feature is not configured" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    const body: ChatRequest = await request.json();
    const { messages, allEvents, filters, currentDateRange } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid request: messages array required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get the latest user message
    const latestUserMessage =
      messages.filter((m) => m.role === "user").pop()?.content || "";

    // Create a custom streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Process in background
    (async () => {
      try {
        // Step 1: Determine if we need to extract a new date range
        let dateRange: DateRange;
        let displayMessage: string | null = null;

        const needsDateExtraction = shouldReExtractDates(
          latestUserMessage,
          !!currentDateRange
        );

        if (needsDateExtraction) {
          const result = await extractDateRange(latestUserMessage, apiKey);
          dateRange = result.dateRange;
          displayMessage = result.displayMessage;
        } else {
          dateRange = currentDateRange!;
        }

        // Send date range info to client
        const dateRangeMessage = {
          type: "dateRange",
          data: {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            displayMessage: displayMessage,
            eventCount: 0, // Will update below
          },
        };

        // Step 2: Filter events by date range
        const dateFilteredEvents = filterEventsByDateRange(
          allEvents,
          dateRange
        );

        // Update event count in the message
        dateRangeMessage.data.eventCount = dateFilteredEvents.length;

        // Send the date range info
        await writer.write(
          encoder.encode(`data: ${JSON.stringify(dateRangeMessage)}\n\n`)
        );

        // Step 3: Format events for AI
        const eventsMarkdown = formatEventsForAI(dateFilteredEvents);
        const systemPrompt = buildSystemPrompt(
          eventsMarkdown,
          filters,
          dateFilteredEvents.length,
          dateRange
        );

        // Build messages for OpenRouter API
        const apiMessages = [
          { role: "system", content: systemPrompt },
          ...messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        ];

        // Step 4: Get main AI response (streaming)
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://avlgo.com",
              "X-Title": "AVL GO Event Finder",
            },
            body: JSON.stringify({
              model: "google/gemini-2.0-flash-001",
              messages: apiMessages,
              stream: true,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            "[Chat API] OpenRouter error:",
            response.status,
            errorText
          );
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", data: "Failed to get response from AI" })}\n\n`
            )
          );
          await writer.close();
          return;
        }

        // Stream the response
        const reader = response.body?.getReader();
        if (!reader) {
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", data: "No response body" })}\n\n`
            )
          );
          await writer.close();
          return;
        }

        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // Forward the chunk directly (it's already in SSE format)
          await writer.write(encoder.encode(chunk));
        }

        await writer.close();
      } catch (error) {
        console.error("[Chat API] Stream error:", error);
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", data: "An unexpected error occurred" })}\n\n`
          )
        );
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Chat API] Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
