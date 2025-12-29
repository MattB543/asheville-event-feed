"use client";

import {
  Calendar,
  CalendarPlus2,
  ExternalLink,
  EyeOff,
  Ban,
  ChevronDown,
  Heart,
  MoreVertical,
  AlertTriangle,
  ShieldAlert,
  Share,
  Sparkles,
  Bookmark,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { cleanMarkdown } from "@/lib/utils/parsers";
import { cleanAshevilleFromSummary } from "@/lib/utils/parsers";
import { generateCalendarUrlForEvent } from "@/lib/utils/googleCalendar";
import { downloadEventAsICS } from "@/lib/utils/icsGenerator";
import { useToast } from "@/components/ui/Toast";
import { generateEventSlug } from "@/lib/utils/slugify";
import { OFFICIAL_TAGS_SET } from "@/lib/config/tagCategories";

interface EventCardProps {
  event: {
    id: string;
    sourceId: string;
    source: string;
    title: string;
    description?: string | null;
    aiSummary?: string | null;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    price: string | null;
    imageUrl: string | null;
    url: string;
    tags?: string[] | null;
    timeUnknown?: boolean;
    recurringType?: string | null;
  };
  onHide: (title: string, organizer: string | null, eventId?: string) => void;
  onBlockHost: (host: string) => void;
  onSignalCapture?: (eventId: string, signalType: 'calendar' | 'share' | 'viewSource') => void;
  isNewlyHidden?: boolean;
  hideBorder?: boolean;
  isFavorited: boolean;
  favoriteCount: number;
  onToggleFavorite: (eventId: string) => void;
  isTagFilterActive?: boolean;
  /** Show a "Recurring" badge for similar events that appear multiple times */
  showRecurringBadge?: boolean;
  isCurated?: boolean;
  onCurate?: (eventId: string) => void;
  onUncurate?: (eventId: string) => void;
  isLoggedIn?: boolean;
  /** Display mode for the card: 'full' shows all content, 'minimized' shows only title + date */
  displayMode?: 'full' | 'minimized';
  /** Callback when user clicks "Expand" on a minimized card */
  onExpandMinimized?: (eventId: string) => void;
  /** Score tier for display mode */
  scoreTier?: 'hidden' | 'quality' | 'outstanding';
  /** Event score for gold title styling (16+ gets gold) */
  eventScore?: number | null;
  /** Match tier for personalized feed */
  matchTier?: 'great' | 'good' | null;
  /** Explanation for match (shows which event it's similar to) */
  matchExplanation?: {
    primary: { eventId: string; title: string } | null;
  };
  /** Whether this event is being hidden (for animation) */
  isHiding?: boolean;
}

// Round price string to nearest dollar (e.g., "$19.10" -> "$19", "$25.50" -> "$26")
const formatPriceDisplay = (price: string | null): string => {
  if (!price || price === "Unknown") return "$ ???";
  if (price.toLowerCase() === "free") return "Free";

  // Extract number from price string and round
  const match = price.match(/\$?([\d.]+)/);
  if (match) {
    const rounded = Math.round(parseFloat(match[1]));
    return `$${rounded}`;
  }
  return price;
};

export default function EventCard({
  event,
  onHide,
  onBlockHost,
  onSignalCapture,
  isNewlyHidden = false,
  hideBorder = false,
  isFavorited,
  favoriteCount,
  onToggleFavorite,
  isTagFilterActive = false,
  showRecurringBadge = false,
  isCurated = false,
  onCurate,
  onUncurate,
  isLoggedIn = false,
  displayMode = 'full',
  onExpandMinimized,
  scoreTier: _scoreTier = 'quality',
  eventScore,
  matchTier,
  matchExplanation,
  isHiding = false,
}: EventCardProps) {
  const [imgError, setImgError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [hideMenuOpen, setHideMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isHeartAnimating, setIsHeartAnimating] = useState(false);
  const [copied, setCopied] = useState(false);
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const hideMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  // Close dropdown menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        calendarMenuRef.current &&
        !calendarMenuRef.current.contains(event.target as Node)
      ) {
        setCalendarMenuOpen(false);
      }
      if (
        hideMenuRef.current &&
        !hideMenuRef.current.contains(event.target as Node)
      ) {
        setHideMenuOpen(false);
      }
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target as Node)
      ) {
        setMoreMenuOpen(false);
      }
    }

    if (calendarMenuOpen || hideMenuOpen || moreMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [calendarMenuOpen, hideMenuOpen, moreMenuOpen]);

  const handleAddToAppleCalendar = () => {
    downloadEventAsICS(event);
    onSignalCapture?.(event.id, 'calendar');
    setCalendarMenuOpen(false);
  };

  const handleAddToGoogleCalendar = () => {
    window.open(generateCalendarUrlForEvent(event), "_blank");
    onSignalCapture?.(event.id, 'calendar');
    setCalendarMenuOpen(false);
  };

  const handleHideEvent = () => {
    onHide(event.title, event.organizer, event.id);
    setHideMenuOpen(false);
  };

  const handleBlockHost = () => {
    if (event.organizer) {
      onBlockHost(event.organizer);
      setHideMenuOpen(false);
    }
  };

  const handleReport = (
    reportType: "incorrect_info" | "duplicate" | "spam"
  ) => {
    setMoreMenuOpen(false);
    showToast("Thanks for the feedback!");
    fetch("/api/events/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: event.id,
        eventTitle: event.title,
        eventUrl: getSourceUrl(),
        reportType,
      }),
    }).catch((error) => {
      console.error("Failed to submit report:", error);
    });
  };

  // Use AI summary if available, otherwise use original description
  const hasAiSummary = !!event.aiSummary;
  const cleanedAiSummary = event.aiSummary
    ? cleanAshevilleFromSummary(cleanMarkdown(event.aiSummary))
    : null;
  const cleanedDescription =
    cleanMarkdown(event.description) || "No description available.";

  // When collapsed: show AI summary (or truncated description if no AI summary)
  // When expanded: show full original description
  const displayText = isExpanded
    ? cleanedDescription
    : cleanedAiSummary || cleanedDescription;

  // Only need truncation if no AI summary and description is long
  const needsTruncationMobile =
    !hasAiSummary && cleanedDescription.length > 195;
  const needsTruncationTablet =
    !hasAiSummary && cleanedDescription.length > 295;
  const truncatedDescriptionMobile =
    needsTruncationMobile && !isExpanded
      ? cleanedDescription.slice(0, 195).trimEnd() + "..."
      : displayText;
  const truncatedDescriptionTablet =
    needsTruncationTablet && !isExpanded
      ? cleanedDescription.slice(0, 295).trimEnd() + "..."
      : displayText;

  // Show expand button if: has AI summary, or description needs truncation
  const showExpandButtonMobile = hasAiSummary || needsTruncationMobile;
  const showExpandButtonTablet = hasAiSummary || needsTruncationTablet;
  const expandButtonText = isExpanded
    ? "View less"
    : hasAiSummary
    ? "View original"
    : "View more";

  const formatDate = (date: Date, timeUnknown?: boolean) => {
    const eventDate = new Date(date);
    const today = new Date();

    // Check if the event is today
    const isToday =
      eventDate.getFullYear() === today.getFullYear() &&
      eventDate.getMonth() === today.getMonth() &&
      eventDate.getDate() === today.getDate();

    const dateOnly = isToday
      ? "Today"
      : new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(eventDate);

    if (timeUnknown) {
      return `${dateOnly}, ???`;
    }

    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(eventDate);

    return `${dateOnly}, ${time}`;
  };

  const getSourceUrl = () => {
    if (event.source === "AVL_TODAY") {
      const slug = event.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

      // Format date as YYYY-MM-DDTHH in local time (assuming ET for AVL)
      // We use the date string directly if we can, but we only have the Date object here.
      // We'll use Intl to extract the parts in the correct timezone.
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date(event.startDate));
      const getPart = (type: string) =>
        parts.find((p) => p.type === type)?.value;
      const dateStr = `${getPart("year")}-${getPart("month")}-${getPart(
        "day"
      )}T${getPart("hour")}`;

      return `https://avltoday.6amcity.com/events#/details/${slug}/${event.sourceId}/${dateStr}`;
    }
    if (event.source === "EVENTBRITE") return event.url;
    return event.url; // Fallback
  };

  const displayPrice = formatPriceDisplay(event.price);

  // Generate event URL for links
  const eventUrl = `/events/${generateEventSlug(event.title, event.startDate, event.id)}`;

  // Minimized display mode - single line: title - summary - tags - date badge
  // Clicking anywhere except the title expands the row
  if (displayMode === 'minimized') {
    // Get summary text (max 200 chars, will be truncated by CSS to fit one line)
    const summaryText = event.aiSummary
      ? cleanAshevilleFromSummary(cleanMarkdown(event.aiSummary)).slice(0, 200)
      : (event.description ? cleanMarkdown(event.description).slice(0, 200) : '');

    // Get first 3 official tags for minimized display
    const officialTags = event.tags?.filter((tag) => OFFICIAL_TAGS_SET.has(tag)) || [];
    const minimizedTags = officialTags.slice(0, 3);

    const handleRowClick = (e: React.MouseEvent) => {
      // Don't expand if clicking on the title link
      if ((e.target as HTMLElement).closest('a')) return;
      onExpandMinimized?.(event.id);
    };

    return (
      <div
        onClick={handleRowClick}
        className={`px-3 py-2.5 sm:px-5 cursor-pointer opacity-80 hover:opacity-100
          ${hideBorder ? "" : "border-b border-gray-200 dark:border-gray-700"}
          bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-opacity`}
      >
        {/* Mobile layout: stacked */}
        <div className="sm:hidden">
          {/* Title */}
          <Link
            href={eventUrl}
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline line-clamp-1"
            onClick={(e) => e.stopPropagation()}
          >
            {event.title}
          </Link>

          {/* Summary */}
          {summaryText && (
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
              {summaryText}
            </p>
          )}

          {/* Tags and Date badge */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {minimizedTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800"
              >
                {tag}
              </span>
            ))}
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
              {formatDate(event.startDate, event.timeUnknown)}
            </span>
          </div>
        </div>

        {/* Desktop layout: single row */}
        <div className="hidden sm:flex sm:items-center sm:gap-2">
          {/* Title */}
          <Link
            href={eventUrl}
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {event.title}
          </Link>

          {/* Separator */}
          {summaryText && (
            <span className="text-gray-400 dark:text-gray-500 shrink-0">-</span>
          )}

          {/* Summary (truncated to fit) */}
          {summaryText && (
            <span className="text-sm text-gray-500 dark:text-gray-400 truncate min-w-0">
              {summaryText}
            </span>
          )}

          {/* Tags - pushed to the right */}
          {minimizedTags.length > 0 && (
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {minimizedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800 whitespace-nowrap"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Date/Time Badge */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 whitespace-nowrap shrink-0 ${minimizedTags.length === 0 ? 'ml-auto' : ''}`}>
            {formatDate(event.startDate, event.timeUnknown)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative transition-all duration-300 grid gap-2 px-3 py-6
        grid-cols-1
        sm:grid-cols-[192px_1fr] sm:gap-4 sm:px-5
        xl:grid-cols-[192px_384px_1fr] xl:grid-rows-[1fr_auto]
        ${hideBorder ? "" : "border-b border-gray-200 dark:border-gray-700"}
        ${matchTier === 'great' ? "border-l-2 border-l-green-400 dark:border-l-green-600" : ""}
        ${isHiding ? "opacity-0 -translate-x-4" : "opacity-100 translate-x-0"}
        ${
          isNewlyHidden
            ? "bg-gray-200 dark:bg-gray-700 opacity-40"
            : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
        }`}
    >
      {/* Hidden banner - outside the opacity container */}
      {isNewlyHidden && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ opacity: 1 / 0.4 }}
        >
          <span className="bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-xs px-3 py-1.5 rounded-full font-medium shadow-lg pointer-events-none">
            Hidden — this title
            {event.organizer ? ` + "${event.organizer}"` : ""} is added to your
            filter
          </span>
        </div>
      )}

      {/* Image */}
      <div className="relative w-full h-40 sm:h-32 xl:row-span-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
        {!imgError && event.imageUrl ? (
          <Image
            src={event.imageUrl}
            alt={event.title}
            fill
            className="object-cover object-[center_20%]"
            onError={() => setImgError(true)}
            unoptimized={event.imageUrl.startsWith("data:")}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
            <Calendar size={32} />
          </div>
        )}
      </div>

      {/* Metadata: Title, Date, Location, Tags */}
      <div className="flex flex-col justify-between xl:row-span-2">
        <div>
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className={`text-base font-bold leading-tight ${
              eventScore !== null && eventScore !== undefined && eventScore >= 16
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-brand-600 dark:text-brand-400'
            }`}>
              <Link
                href={`/events/${generateEventSlug(
                  event.title,
                  event.startDate,
                  event.id
                )}`}
                className="hover:underline"
              >
                {event.title}
              </Link>
            </h3>
            {/* Match Badge */}
            {matchTier && (
              <div className="relative group/match">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                  matchTier === 'great'
                    ? 'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-800'
                    : 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-800'
                }`}>
                  <Sparkles size={10} className="mr-1" />
                  {matchTier === 'great' ? 'Great Match' : 'Good Match'}
                </span>
                {/* Tooltip with explanation */}
                {matchExplanation?.primary && (
                  <div className="absolute bottom-full left-0 mb-2 hidden group-hover/match:block z-20 w-48">
                    <div className="bg-gray-900 dark:bg-gray-800 text-white text-xs rounded px-3 py-2 shadow-lg">
                      Similar to <strong>{matchExplanation.primary.title}</strong> you liked
                      <div className="absolute top-full left-4 border-4 border-transparent border-t-gray-900 dark:border-t-gray-800" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-900 dark:text-gray-100 font-medium mt-2 sm:mt-1">
            {formatDate(event.startDate, event.timeUnknown)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {event.organizer && event.location
              ? event.location
                  .toLowerCase()
                  .startsWith(event.organizer.toLowerCase())
                ? event.location
                : `${event.organizer} - ${event.location}`
              : event.organizer || event.location || "Online"}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-2 xl:mt-0">
          {/* Price Tag */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${
              displayPrice === "Free"
                ? "bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600"
            }`}
          >
            {displayPrice}
          </span>

          {/* Daily Recurring Badge */}
          {event.recurringType === "daily" && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
              Daily
            </span>
          )}

          {/* Recurring Badge (for similar events) */}
          {showRecurringBadge && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800">
              Recurring
            </span>
          )}

          {/* Other Tags - show first 3-4 official tags unless filtering by tag */}
          {event.tags &&
            (() => {
              // Filter to only show official tags in the UI (custom tags are stored but not displayed)
              const officialTags = event.tags.filter((tag) =>
                OFFICIAL_TAGS_SET.has(tag)
              );

              if (officialTags.length === 0) return null;

              if (isTagFilterActive) {
                return officialTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800"
                  >
                    {tag}
                  </span>
                ));
              }
              // Check if first 4 tags exceed 40 chars total
              const first4 = officialTags.slice(0, 4);
              const first4Chars = first4.join("").length;
              const maxTags = first4Chars > 40 ? 3 : 4;
              const visibleTags = officialTags.slice(0, maxTags);
              const hiddenCount = officialTags.length - visibleTags.length;
              return (
                <>
                  {visibleTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800"
                    >
                      {tag}
                    </span>
                  ))}
                  {hiddenCount > 0 && (
                    <span className="relative inline-flex group/tags">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800 cursor-default leading-4">
                        +{hiddenCount}
                      </span>
                      <span className="absolute bottom-full left-0 mb-1 hidden group-hover/tags:flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg px-2 py-1.5 z-20 whitespace-nowrap">
                        {officialTags.slice(maxTags).map((tag) => (
                          <span
                            key={tag}
                            className="text-xs text-gray-700 dark:text-gray-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    </span>
                  )}
                </>
              );
            })()}
        </div>
      </div>

      {/* Description - Mobile version */}
      <div className="sm:hidden">
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          {truncatedDescriptionMobile}
          {showExpandButtonMobile && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium ml-1 cursor-pointer"
            >
              {expandButtonText}
            </button>
          )}
        </p>
      </div>

      {/* Description - Tablet/Desktop version */}
      <div className="hidden sm:block sm:col-span-2 xl:col-span-1 xl:col-start-3">
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          {truncatedDescriptionTablet}
          {showExpandButtonTablet && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium ml-1 cursor-pointer"
            >
              {expandButtonText}
            </button>
          )}
        </p>
      </div>

      {/* Actions */}
      <div className="sm:col-span-2 xl:col-span-1 xl:col-start-3 flex flex-wrap gap-2 mt-2 xl:mt-0">
        {/* Calendar dropdown */}
        <div className="relative" ref={calendarMenuRef}>
          <button
            onClick={() => setCalendarMenuOpen(!calendarMenuOpen)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-brand-50 dark:hover:bg-brand-950/50 hover:text-brand-600 dark:hover:text-brand-400 rounded border border-gray-200 dark:border-gray-700 cursor-pointer"
            title="Calendar"
          >
            <CalendarPlus2 size={14} />
            <span className="sm:hidden">Calendar</span>
            <span className="hidden sm:inline">Calendar</span>
            <ChevronDown
              size={12}
              className={`transition-transform ${
                calendarMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {calendarMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[160px]">
              <button
                onClick={handleAddToGoogleCalendar}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Small static SVG icon, no optimization needed */}
                <img
                  src="/google_cal.svg"
                  alt="Google Calendar"
                  className="w-3.5 h-3.5"
                />
                Google Calendar
              </button>
              <button
                onClick={handleAddToAppleCalendar}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
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
        {/* Hide dropdown */}
        <div className="relative" ref={hideMenuRef}>
          <button
            onClick={() => setHideMenuOpen(!hideMenuOpen)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 rounded border border-gray-200 dark:border-gray-700 cursor-pointer h-[30px]"
            title="Hide options"
            disabled={isNewlyHidden}
          >
            <EyeOff size={14} />
            <ChevronDown
              size={12}
              className={`transition-transform ${
                hideMenuOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {hideMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[200px]">
              <button
                onClick={handleHideEvent}
                className="w-full flex items-start gap-2 px-3 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                <EyeOff size={14} className="mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-medium">Hide event</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400">
                    Hide now & future occurrences
                  </div>
                </div>
              </button>
              {event.organizer && (
                <button
                  onClick={handleBlockHost}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                >
                  <Ban size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-medium">Hide host</div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">
                      Hide all events from this host
                    </div>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>
        {/* Favorite button */}
        <button
          onClick={() => {
            setIsHeartAnimating(true);
            onToggleFavorite(event.id);
            setTimeout(() => setIsHeartAnimating(false), 300);
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
            isFavorited
              ? "text-red-500 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/50"
              : "text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800"
          }`}
          title={isFavorited ? "Remove from favorites" : "Add to favorites"}
        >
          <Heart
            size={14}
            className={`transition-transform ${
              isFavorited ? "fill-current" : ""
            } ${isHeartAnimating ? "animate-heart-pop" : ""}`}
          />
          {favoriteCount > 0 && <span>{favoriteCount}</span>}
        </button>
        {/* Share button */}
        <div className="relative">
          <button
            onClick={async () => {
              const eventUrl = `${
                window.location.origin
              }/events/${generateEventSlug(
                event.title,
                event.startDate,
                event.id
              )}`;
              await navigator.clipboard.writeText(eventUrl);
              onSignalCapture?.(event.id, 'share');
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors h-[30px]"
            title="Copy link"
          >
            <Share size={14} />
          </button>
          {/* Copied tooltip */}
          {copied && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs font-medium text-white bg-gray-800 dark:bg-gray-700 rounded shadow-lg whitespace-nowrap animate-fade-in">
              Copied!
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800 dark:border-t-gray-700" />
            </div>
          )}
        </div>
        {/* More options dropdown */}
        <div className="relative" ref={moreMenuRef}>
          <button
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 cursor-pointer h-[30px]"
            title="More options"
          >
            <MoreVertical size={14} />
          </button>

          {moreMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[180px]">
              {/* Curate section */}
              <button
                onClick={() => {
                  if (!isLoggedIn) {
                    window.location.href = "/login";
                    return;
                  }
                  if (isCurated) {
                    onUncurate?.(event.id);
                  } else {
                    onCurate?.(event.id);
                  }
                  setMoreMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                  isLoggedIn
                    ? "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                <Bookmark
                  size={14}
                  className={isCurated ? "fill-current text-brand-600" : ""}
                />
                {isLoggedIn
                  ? isCurated
                    ? "Remove from profile"
                    : "Curate"
                  : "Curate - log in to use"}
              </button>
              <a
                href={`/events/${generateEventSlug(
                  event.title,
                  event.startDate,
                  event.id
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                onClick={() => setMoreMenuOpen(false)}
              >
                <Sparkles size={14} />
                See similar events
              </a>
              <a
                href={getSourceUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                onClick={() => {
                  onSignalCapture?.(event.id, 'viewSource');
                  setMoreMenuOpen(false);
                }}
              >
                <ExternalLink size={14} />
                Open source
              </a>
              <div className="border-t border-gray-200 dark:border-gray-700" />
              <button
                onClick={() => handleReport("incorrect_info")}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                <AlertTriangle size={14} />
                Flag incorrect info
              </button>
              <button
                onClick={() => handleReport("duplicate")}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                <AlertTriangle size={14} />
                Flag as duplicate
              </button>
              <button
                onClick={() => handleReport("spam")}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              >
                <ShieldAlert size={14} />
                Report as spam
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
