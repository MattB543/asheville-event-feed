"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Calendar,
  CalendarPlus2,
  MapPin,
  Clock,
  User,
  Tag,
  DollarSign,
  ExternalLink,
  ArrowLeft,
  Heart,
  ChevronDown,
  Share,
} from "lucide-react";
import { cleanAshevilleFromSummary, cleanMarkdown } from "@/lib/utils/parsers";
import { formatTagForDisplay } from "@/lib/utils/formatTag";
import { generateCalendarUrlForEvent } from "@/lib/utils/googleCalendar";
import { downloadEventAsICS } from "@/lib/utils/icsGenerator";
import EventCard from "@/components/EventCard";
import { ToastProvider } from "@/components/ui/Toast";
import { useAuth } from "@/components/AuthProvider";

interface SimilarEvent {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description: string | null;
  aiSummary: string | null;
  startDate: string;
  location: string | null;
  organizer: string | null;
  price: string | null;
  url: string;
  imageUrl: string | null;
  tags: string[] | null;
  timeUnknown: boolean;
  recurringType: string | null;
  favoriteCount: number;
  similarity: number;
}

interface EventPageClientProps {
  event: {
    id: string;
    sourceId: string;
    title: string;
    description: string | null;
    aiSummary: string | null;
    startDate: string;
    location: string | null;
    organizer: string | null;
    price: string | null;
    imageUrl: string | null;
    url: string;
    tags: string[] | null;
    source: string;
    timeUnknown: boolean;
    favoriteCount: number;
  };
  eventPageUrl: string;
  similarEvents?: SimilarEvent[];
}

// Helper to get initial favorite state from localStorage
function getInitialFavorited(eventId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const savedFavorites = localStorage.getItem("favoritedEventIds");
    if (savedFavorites) {
      const favorites = JSON.parse(savedFavorites);
      return favorites.includes(eventId);
    }
  } catch {
    // Ignore localStorage errors
  }
  return false;
}

