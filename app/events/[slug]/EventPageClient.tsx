"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Calendar,
  CalendarPlus2,
  MapPin,
  Clock,
  User,
  Tag,
  ExternalLink,
  ArrowLeft,
  Heart,
  Share2,
  ChevronDown,
  Check,
  Copy,
} from "lucide-react";
import { cleanMarkdown } from "@/lib/utils/cleanMarkdown";
import { generateCalendarUrlForEvent } from "@/lib/utils/googleCalendar";
import { downloadEventAsICS } from "@/lib/utils/icsGenerator";

interface EventPageClientProps {
  event: {
    id: string;
    title: string;
    description: string | null;
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

export default function EventPageClient({ event, eventPageUrl }: EventPageClientProps) {
  const [imgError, setImgError] = useState(false);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [isFavorited, setIsFavorited] = useState(() => getInitialFavorited(event.id));
  const [favoriteCount, setFavoriteCount] = useState(event.favoriteCount);
  const [copied, setCopied] = useState(false);
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  const startDate = new Date(event.startDate);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calendarMenuRef.current && !calendarMenuRef.current.contains(e.target as Node)) {
        setCalendarMenuOpen(false);
      }
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareMenuOpen(false);
      }
    }

    if (calendarMenuOpen || shareMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [calendarMenuOpen, shareMenuOpen]);

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
    setCalendarMenuOpen(false);
  };

  const handleToggleFavorite = async () => {
    // Optimistic update
    const newIsFavorited = !isFavorited;
    setIsFavorited(newIsFavorited);
    setFavoriteCount((prev) => (newIsFavorited ? prev + 1 : Math.max(0, prev - 1)));

    // Update localStorage
    const savedFavorites = localStorage.getItem("favoritedEventIds");
    const favorites: string[] = savedFavorites ? JSON.parse(savedFavorites) : [];
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
    } catch {
      // Revert on error
      setIsFavorited(!newIsFavorited);
      setFavoriteCount((prev) => (!newIsFavorited ? prev + 1 : Math.max(0, prev - 1)));
    }
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(eventPageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShareMenuOpen(false);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: event.title,
          text: `Check out ${event.title} in Asheville!`,
          url: eventPageUrl,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      setShareMenuOpen(true);
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

  const { date: dateStr, time: timeStr } = formatDate(startDate, event.timeUnknown);
  const cleanedDescription = cleanMarkdown(event.description) || "No description available.";
  const displayPrice = formatPriceDisplay(event.price);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to all events
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Image */}
        <div className="relative w-full h-64 sm:h-80 lg:h-96 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden mb-6">
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
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            {event.title}
          </h1>

          {/* Quick Info Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {/* Date & Time */}
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-brand-600 dark:text-brand-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">{dateStr}</div>
                <div className="text-gray-600 dark:text-gray-400">{timeStr}</div>
              </div>
            </div>

            {/* Location */}
            {event.location && (
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-brand-600 dark:text-brand-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {event.location}
                  </div>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    View on map
                  </a>
                </div>
              </div>
            )}

            {/* Organizer */}
            {event.organizer && (
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-brand-600 dark:text-brand-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-gray-600 dark:text-gray-400">Hosted by</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {event.organizer}
                  </div>
                </div>
              </div>
            )}

            {/* Price */}
            <div className="flex items-start gap-3">
              <Tag className="w-5 h-5 text-brand-600 dark:text-brand-400 mt-0.5 shrink-0" />
              <div>
                <div className="text-gray-600 dark:text-gray-400">Price</div>
                <div
                  className={`font-medium ${
                    displayPrice === "Free"
                      ? "text-green-600 dark:text-green-400"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {displayPrice}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 mb-8 pb-8 border-b border-gray-200 dark:border-gray-700">
          {/* Add to Calendar */}
          <div className="relative" ref={calendarMenuRef}>
            <button
              onClick={() => setCalendarMenuOpen(!calendarMenuOpen)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-medium transition-colors cursor-pointer"
            >
              <CalendarPlus2 size={18} />
              Add to Calendar
              <ChevronDown
                size={16}
                className={`transition-transform ${calendarMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {calendarMenuOpen && (
              <div className="absolute left-0 top-full mt-2 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[180px]">
                <button
                  onClick={handleAddToGoogleCalendar}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded-t-lg"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/google_cal.svg" alt="Google Calendar" className="w-4 h-4" />
                  Google Calendar
                </button>
                <button
                  onClick={handleAddToAppleCalendar}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded-b-lg"
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
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium border transition-colors cursor-pointer ${
              isFavorited
                ? "bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800"
            }`}
          >
            <Heart size={18} className={isFavorited ? "fill-current" : ""} />
            {favoriteCount > 0 ? favoriteCount : "Favorite"}
          </button>

          {/* Share */}
          <div className="relative" ref={shareMenuRef}>
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            >
              <Share2 size={18} />
              Share
            </button>

            {shareMenuOpen && (
              <div className="absolute left-0 top-full mt-2 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[180px]">
                <button
                  onClick={handleCopyLink}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded-lg"
                >
                  {copied ? (
                    <>
                      <Check size={16} className="text-green-600" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      Copy link
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* View Source */}
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <ExternalLink size={18} />
            View on {event.source === "EVENTBRITE" ? "Eventbrite" : event.source === "MEETUP" ? "Meetup" : "Source"}
          </a>
        </div>

        {/* Description */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            About this event
          </h2>
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {cleanedDescription}
            </p>
          </div>
        </section>

        {/* Tags */}
        {event.tags && event.tags.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Tags</h2>
            <div className="flex flex-wrap gap-2">
              {event.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Back Link */}
        <div className="pt-8 border-t border-gray-200 dark:border-gray-700">
          <Link
            href="/"
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
          &copy; {new Date().getFullYear()} Asheville Event Feed. Not affiliated with AVL Today,
          Eventbrite, Facebook Events, or Meetup.
        </p>
      </footer>
    </main>
  );
}
