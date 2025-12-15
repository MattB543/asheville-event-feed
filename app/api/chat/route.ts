import { NextRequest } from "next/server";
import {
  isAzureAIEnabled,
  azureChatCompletionMessages,
  azureChatCompletionStream,
} from "@/lib/ai/azure-client";
import { generateEventUrl } from "@/lib/utils/slugify";

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

function buildDateExtractionPrompt(userMessage: string): string {
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

  return `You are a date range extractor for an event search system.

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
}

function parseDateExtractionResponse(content: string): DateRange {
  // Parse JSON from response (handle potential markdown code blocks)
  let jsonStr = content.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "");
  }

  const parsed = JSON.parse(jsonStr);
  return {
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  };
}

async function extractDateRangeWithAzure(
  userMessage: string
): Promise<{ dateRange: DateRange; displayMessage: string } | null> {
  const prompt = buildDateExtractionPrompt(userMessage);

  try {
    const content = await azureChatCompletionMessages(
      [{ role: "user", content: prompt }],
      { maxTokens: 500 }
    );

    if (!content) {
      return null;
    }

    const dateRange = parseDateExtractionResponse(content);

    // Create display message
    let displayMessage: string;
    if (dateRange.startDate === dateRange.endDate) {
      displayMessage = `Checking events for ${formatDateForDisplay(dateRange.startDate)}...`;
    } else {
      displayMessage = `Checking events from ${formatDateForDisplay(dateRange.startDate)} to ${formatDateForDisplay(dateRange.endDate)}...`;
    }

    return { dateRange, displayMessage };
  } catch (error) {
    console.error("[Chat API] Azure date extraction error:", error);
    return null;
  }
}

async function extractDateRangeWithOpenRouter(
  userMessage: string,
  apiKey: string
): Promise<{ dateRange: DateRange; displayMessage: string } | null> {
  const prompt = buildDateExtractionPrompt(userMessage);

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
        "[Chat API] OpenRouter date extraction failed:",
        response.status,
        await response.text()
      );
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const dateRange = parseDateExtractionResponse(content);

    // Create display message
    let displayMessage: string;
    if (dateRange.startDate === dateRange.endDate) {
      displayMessage = `Checking events for ${formatDateForDisplay(dateRange.startDate)}...`;
    } else {
      displayMessage = `Checking events from ${formatDateForDisplay(dateRange.startDate)} to ${formatDateForDisplay(dateRange.endDate)}...`;
    }

    return { dateRange, displayMessage };
  } catch (error) {
    console.error("[Chat API] OpenRouter date extraction error:", error);
    return null;
  }
}

async function extractDateRange(
  userMessage: string,
  openRouterApiKey: string | undefined
): Promise<{ dateRange: DateRange; displayMessage: string }> {
  // Try Azure first if configured
  if (isAzureAIEnabled()) {
    console.log("[Chat API] Using Azure for date extraction");
    const result = await extractDateRangeWithAzure(userMessage);
    if (result) return result;
    console.warn("[Chat API] Azure date extraction failed, trying OpenRouter fallback");
  }

  // Fall back to OpenRouter if Azure fails or isn't configured
  if (openRouterApiKey) {
    console.log("[Chat API] Using OpenRouter for date extraction");
    const result = await extractDateRangeWithOpenRouter(userMessage, openRouterApiKey);
    if (result) return result;
  }

  // Default fallback
  console.warn("[Chat API] All date extraction methods failed, using default range");
  const defaultRange = getDefaultDateRange();
  return {
    dateRange: defaultRange,
    displayMessage: `Checking events from ${formatDateForDisplay(defaultRange.startDate)} to ${formatDateForDisplay(defaultRange.endDate)}...`,
  };
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
      const eventDate = new Date(event.startDate);
      const date = eventDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      const tags = event.tags?.length ? event.tags.join(", ") : "";
      const desc = event.description || "";

      // Generate internal AVL GO event page URL instead of external source URL
      const internalUrl = generateEventUrl(event.title, eventDate, event.id);

      const lines = [
        event.title,
        `URL: ${internalUrl}`,
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

  const filtersSection = `## User's Active Filters:\n${filterLines.join("\n")}`;

  return `You are a knowledgeable local guide helping users discover events in Asheville, NC. Today is ${today} and the current time is ${currentTime} (Eastern Time).

## Your Role
You intelligently curate and recommend events based on what the user is actually looking for. You do NOT just dump lists of events - you select and explain based on the user's intent.

${filtersSection}

## Available Events (${eventCount} events in this date range):

${events}

## Response Behavior - FOLLOW THESE CAREFULLY

### When user asks for "interesting", "best", "unique", "cool", "recommendations", "what should I do", or similar:
- Select only 5-8 standout events that are genuinely notable
- For EACH event, add a brief italicized explanation of why it's worth attending
- Prioritize: concerts/shows at known venues, special one-time events, festivals, holiday specials, unique local experiences
- AVOID including: recurring weekly meetings, generic classes, career fairs, committee meetings, story times, meditation groups (unless user asks)

### When user asks for specific event types (e.g., "jazz", "comedy", "free", "outdoor", "family-friendly"):
- Filter to ONLY events matching that criteria
- Show up to 10-15 relevant matches
- If many matches exist, show the highlights and mention there are more available

### When user explicitly asks to "show all", "list everything", or "give me the full list":
- ONLY then provide a comprehensive list grouped by day
- No explanations needed per event in this case

### When user asks about a specific event or wants more details:
- Provide full details for that event including description if available
- Suggest 2-3 similar events they might also enjoy

## What Makes an Event Worth Recommending
- Notable Asheville venues: Orange Peel, Grey Eagle, Harrah's Cherokee Center, NC Arboretum, Asheville Community Theatre
- Named performers/artists (specific band names, comedian names, etc.)
- Special one-time or seasonal events (not recurring weekly)
- Holiday-themed events during holiday season
- Large community events, festivals, markets (like The Big Crafty)
- Unique local experiences

## What to Deprioritize (unless specifically relevant to the query)
- Generic recurring events (weekly book clubs, meditation groups, support groups)
- Career fairs, committee meetings, certification training
- Events with vague titles AND unknown prices
- Online/virtual events
- Very early morning events (before 7 AM)

## Response Format
- Use **bold headings** for date groupings
- Make event titles clickable: [**Event Title**](url)
- Format: Title link, then date/time, location, price on separate lines
- For curated picks: Add brief *italicized reason* why you recommend it
- End curated responses with: "Want more options? I can show you [relevant alternatives based on their query]."

## Example of a Good Curated Response

**Friday, December 5**

1. [**OK Go**](https://avlgo.com/events/ok-go-2025-12-05-a1b2c3)
   Fri, Dec 5 at 8:00 PM
   The Orange Peel
   Price: $35
   *The iconic alt-rock band known for their creative music videos - rare Asheville stop*

2. [**Southern Culture on the Skids**](https://avlgo.com/events/southern-culture-on-the-skids-2025-12-05-d4e5f6)
   Fri, Dec 5 at 8:00 PM
   The Grey Eagle
   Price: $27
   *Legendary Southern rock - always a high-energy show*

---

**Saturday, December 6**

3. [**The Big Crafty**](https://avlgo.com/events/the-big-crafty-2025-12-06-g7h8i9)
   Sat, Dec 6 at 10:00 AM
   Harrah's Cherokee Center
   Price: Free
   *Asheville's premier holiday craft market with 175+ local artisans*

---

Want more options? I can show you all live music this weekend, all free events, or the full list of ${eventCount} events.`;
}

