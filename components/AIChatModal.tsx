"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Sparkles, Loader2, StopCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { DateFilterType, PriceFilterType } from "./FilterBar";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Event {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  location?: string | null;
  organizer?: string | null;
  price?: string | null;
  url: string;
  tags?: string[] | null;
}

interface ActiveFilters {
  search: string;
  dateFilter: DateFilterType;
  priceFilter: PriceFilterType;
  tagsInclude: string[];
  tagsExclude: string[];
  selectedLocations: string[];
}

interface AIChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  filteredEvents: Event[];
  activeFilters: ActiveFilters;
}

function formatEventsForAI(events: Event[]): string {
  return events.map((event) => {
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
  }).join("\n---\n");
}

function formatActiveFilters(filters: ActiveFilters): string {
  const lines: string[] = [];

  if (filters.search) {
    lines.push(`Search: "${filters.search}"`);
  }
  if (filters.dateFilter !== "all") {
    const dateLabels: Record<DateFilterType, string> = {
      all: "All Dates",
      today: "Today",
      tomorrow: "Tomorrow",
      weekend: "This Weekend",
      dayOfWeek: "Day of Week",
      custom: "Custom Dates",
    };
    lines.push(`Date: ${dateLabels[filters.dateFilter]}`);
  }
  if (filters.priceFilter !== "any") {
    const priceLabels: Record<PriceFilterType, string> = {
      any: "Any Price",
      free: "Free",
      under20: "Under $20",
      under100: "Under $100",
      custom: "Custom",
    };
    lines.push(`Price: ${priceLabels[filters.priceFilter]}`);
  }
  if (filters.tagsInclude.length > 0) {
    lines.push(`Tags (include): ${filters.tagsInclude.join(", ")}`);
  }
  if (filters.tagsExclude.length > 0) {
    lines.push(`Tags (exclude): ${filters.tagsExclude.join(", ")}`);
  }
  if (filters.selectedLocations.length > 0) {
    lines.push(`Locations: ${filters.selectedLocations.join(", ")}`);
  }

  return lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : "";
}

const SUGGESTIONS = [
  "Find me live music tonight",
  "What's good for a date night?",
  "Family-friendly events this weekend",
];

const LOADING_MESSAGES = [
  "Reading request...",
  "Reviewing events...",
  "Thinking...",
];

function getInitialMessage(eventCount: number, filters: ActiveFilters): string {
  const filterText = formatActiveFilters(filters);

  if (eventCount === 0) {
    return `No events match your current filters. Try adjusting your filters, or tell me what you're looking for and I can suggest which filters to change.`;
  }

  let message = `I can help you find events from the ${eventCount} events currently shown.`;

  if (filterText) {
    message += `\n\nYour active filters:\n\n${filterText}`;
  } else {
    message += `\n\n*No filters applied - showing all events.*`;
  }

  message += `\n\nWhat kind of event are you looking for?`;

  return message;
}