export default function EventPageClient({
  event,
  eventPageUrl,
  similarEvents = [],
}: EventPageClientProps) {
  const { user, isLoading: authLoading } = useAuth();
  const isLoggedIn = !!user;

  const [imgError, setImgError] = useState(false);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [isFavorited, setIsFavorited] = useState(() =>
    getInitialFavorited(event.id)
  );
  const [favoriteCount, setFavoriteCount] = useState(event.favoriteCount);
  const [copied, setCopied] = useState(false);
  const [isHeartAnimating, setIsHeartAnimating] = useState(false);
  const [mobileExpandedIds, setMobileExpandedIds] = useState<Set<string>>(new Set());
  const calendarMenuRef = useRef<HTMLDivElement>(null);

  // Helper to capture signals for personalization
  const captureSignal = useCallback(
    async (eventId: string, signalType: 'favorite' | 'calendar' | 'share' | 'viewSource') => {
      console.log("[Signal:EventPage] captureSignal called:", { eventId, signalType, isLoggedIn, authLoading });

      if (authLoading) {
        console.log("[Signal:EventPage] Auth still loading, waiting...");
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (!isLoggedIn) {
        console.log("[Signal:EventPage] Skipped - user not logged in");
        return;
      }

      console.log("[Signal:EventPage] Making API call...");
      try {
        const response = await fetch("/api/signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, signalType }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error("[Signal:EventPage] API error:", response.status, errorData);
          return;
        }

        console.log("[Signal:EventPage] Captured successfully:", signalType, eventId);
      } catch (error) {
        console.error("[Signal:EventPage] Network error:", error);
      }
    },
    [isLoggedIn, authLoading]
  );

  // Similar events favorites state
  const [similarFavorites, setSimilarFavorites] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem("favoritedEventIds");
      return new Set(saved ? JSON.parse(saved) : []);
    } catch {
      return new Set();
    }
  });
  const [similarFavoriteCounts, setSimilarFavoriteCounts] = useState<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    similarEvents.forEach((e) => {
      counts[e.id] = e.favoriteCount;
    });
    return counts;
  });

  // Similar events sorting state
  const [similarSortBy, setSimilarSortBy] = useState<'similarity' | 'date'>('similarity');

  // Type for deduplicated similar event with recurring info
  type DedupedSimilarEvent = SimilarEvent & {
    isRecurring: boolean;
    recurringCount: number;
  };

  // Deduplicate recurring events (same title + description = recurring)
  // Group by title+description, keep earliest date, mark as recurring
  const dedupedSimilarEvents = useMemo(() => {
    const groups = new Map<string, SimilarEvent[]>();

    for (const event of similarEvents) {
      // Create a key from title + description (normalize nulls)
      const key = `${event.title}|||${event.description || ''}`;
      const existing = groups.get(key);
      if (existing) {
        existing.push(event);
      } else {
        groups.set(key, [event]);
      }
    }

    // For each group, pick the earliest future date and mark as recurring if multiple
    const deduped: DedupedSimilarEvent[] = [];
    for (const [, events] of groups) {
      // Sort by date to get earliest
      const sorted = [...events].sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );
      const earliest = sorted[0];
      deduped.push({
        ...earliest,
        isRecurring: events.length > 1,
        recurringCount: events.length,
      });
    }

    // Sort by similarity (server order preserved for most similar)
    // Re-sort by original similarity score
    return deduped.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
  }, [similarEvents]);

  // Sort deduped events based on selected sort option
  const sortedSimilarEvents = useMemo(() => {
    if (similarSortBy === 'date') {
      return [...dedupedSimilarEvents].sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );
    }
    // Already sorted by similarity
    return dedupedSimilarEvents;
  }, [dedupedSimilarEvents, similarSortBy]);

  // Group similar events by date (only when sorted by date)
  const groupedSimilarEvents = useMemo(() => {
    if (similarSortBy !== 'date') return null;

    return Object.entries(
      sortedSimilarEvents.reduce((groups, event) => {
        const date = new Date(event.startDate);
        const dateKey = date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        if (!groups[dateKey]) groups[dateKey] = { date, events: [] as DedupedSimilarEvent[] };
        groups[dateKey].events.push(event);
        return groups;
      }, {} as Record<string, { date: Date; events: DedupedSimilarEvent[] }>)
    ).sort(([, a], [, b]) => a.date.getTime() - b.date.getTime());
  }, [sortedSimilarEvents, similarSortBy]);

  // Format date header with Today/Tomorrow support
  const formatDateHeader = (date: Date): string => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return `Today, ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow, ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const startDate = new Date(event.startDate);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        calendarMenuRef.current &&
        !calendarMenuRef.current.contains(e.target as Node)
      ) {
        setCalendarMenuOpen(false);
      }
    }

    if (calendarMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [calendarMenuOpen]);

  const handleAddToGoogleCalendar = () => {
    window.open(
      generateCalendarUrlForEvent({
        title: event.title,
        startDate,
        description: event.description,
        location: event.location,
      }),
      "_blank"
    );
    captureSignal(event.id, "calendar");
    setCalendarMenuOpen(false);
  };

  const handleAddToAppleCalendar = () => {
    downloadEventAsICS({
      title: event.title,
      startDate,
      description: event.description,
      location: event.location,
      url: event.url,
    });
    captureSignal(event.id, "calendar");
    setCalendarMenuOpen(false);
  };

  const handleToggleFavorite = async () => {
    // Trigger animation
    setIsHeartAnimating(true);
    setTimeout(() => setIsHeartAnimating(false), 300);

    // Optimistic update
    const newIsFavorited = !isFavorited;
    setIsFavorited(newIsFavorited);
    setFavoriteCount((prev) =>
      newIsFavorited ? prev + 1 : Math.max(0, prev - 1)
    );

    console.log("[Favorite:EventPage] Toggle:", event.id, "action:", newIsFavorited ? "add" : "remove");

    // Update localStorage
    const savedFavorites = localStorage.getItem("favoritedEventIds");
    const favorites: string[] = savedFavorites
      ? JSON.parse(savedFavorites)
      : [];
    if (newIsFavorited) {
      favorites.push(event.id);
    } else {
      const index = favorites.indexOf(event.id);
      if (index > -1) favorites.splice(index, 1);
    }
    localStorage.setItem("favoritedEventIds", JSON.stringify(favorites));

    // Update server
    try {
      await fetch(`/api/events/${event.id}/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: newIsFavorited ? "add" : "remove" }),
      });

      // Capture signal for personalization (only when adding)
      if (newIsFavorited) {
        await captureSignal(event.id, "favorite");
      }
    } catch {
      // Revert on error
      setIsFavorited(!newIsFavorited);
      setFavoriteCount((prev) =>
        !newIsFavorited ? prev + 1 : Math.max(0, prev - 1)
      );
    }
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(eventPageUrl);
    captureSignal(event.id, "share");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handler for capturing signals from similar event cards (calendar, share, viewSource)
  const handleSimilarEventSignal = useCallback(
    (eventId: string, signalType: 'calendar' | 'share' | 'viewSource') => {
      captureSignal(eventId, signalType);
    },
    [captureSignal]
  );

  // Handler for toggling favorites on similar events
  const handleToggleSimilarFavorite = async (eventId: string) => {
    const newIsFavorited = !similarFavorites.has(eventId);

    console.log("[Favorite:SimilarEvent] Toggle:", eventId, "action:", newIsFavorited ? "add" : "remove");

    // Optimistic update
    setSimilarFavorites((prev) => {
      const next = new Set(prev);
      if (newIsFavorited) {
        next.add(eventId);
      } else {
        next.delete(eventId);
      }
      return next;
    });
    setSimilarFavoriteCounts((prev) => ({
      ...prev,
      [eventId]: newIsFavorited ? (prev[eventId] || 0) + 1 : Math.max(0, (prev[eventId] || 0) - 1),
    }));

    // Update localStorage
    const savedFavorites = localStorage.getItem("favoritedEventIds");
    const favorites: string[] = savedFavorites ? JSON.parse(savedFavorites) : [];
    if (newIsFavorited) {
      favorites.push(eventId);
    } else {
      const index = favorites.indexOf(eventId);
      if (index > -1) favorites.splice(index, 1);
    }
    localStorage.setItem("favoritedEventIds", JSON.stringify(favorites));

    // Update server
    try {
      await fetch(`/api/events/${eventId}/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: newIsFavorited ? "add" : "remove" }),
      });

      // Capture signal for personalization (only when adding)
      if (newIsFavorited) {
        await captureSignal(eventId, "favorite");
      }
    } catch {
      // Revert on error
      setSimilarFavorites((prev) => {
        const next = new Set(prev);
        if (!newIsFavorited) {
          next.add(eventId);
        } else {
          next.delete(eventId);
        }
        return next;
      });
      setSimilarFavoriteCounts((prev) => ({
        ...prev,
        [eventId]: !newIsFavorited ? (prev[eventId] || 0) + 1 : Math.max(0, (prev[eventId] || 0) - 1),
      }));
    }
  };

  const formatDate = (date: Date, timeUnknown: boolean) => {
    const dateStr = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);

    if (timeUnknown) {
      return { date: dateStr, time: "Time TBD" };
    }

    const timeStr = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);

    return { date: dateStr, time: timeStr };
  };

  const formatPriceDisplay = (price: string | null): string => {
    if (!price || price === "Unknown") return "Price TBD";
    if (price.toLowerCase() === "free") return "Free";
    const match = price.match(/\$?([\d.]+)/);
    if (match) {
      const rounded = Math.round(parseFloat(match[1]));
      return `$${rounded}`;
    }
    return price;
  };

  // Build the source URL (same logic as EventCard)
  const getSourceUrl = () => {
    if (event.source === "AVL_TODAY") {
      const slug = event.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

      // Format date as YYYY-MM-DDTHH in local time (assuming ET for AVL)
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(startDate);
      const getPart = (type: string) =>
        parts.find((p) => p.type === type)?.value;
      const dateStr = `${getPart("year")}-${getPart("month")}-${getPart(
        "day"
      )}T${getPart("hour")}`;

      return `https://avltoday.6amcity.com/events#/details/${slug}/${event.sourceId}/${dateStr}`;
    }
    return event.url;
  };

  const { date: dateStr, time: timeStr } = formatDate(
    startDate,
    event.timeUnknown
  );

  // AI Summary vs Original Description logic
  const [showOriginalDescription, setShowOriginalDescription] = useState(false);
  const hasAiSummary = !!event.aiSummary;
  const cleanedAiSummary = event.aiSummary
    ? cleanAshevilleFromSummary(cleanMarkdown(event.aiSummary))
    : null;
  const cleanedDescription =
    cleanMarkdown(event.description) || "No description available.";
  const displayDescription = showOriginalDescription
    ? cleanedDescription
    : (cleanedAiSummary || cleanedDescription);

  const displayPrice = formatPriceDisplay(event.price);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link
            href="/events"
            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to all Asheville events
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <article className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Hero Section - Image left, metadata right on tablet+ */}
        <div className="flex flex-col sm:flex-row gap-6 mb-6 px-4 sm:px-0">
          {/* Hero Image */}
          <div className="relative w-full sm:w-72 md:w-80 lg:w-96 xl:w-[420px] h-48 sm:h-48 md:h-56 lg:h-64 xl:h-72 shrink-0 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden">
            {!imgError && event.imageUrl ? (
              <Image
                src={event.imageUrl}
                alt={event.title}
                fill
                className="object-cover"
                onError={() => setImgError(true)}
                unoptimized={event.imageUrl.startsWith("data:")}
                priority
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                <Calendar size={64} />
              </div>
            )}
          </div>

          {/* Title & Meta */}
          <div className="flex-1 flex flex-col">
            <h1 className="text-2xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {event.title}
            </h1>

            {/* Quick Info - Single Column */}
            <div className="flex flex-col gap-3 text-sm mb-4">
              {/* Date & Time */}
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                <span className="text-gray-900 dark:text-gray-100">
                  {dateStr}, {timeStr}
                </span>
              </div>

              {/* Location */}
              {event.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      event.location
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-900 dark:text-gray-100 hover:text-brand-600 dark:hover:text-brand-400"
                  >
                    {event.location}
                  </a>
                </div>
              )}

              {/* Organizer */}
              {event.organizer && (
                <div className="flex items-center gap-3">
                  <User className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                  <span className="text-gray-900 dark:text-gray-100">
                    {event.organizer}
                  </span>
                </div>
              )}

              {/* Price */}
              <div className="flex items-center gap-3">
                <DollarSign className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
                <span
                  className={
                    displayPrice === "Free"
                      ? "text-green-600 dark:text-green-400 font-medium"
                      : "text-gray-900 dark:text-gray-100"
                  }
                >
                  {displayPrice}
                </span>
              </div>

              {/* Tags */}
              {event.tags && event.tags.length > 0 && (
                <div className="flex items-start gap-3">
                  <Tag className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1.5">
                    {event.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800"
                      >
                        {formatTagForDisplay(tag)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons - moved into metadata column */}
            <div className="flex flex-wrap gap-2 mt-auto">
          {/* Add to Calendar */}
          <div className="relative" ref={calendarMenuRef}>
            <button
              onClick={() => setCalendarMenuOpen(!calendarMenuOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-lg font-medium transition-colors cursor-pointer"
            >
              <CalendarPlus2 size={15} />
              Calendar
              <ChevronDown
                size={13}
                className={`transition-transform ${
                  calendarMenuOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {calendarMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[160px]">
                <button
                  onClick={handleAddToGoogleCalendar}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded-t-lg"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/google_cal.svg"
                    alt="Google Calendar"
                    className="w-3.5 h-3.5"
                  />
                  Google Calendar
                </button>
                <button
                  onClick={handleAddToAppleCalendar}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded-b-lg"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                  </svg>
                  Apple Calendar
                </button>
              </div>
            )}
          </div>

          {/* Favorite */}
          <button
            onClick={handleToggleFavorite}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer ${
              isFavorited
                ? "bg-red-50 dark:bg-red-950/50 text-red-500 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800"
            }`}
            title={isFavorited ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart
              size={15}
              className={`transition-transform ${
                isFavorited ? "fill-current" : ""
              } ${isHeartAnimating ? "animate-heart-pop" : ""}`}
            />
            {favoriteCount > 0 && <span>{favoriteCount}</span>}
          </button>

          {/* Share */}
          <div className="relative">
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center justify-center px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer h-[34px]"
              title="Copy link"
            >
              <Share size={15} />
            </button>
            {/* Copied tooltip */}
            {copied && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs font-medium text-white bg-gray-800 dark:bg-gray-700 rounded shadow-lg whitespace-nowrap animate-fade-in">
                Copied!
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800 dark:border-t-gray-700" />
              </div>
            )}
          </div>

          {/* View Source */}
          <a
            href={getSourceUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <ExternalLink size={15} />
            View on{" "}
            {event.source === "AVL_TODAY"
              ? "AVL Today"
              : event.source === "EVENTBRITE"
              ? "Eventbrite"
              : event.source === "MEETUP"
              ? "Meetup"
              : "Source"}
          </a>
            </div>
          </div>
        </div>

        {/* Description */}
        <section className="mb-8 px-4 sm:px-0">
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {displayDescription}
              {hasAiSummary && (
                <button
                  onClick={() => setShowOriginalDescription(!showOriginalDescription)}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium ml-2 cursor-pointer"
                >
                  {showOriginalDescription ? "View less" : "View original"}
                </button>
              )}
            </p>
          </div>
        </section>

        {/* Similar Events */}
        {similarEvents.length > 0 && (
          <section className="mb-8 pt-6 border-t-2 border-gray-300 dark:border-gray-600">
            <div className="flex items-center justify-between mb-4 px-4 sm:px-0 sticky top-0 bg-gray-50 dark:bg-gray-950 py-3 z-20 sm:rounded-lg">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Similar Events
              </h2>
              <div className="flex items-center gap-3">
                <Link
                  href="/events"
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors hidden sm:flex items-center gap-1"
                >
                  <ArrowLeft size={14} />
                  Back to main list
                </Link>
                {/* Sort toggle buttons */}
                <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                  <button
                    onClick={() => setSimilarSortBy('similarity')}
                    className={`px-3 py-1 transition-colors cursor-pointer ${
                      similarSortBy === 'similarity'
                        ? 'bg-brand-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    Most Similar
                  </button>
                  <button
                    onClick={() => setSimilarSortBy('date')}
                    className={`px-3 py-1 transition-colors cursor-pointer ${
                      similarSortBy === 'date'
                        ? 'bg-brand-600 text-white'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    By Date
                  </button>
                </div>
              </div>
            </div>
            <ToastProvider>
              <div className="bg-white dark:bg-gray-900 sm:rounded-lg sm:shadow-sm sm:border sm:border-gray-200 dark:sm:border-gray-700">
                {similarSortBy === 'date' && groupedSimilarEvents ? (
                  // Grouped by date with headers
                  groupedSimilarEvents.map(([dateKey, { date, events: groupEvents }], groupIndex) => (
                    <div key={dateKey} className="flex flex-col">
                      <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 sticky top-[52px] bg-white dark:bg-gray-900 py-2 px-3 sm:px-4 z-10 border-b border-gray-200 dark:border-gray-700">
                        {formatDateHeader(date)}
                      </h3>
                      <div>
                        {groupEvents.map((similarEvent, index) => (
                          <EventCard
                            key={similarEvent.id}
                            event={{
                              id: similarEvent.id,
                              sourceId: similarEvent.sourceId,
                              source: similarEvent.source,
                              title: similarEvent.title,
                              description: similarEvent.description,
                              aiSummary: similarEvent.aiSummary,
                              startDate: new Date(similarEvent.startDate),
                              location: similarEvent.location,
                              organizer: similarEvent.organizer,
                              price: similarEvent.price,
                              imageUrl: similarEvent.imageUrl,
                              url: similarEvent.url,
                              tags: similarEvent.tags,
                              timeUnknown: similarEvent.timeUnknown,
                              recurringType: similarEvent.recurringType,
                            }}
                            onHide={() => {}}
                            onBlockHost={() => {}}
                            isFavorited={similarFavorites.has(similarEvent.id)}
                            favoriteCount={similarFavoriteCounts[similarEvent.id] || 0}
                            onToggleFavorite={handleToggleSimilarFavorite}
                            onSignalCapture={handleSimilarEventSignal}
                            hideBorder={
                              groupIndex === groupedSimilarEvents.length - 1 &&
                              index === groupEvents.length - 1
                            }
                            showRecurringBadge={similarEvent.isRecurring}
                            isMobileExpanded={mobileExpandedIds.has(similarEvent.id)}
                            onMobileExpand={(id) => setMobileExpandedIds((prev) => new Set([...prev, id]))}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  // Flat list sorted by similarity (default)
                  sortedSimilarEvents.map((similarEvent, index) => (
                    <EventCard
                      key={similarEvent.id}
                      event={{
                        id: similarEvent.id,
                        sourceId: similarEvent.sourceId,
                        source: similarEvent.source,
                        title: similarEvent.title,
                        description: similarEvent.description,
                        aiSummary: similarEvent.aiSummary,
                        startDate: new Date(similarEvent.startDate),
                        location: similarEvent.location,
                        organizer: similarEvent.organizer,
                        price: similarEvent.price,
                        imageUrl: similarEvent.imageUrl,
                        url: similarEvent.url,
                        tags: similarEvent.tags,
                        timeUnknown: similarEvent.timeUnknown,
                        recurringType: similarEvent.recurringType,
                      }}
                      onHide={() => {}}
                      onBlockHost={() => {}}
                      isFavorited={similarFavorites.has(similarEvent.id)}
                      favoriteCount={similarFavoriteCounts[similarEvent.id] || 0}
                      onToggleFavorite={handleToggleSimilarFavorite}
                      onSignalCapture={handleSimilarEventSignal}
                      hideBorder={index === sortedSimilarEvents.length - 1}
                      showRecurringBadge={similarEvent.isRecurring}
                      isMobileExpanded={mobileExpandedIds.has(similarEvent.id)}
                      onMobileExpand={(id) => setMobileExpandedIds((prev) => new Set([...prev, id]))}
                    />
                  ))
                )}
              </div>
            </ToastProvider>
          </section>
        )}

        {/* Back Link */}
        <div className="pt-8 border-t border-gray-200 dark:border-gray-700 px-4 sm:px-0">
          <Link
            href="/events"
            className="inline-flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
          >
            <ArrowLeft size={18} />
            Browse all Asheville events
          </Link>
        </div>
      </article>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="mb-2">
          Built by Matt Brooks at Brooks Solutions, LLC. Learn more at{" "}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            mattbrooks.xyz
          </a>
        </p>
        <p>
          &copy; {new Date().getFullYear()} Asheville Event Feed. Not affiliated
          with AVL Today, Eventbrite, Facebook Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