/**
 * Stream chat response using Azure OpenAI.
 * Returns true if successful, false if should fall back to OpenRouter.
 */
async function streamWithAzure(
  apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder
): Promise<boolean> {
  try {
    const stream = await azureChatCompletionStream(apiMessages);
    if (!stream) {
      console.warn("[Chat API] Azure streaming not available");
      return false;
    }

    console.log("[Chat API] Using Azure for chat streaming");

    // Stream the response in OpenRouter-compatible SSE format
    for await (const token of stream) {
      const chunk = {
        choices: [{ delta: { content: token } }],
      };
      await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    }

    await writer.write(encoder.encode(`data: [DONE]\n\n`));
    return true;
  } catch (error) {
    console.error("[Chat API] Azure streaming error:", error);
    return false;
  }
}

/**
 * Stream chat response using OpenRouter.
 * Returns true if successful.
 */
async function streamWithOpenRouter(
  apiMessages: Array<{ role: string; content: string }>,
  apiKey: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder
): Promise<boolean> {
  try {
    console.log("[Chat API] Using OpenRouter for chat streaming");

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
      return false;
    }

    // Stream the response
    const reader = response.body?.getReader();
    if (!reader) {
      console.error("[Chat API] No response body from OpenRouter");
      return false;
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Forward the chunk directly (it's already in SSE format)
      await writer.write(encoder.encode(chunk));
    }

    return true;
  } catch (error) {
    console.error("[Chat API] OpenRouter streaming error:", error);
    return false;
  }
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

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    const azureEnabled = isAzureAIEnabled();

    // Check if at least one AI provider is configured
    if (!azureEnabled && !openRouterApiKey) {
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
          const result = await extractDateRange(latestUserMessage, openRouterApiKey);
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

        // Build messages for AI API
        const apiMessages = [
          { role: "system" as const, content: systemPrompt },
          ...messages.map((msg) => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })),
        ];

        // Step 4: Get main AI response (streaming)
        // Try Azure first, then fall back to OpenRouter
        let streamSuccess = false;

        if (azureEnabled) {
          streamSuccess = await streamWithAzure(apiMessages, writer, encoder);
        }

        if (!streamSuccess && openRouterApiKey) {
          if (azureEnabled) {
            console.warn("[Chat API] Azure streaming failed, falling back to OpenRouter");
          }
          streamSuccess = await streamWithOpenRouter(
            apiMessages,
            openRouterApiKey,
            writer,
            encoder
          );
        }

        if (!streamSuccess) {
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", data: "Failed to get response from AI" })}\n\n`
            )
          );
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