export default function AIChatModal({
  isOpen,
  onClose,
  filteredEvents,
  activeFilters,
}: AIChatModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cycle through loading messages every 3 seconds
  useEffect(() => {
    if (!isLoading || isStreaming) {
      setLoadingMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingMessageIndex((prev) =>
        prev < LOADING_MESSAGES.length - 1 ? prev + 1 : prev
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [isLoading, isStreaming]);

  // Initialize with greeting when modal opens
  useEffect(() => {
    if (isOpen) {
      const initialMessage = getInitialMessage(
        filteredEvents.length,
        activeFilters
      );
      setMessages([{ role: "assistant", content: initialMessage }]);
      setInput("");
      setError(null);
      setIsStreaming(false);
      // Focus input after a short delay to ensure modal is rendered
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Cancel any ongoing stream when modal closes
      abortControllerRef.current?.abort();
    }
  }, [isOpen, filteredEvents.length, activeFilters]);

  // Only auto-scroll when user sends a new message (not during streaming)
  const shouldScrollRef = useRef(false);
  useEffect(() => {
    if (shouldScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      shouldScrollRef.current = false;
    }
  }, [messages.length]); // Only trigger on message count change, not content updates

  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setIsLoading(false);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setIsStreaming(false);
    setError(null);
    shouldScrollRef.current = true; // Scroll to show user's message

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      const eventsMarkdown = formatEventsForAI(filteredEvents);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.slice(1).concat(userMessage), // Skip initial greeting
          events: eventsMarkdown,
          filters: {
            search: activeFilters.search || undefined,
            dateFilter: activeFilters.dateFilter,
            priceFilter: activeFilters.priceFilter,
            tagsInclude: activeFilters.tagsInclude,
            tagsExclude: activeFilters.tagsExclude,
            locations: activeFilters.selectedLocations,
          },
          eventCount: filteredEvents.length,
        }),
        signal: abortControllerRef.current.signal,
      });

      // Check for non-streaming error responses
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        throw new Error(data.error || "Failed to get response");
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No response body");

      let assistantContent = "";
      let hasStartedStreaming = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          // Skip empty lines and SSE comments
          if (!line.trim() || line.startsWith(":")) continue;

          if (line.startsWith("data: ")) {
            const data = line.slice(6); // Remove "data: " prefix

            // Check for stream end
            if (data === "[DONE]") {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content || "";
              if (token) {
                // Only switch to streaming mode when we get the first real token
                if (!hasStartedStreaming) {
                  hasStartedStreaming = true;
                  setIsStreaming(true);
                  setIsLoading(false);
                  // Add assistant message with the first token
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: token },
                  ]);
                  assistantContent = token;
                } else {
                  assistantContent += token;
                  // Update the last message (assistant) with new content
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantContent,
                    };
                    return updated;
                  });
                }
              }
            } catch {
              // Skip malformed JSON lines (SSE comments, etc.)
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Stream was cancelled by user - don't show error
        console.log("Stream cancelled");
        return;
      }

      const errorMessage =
        err instanceof Error ? err.message : "Something went wrong";
      setError(errorMessage);
      // Add error message to chat
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I encountered an error: ${errorMessage}. Please try again.`,
        },
      ]);
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  }, [input, isLoading, messages, filteredEvents, activeFilters]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Handle clicking a suggestion button
  const handleSuggestionClick = useCallback(
    async (suggestion: string) => {
      if (isLoading) return;

      const userMessage: ChatMessage = { role: "user", content: suggestion };
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setInput("");
      setIsLoading(true);
      setIsStreaming(false);
      setError(null);
      shouldScrollRef.current = true;

      abortControllerRef.current = new AbortController();

      try {
        const eventsMarkdown = formatEventsForAI(filteredEvents);

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messages.slice(1).concat(userMessage),
            events: eventsMarkdown,
            filters: {
              search: activeFilters.search || undefined,
              dateFilter: activeFilters.dateFilter,
              priceFilter: activeFilters.priceFilter,
              tagsInclude: activeFilters.tagsInclude,
              tagsExclude: activeFilters.tagsExclude,
              locations: activeFilters.selectedLocations,
            },
            eventCount: filteredEvents.length,
          }),
          signal: abortControllerRef.current.signal,
        });

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          throw new Error(data.error || "Failed to get response");
        }

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) throw new Error("No response body");

        let assistantContent = "";
        let hasStartedStreaming = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.trim() || line.startsWith(":")) continue;

            if (line.startsWith("data: ")) {
              const data = line.slice(6);

              if (data === "[DONE]") {
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const token = parsed.choices?.[0]?.delta?.content || "";
                if (token) {
                  if (!hasStartedStreaming) {
                    hasStartedStreaming = true;
                    setIsStreaming(true);
                    setIsLoading(false);
                    setMessages((prev) => [
                      ...prev,
                      { role: "assistant", content: token },
                    ]);
                    assistantContent = token;
                  } else {
                    assistantContent += token;
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        role: "assistant",
                        content: assistantContent,
                      };
                      return updated;
                    });
                  }
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          console.log("Stream cancelled");
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : "Something went wrong";
        setError(errorMessage);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Sorry, I encountered an error: ${errorMessage}. Please try again.`,
          },
        ]);
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
      }
    },
    [isLoading, messages, filteredEvents, activeFilters]
  );

  // Check if we should show suggestions (only when just the initial message exists)
  const showSuggestions = messages.length === 1 && !isLoading && !isStreaming;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl h-[80vh] max-h-[600px] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="text-brand-600" size={20} />
            <h2 className="text-lg font-semibold text-gray-900">
              Ask AI about events
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X size={24} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  message.role === "user"
                    ? "bg-brand-600 text-white"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {message.role === "user" ? (
                  <div className="whitespace-pre-wrap text-sm">
                    {message.content}
                  </div>
                ) : (
                  <div className="text-sm prose prose-sm max-w-none prose-headings:text-gray-900 prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-hr:my-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkBreaks]}
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-600 hover:text-brand-800 no-underline hover:underline"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && !isStreaming && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="animate-spin" size={16} />
                  <span className="text-sm">{LOADING_MESSAGES[loadingMessageIndex]}</span>
                </div>
              </div>
            </div>
          )}

          {error && !isLoading && !isStreaming && (
            <div className="flex justify-center">
              <button
                onClick={sendMessage}
                className="text-sm text-brand-600 hover:text-brand-800 underline cursor-pointer"
              >
                Try again
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-200">
          {/* Suggestion buttons */}
          {showSuggestions && (
            <div className="flex flex-wrap gap-2 mb-3">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors cursor-pointer"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about events..."
              disabled={isLoading || isStreaming}
              className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
            {isStreaming ? (
              <button
                onClick={cancelStream}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors cursor-pointer"
                title="Stop generating"
              >
                <StopCircle size={18} />
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Send size={18} />
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            AI can see all {filteredEvents.length} filtered events
          </p>
        </div>
      </div>
    </div>
  );
}
