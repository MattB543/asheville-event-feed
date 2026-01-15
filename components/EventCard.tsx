'use client';

import {
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
  Star,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { cleanMarkdown } from '@/lib/utils/parsers';
import { cleanAshevilleFromSummary } from '@/lib/utils/parsers';
import { generateCalendarUrlForEvent } from '@/lib/utils/googleCalendar';
import { downloadEventAsICS } from '@/lib/utils/icsGenerator';
import { useToast } from '@/components/ui/Toast';
import { generateEventSlug } from '@/lib/utils/slugify';
import { OFFICIAL_TAGS_SET } from '@/lib/config/tagCategories';

/**
 * Component that renders only the tags that fit on one line.
 * Uses a hidden measurement layer to determine how many tags can be displayed.
 */
function FittingTags({
  tags,
  className,
  tagClassName,
}: {
  tags: string[];
  className?: string;
  tagClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);

  // Use useLayoutEffect to measure before paint (avoids flicker)
  const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const measureContainer = measureRef.current;
    if (!container || !measureContainer || tags.length === 0) return;

    const measure = () => {
      const containerWidth = container.offsetWidth;
      const children = Array.from(measureContainer.children) as HTMLElement[];
      const gap = 6; // gap-1.5 = 6px

      let totalWidth = 0;
      let count = 0;

      for (const child of children) {
        const childWidth = child.offsetWidth;
        const widthWithGap = count === 0 ? childWidth : childWidth + gap;

        if (totalWidth + widthWithGap <= containerWidth) {
          totalWidth += widthWithGap;
          count++;
        } else {
          break;
        }
      }

      setVisibleCount(Math.max(1, count));
    };

    // Measure after DOM is ready
    requestAnimationFrame(measure);

    // Re-measure on resize
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [tags]);

  if (tags.length === 0) return null;

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      {/* Hidden measurement layer - renders all tags to measure their widths */}
      <div
        ref={measureRef}
        className="flex items-center gap-1.5 absolute top-0 left-0 invisible pointer-events-none whitespace-nowrap"
        aria-hidden="true"
      >
        {tags.map((tag) => (
          <span key={tag} className={tagClassName}>
            {tag}
          </span>
        ))}
      </div>
      {/* Visible tags - only render what fits */}
      {tags.slice(0, visibleCount).map((tag) => (
        <span key={tag} className={tagClassName}>
          {tag}
        </span>
      ))}
    </div>
  );
}

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
  /** Event score (0-30) */
  eventScore?: number | null;
  /** Whether this event is being hidden (for animation) */
  isHiding?: boolean;
  /** Whether this is a great match (shows star icons around title) */
  isGreatMatch?: boolean;
  /** Optional ranking number to display before title (e.g., "1." for top 30) */
  ranking?: number;
  /** Whether this card is expanded on mobile */
  isMobileExpanded?: boolean;
  /** Callback when user taps to expand on mobile */
  onMobileExpand?: (eventId: string) => void;
  /** Callback to open event in modal instead of navigating to full page */
  onOpenModal?: (event: EventCardProps['event']) => void;
  /** Callback when user clicks to collapse an expanded desktop card */
  onCollapseDesktop?: (eventId: string) => void;
}

// Round price string to nearest dollar (e.g., "$19.10" -> "$19", "$25.50" -> "$26")
const formatPriceDisplay = (price: string | null): string => {
  if (!price || price === 'Unknown') return '$ Unknown';
  if (price.toLowerCase() === 'free') return 'Free';

  // Extract number from price string and round
  const match = price.match(/\$?([\d.]+)/);
  if (match) {
    const rounded = Math.round(parseFloat(match[1]));
    return `$${rounded}`;
  }
  // If price is just "$" with no number, treat as unknown
  if (price.trim() === '$') return '$ Unknown';
  return price;
};

export default function EventCard({
  event,
  onHide,
  onBlockHost,
  isNewlyHidden = false,
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
  isHiding = false,
  isGreatMatch = false,
  ranking,
  isMobileExpanded = false,
  onMobileExpand,
  onOpenModal,
  onCollapseDesktop,
}: EventCardProps) {
  const [imgError, setImgError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // Mobile expansion state: 0 = truncated AI summary, 1 = full AI summary, 2 = original description
  const [mobileExpansionState, setMobileExpansionState] = useState<0 | 1 | 2>(0);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isHeartAnimating, setIsHeartAnimating] = useState(false);
  const [copied, setCopied] = useState(false);
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  // Close dropdown menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (calendarMenuRef.current && !calendarMenuRef.current.contains(event.target as Node)) {
        setCalendarMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    }

    if (calendarMenuOpen || moreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [calendarMenuOpen, moreMenuOpen]);

  const handleAddToAppleCalendar = () => {
    downloadEventAsICS(event);
    setCalendarMenuOpen(false);
  };

  const handleAddToGoogleCalendar = () => {
    window.open(generateCalendarUrlForEvent(event), '_blank');
    setCalendarMenuOpen(false);
  };

  const handleHideEvent = () => {
    onHide(event.title, event.organizer, event.id);
    setMoreMenuOpen(false);
  };

  const handleBlockHost = () => {
    if (event.organizer) {
      onBlockHost(event.organizer);
      setMoreMenuOpen(false);
    }
  };

  const handleReport = (reportType: 'incorrect_info' | 'duplicate' | 'spam') => {
    setMoreMenuOpen(false);
    showToast('Thanks for the feedback! This event will be automatically reviewed for correctness.');
    fetch('/api/events/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: event.id,
        eventTitle: event.title,
        eventUrl: getSourceUrl(),
        reportType,
      }),
    }).catch((error) => {
      console.error('Failed to submit report:', error);
    });
  };

  // Use AI summary if available, otherwise use original description
  const hasAiSummary = !!event.aiSummary;
  const cleanedAiSummary = event.aiSummary
    ? cleanAshevilleFromSummary(cleanMarkdown(event.aiSummary))
    : null;
  const cleanedDescription = cleanMarkdown(event.description) || 'No description available.';

  // When collapsed: show AI summary (or truncated description if no AI summary)
  // When expanded: show full original description
  const displayText = isExpanded ? cleanedDescription : cleanedAiSummary || cleanedDescription;

  // Only need truncation if no AI summary and description is long
  const needsTruncationMobile = !hasAiSummary && cleanedDescription.length > 195;
  const needsTruncationTablet = !hasAiSummary && cleanedDescription.length > 295;
  const truncatedDescriptionMobile =
    needsTruncationMobile && !isExpanded
      ? cleanedDescription.slice(0, 195).trimEnd() + '...'
      : displayText;
  const truncatedDescriptionTablet =
    needsTruncationTablet && !isExpanded
      ? cleanedDescription.slice(0, 295).trimEnd() + '...'
      : displayText;

  // Show expand button if: has AI summary, or description needs truncation
  const showExpandButtonTablet = hasAiSummary || needsTruncationTablet;
  const expandButtonText = isExpanded ? 'View less' : hasAiSummary ? 'View original' : 'View more';

  const formatDate = (date: Date, timeUnknown?: boolean) => {
    const eventDate = new Date(date);
    const today = new Date();

    // Check if the event is today
    const isToday =
      eventDate.getFullYear() === today.getFullYear() &&
      eventDate.getMonth() === today.getMonth() &&
      eventDate.getDate() === today.getDate();

    const dateOnly = isToday
      ? 'Today'
      : new Intl.DateTimeFormat('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }).format(eventDate);

    if (timeUnknown) {
      return dateOnly;
    }

    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(eventDate);

    return `${dateOnly} · ${time}`;
  };

  const getSourceUrl = () => {
    if (event.source === 'AVL_TODAY') {
      const slug = event.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

      // Format date as YYYY-MM-DDTHH in local time (assuming ET for AVL)
      // We use the date string directly if we can, but we only have the Date object here.
      // We'll use Intl to extract the parts in the correct timezone.
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(new Date(event.startDate));
      const getPart = (type: string) => parts.find((p) => p.type === type)?.value;
      const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}`;

      return `https://avltoday.6amcity.com/events#/details/${slug}/${event.sourceId}/${dateStr}`;
    }
    if (event.source === 'EVENTBRITE') return event.url;
    return event.url; // Fallback
  };

  const displayPrice = formatPriceDisplay(event.price);

  // Handler for mobile card click (toggle expand/collapse)
  const handleMobileCardClick = () => {
    if (onMobileExpand) {
      onMobileExpand(event.id);
    }
  };

  // Handler for opening event in modal
  const handleOpenModal = (e: React.MouseEvent) => {
    if (onOpenModal) {
      e.preventDefault();
      e.stopPropagation();
      onOpenModal(event);
    }
  };

  // Handler for collapsing expanded desktop card
  const handleDesktopCardClick = () => {
    if (onCollapseDesktop && displayMode === 'full') {
      onCollapseDesktop(event.id);
    }
  };

  // Generate event URL for links
  const eventUrl = `/events/${generateEventSlug(event.title, event.startDate, event.id)}`;

  // Elevate card z-index when any dropdown is open so it appears above subsequent cards
  const hasOpenDropdown = calendarMenuOpen || moreMenuOpen;

  // Get first 3 official tags for mobile/minimized display
  const officialTags = event.tags?.filter((tag) => OFFICIAL_TAGS_SET.has(tag)) || [];
  const customTags = event.tags?.filter((tag) => !OFFICIAL_TAGS_SET.has(tag)) || [];
  // For minimized view: up to 3 tags, official first, then custom to fill
  // If 3 tags exceed 36 chars combined, only show 2
  const allTagsSorted = [...officialTags, ...customTags];
  const threeTagsCharCount = allTagsSorted.slice(0, 3).join('').length;
  const minimizedTags = allTagsSorted.slice(0, threeTagsCharCount > 36 ? 2 : 3);
  // For mobile expanded: just first 3 official tags
  const mobileTags = officialTags.slice(0, 3);

  // Location/venue/host display text (full, for expanded view)
  const locationText =
    event.organizer && event.location
      ? event.location.toLowerCase().startsWith(event.organizer.toLowerCase())
        ? event.location
        : `${event.organizer} - ${event.location}`
      : event.organizer || event.location || 'Online';

  // Venue name only (for minimized view) - extract venue from location if organizer is missing
  // Location often has format "Venue Name, Street Address, City, State" - we want just the venue
  const venueName =
    event.organizer ||
    (() => {
      if (!event.location) return null;
      // If location contains a comma followed by a number (street address), extract just the venue part
      const match = event.location.match(/^([^,]+),\s*\d/);
      if (match) return match[1].trim();
      // Otherwise just take the first comma-separated part if there are multiple
      const parts = event.location.split(',');
      return parts.length > 2 ? parts[0].trim() : event.location;
    })();

  return (
    <div>
      {/* Mobile Layout - Collapsed/Expanded */}
      <div
        className={`sm:hidden relative transition-all duration-300 px-3 pt-4 pb-4
          border-b border-gray-300 dark:border-gray-600
          ${isHiding ? 'opacity-0 -translate-x-4' : 'opacity-100 translate-x-0'}
          ${hasOpenDropdown ? 'z-40' : ''}
          ${
            isNewlyHidden
              ? 'bg-gray-200 dark:bg-gray-700 opacity-40'
              : isGreatMatch
                ? 'bg-blue-50/40 dark:bg-blue-950/15'
                : 'bg-white dark:bg-gray-900'
          }
          ${!isMobileExpanded ? 'cursor-pointer' : ''}`}
        onClick={handleMobileCardClick}
      >
        {/* Hidden banner */}
        {isNewlyHidden && (
          <div
            className="absolute inset-0 flex items-center justify-center z-10"
            style={{ opacity: 1 / 0.4 }}
          >
            <span className="bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 text-xs px-3 py-1.5 rounded-full font-medium shadow-lg pointer-events-none">
              Hidden — this title
              {event.organizer ? ` + "${event.organizer}"` : ''} is added to your filter
            </span>
          </div>
        )}

        {/* Image - 130px collapsed, 192px expanded */}
        <Link
          href={eventUrl}
          onClick={onOpenModal ? handleOpenModal : (e) => e.stopPropagation()}
          className="block"
        >
          <div
            className={`relative w-full ${
              isMobileExpanded ? 'h-48' : 'h-[130px]'
            } bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden transition-all duration-200 shadow-sm`}
          >
            {!imgError && event.imageUrl ? (
              <Image
                src={event.imageUrl}
                alt={event.title}
                fill
                className="object-cover object-[center_20%]"
                onError={() => setImgError(true)}
                unoptimized={event.imageUrl.startsWith('data:')}
                referrerPolicy="no-referrer"
              />
            ) : (
              <Image
                src="/asheville-default.jpg"
                alt="Asheville, NC"
                fill
                className="object-cover"
              />
            )}
          </div>
        </Link>

        {/* Content area */}
        <div className="pt-3">
          {/* Title row */}
          <div className="flex items-start gap-2">
            <h3 className="text-base font-bold leading-tight text-brand-600 dark:text-brand-400 flex-1">
              <Link
                href={eventUrl}
                className="hover:underline"
                onClick={onOpenModal ? handleOpenModal : (e) => e.stopPropagation()}
              >
                {ranking ? `${ranking}. ${event.title}` : event.title}
              </Link>
              {isGreatMatch && (
                <Star
                  size={12}
                  className="inline-block ml-1.5 text-amber-500 fill-amber-500 mt-[-2px]"
                  style={{ verticalAlign: 'middle' }}
                />
              )}
            </h3>
            <ChevronDown
              size={16}
              className={`text-gray-600 dark:text-gray-400 mt-0.5 shrink-0 opacity-80 transition-transform duration-200 ${
                isMobileExpanded ? 'rotate-180' : ''
              }`}
            />
          </div>

          {/* Host/venue - collapsed shows organizer only; expanded shows full location */}
          {(isMobileExpanded ? event.organizer || event.location : event.organizer) && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-1">
              {isMobileExpanded ? locationText : event.organizer}
            </div>
          )}

          {/* AI Summary - 2 lines collapsed, full expanded */}
          {cleanedAiSummary && (
            <p
              className={`text-sm text-gray-600 dark:text-gray-300 leading-relaxed mt-2 ${
                !isMobileExpanded ? 'line-clamp-2' : ''
              }`}
            >
              {cleanedAiSummary}
            </p>
          )}

          {/* Badges: Date/Time, Price, Tags */}
          <div className="flex items-center gap-1.5 mt-3">
            {/* Date/Time Badge */}
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 shrink-0">
              {formatDate(event.startDate, event.timeUnknown)}
            </span>

            {/* Price Badge */}
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border shrink-0 ${
                displayPrice === 'Free'
                  ? 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600'
              }`}
            >
              {displayPrice}
            </span>

            {/* Tags - only show what fits on one line */}
            {mobileTags.length > 0 && (
              <FittingTags
                tags={mobileTags}
                className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden"
                tagClassName="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800 shrink-0"
              />
            )}
          </div>

          {/* Action buttons - only when expanded */}
          {isMobileExpanded && (
            <div className="flex flex-wrap gap-2 mt-4" onClick={(e) => e.stopPropagation()}>
              {/* Calendar dropdown */}
              <div className="relative" ref={calendarMenuRef}>
                <button
                  onClick={() => setCalendarMenuOpen(!calendarMenuOpen)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-brand-50 dark:hover:bg-brand-950/50 hover:text-brand-600 dark:hover:text-brand-400 rounded border border-gray-200 dark:border-gray-700 cursor-pointer"
                  title="Calendar"
                >
                  <CalendarPlus2 size={14} />
                  <span>Calendar</span>
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${calendarMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {calendarMenuOpen && (
                  <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[160px]">
                    <button
                      onClick={handleAddToGoogleCalendar}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <Image
                        src="/google_cal.svg"
                        alt="Google Calendar"
                        width={14}
                        height={14}
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

              {/* Favorite button */}
              <button
                onClick={() => {
                  setIsHeartAnimating(true);
                  onToggleFavorite(event.id);
                  setTimeout(() => setIsHeartAnimating(false), 300);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
                  isFavorited
                    ? 'text-red-500 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/50'
                    : 'text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800'
                }`}
                title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart
                  size={14}
                  className={`transition-transform ${
                    isFavorited ? 'fill-current' : ''
                  } ${isHeartAnimating ? 'animate-heart-pop' : ''}`}
                />
                {favoriteCount > 0 && <span>{favoriteCount}</span>}
              </button>

              {/* Share button */}
              <div className="relative">
                <button
                  onClick={() => {
                    const shareUrl = `${window.location.origin}/events/${generateEventSlug(
                      event.title,
                      event.startDate,
                      event.id
                    )}`;
                    void navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors h-[30px]"
                  title="Copy link"
                >
                  <Share size={14} />
                </button>
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
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[200px]">
                    <button
                      onClick={() => {
                        if (!isLoggedIn) {
                          window.location.href = '/login';
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
                          ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      <Bookmark
                        size={14}
                        className={isCurated ? 'fill-current text-brand-600' : ''}
                      />
                      {isLoggedIn
                        ? isCurated
                          ? 'Remove from profile'
                          : 'Curate'
                        : 'Curate - log in to use'}
                    </button>
                    <a
                      href={eventUrl}
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
                      onClick={() => setMoreMenuOpen(false)}
                    >
                      <ExternalLink size={14} />
                      Open source
                    </a>
                    <div className="border-t border-gray-200 dark:border-gray-700" />
                    <button
                      onClick={() => {
                        handleHideEvent();
                        setMoreMenuOpen(false);
                      }}
                      disabled={isNewlyHidden}
                      className={`w-full flex items-start gap-2 px-3 py-2 text-left cursor-pointer ${
                        isNewlyHidden
                          ? 'text-gray-400 dark:text-gray-600'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <EyeOff size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <div className="text-xs font-medium">Hide event</div>
                        <div
                          className={`text-[10px] ${
                            isNewlyHidden
                              ? 'text-gray-400 dark:text-gray-600'
                              : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          Hide now & future occurrences
                        </div>
                      </div>
                    </button>
                    {event.organizer && (
                      <button
                        onClick={() => {
                          handleBlockHost();
                          setMoreMenuOpen(false);
                        }}
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
                    <div className="border-t border-gray-200 dark:border-gray-700" />
                    <button
                      onClick={() => handleReport('incorrect_info')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <AlertTriangle size={14} />
                      Flag incorrect info
                    </button>
                    <button
                      onClick={() => handleReport('spam')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <ShieldAlert size={14} />
                      Report as spam
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Desktop/Tablet Minimized Layout - text-only row */}
      {displayMode === 'minimized' && (
        <div
          onClick={() => onExpandMinimized?.(event.id)}
          className={`hidden sm:flex sm:items-center sm:gap-1 px-5 py-2.5 cursor-pointer opacity-80 hover:opacity-100
            border-b border-gray-300 dark:border-gray-600
            bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-opacity`}
        >
          {/* Title */}
          <Link
            href={eventUrl}
            className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap shrink-0"
            onClick={onOpenModal ? handleOpenModal : (e) => e.stopPropagation()}
          >
            {event.title}
          </Link>

          {/* Separator */}
          {venueName && <span className="text-gray-400 dark:text-gray-500 shrink-0">-</span>}

          {/* Venue/Host */}
          {venueName && (
            <span className="text-sm text-gray-500 dark:text-gray-400 truncate min-w-0">
              {venueName}
            </span>
          )}

          {/* Tags - pushed to the right */}
          {minimizedTags.length > 0 && (
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {minimizedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800 whitespace-nowrap"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Date/Time Badge */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 whitespace-nowrap shrink-0 ${
              minimizedTags.length === 0 && !venueName ? 'ml-auto' : ''
            }`}
          >
            {formatDate(event.startDate, event.timeUnknown)}
          </span>
          <ChevronDown size={14} className="text-gray-400 dark:text-gray-500 opacity-60 shrink-0" />
        </div>
      )}

      {/* Desktop/Tablet Full Layout - grid with image */}
      {displayMode !== 'minimized' && (
        <div
          onClick={onCollapseDesktop ? handleDesktopCardClick : undefined}
          className={`hidden sm:grid relative transition-all duration-300 gap-2 px-3 py-6
          sm:grid-cols-[192px_1fr] sm:gap-4 sm:px-5
          xl:grid-cols-[192px_384px_1fr] xl:grid-rows-[1fr_auto]
          border-b border-gray-300 dark:border-gray-600
          ${isHiding ? 'opacity-0 -translate-x-4' : 'opacity-100 translate-x-0'}
          ${hasOpenDropdown ? 'z-40' : ''}
          ${onCollapseDesktop ? 'cursor-pointer' : ''}
          ${
            isNewlyHidden
              ? 'bg-gray-200 dark:bg-gray-700 opacity-40'
              : isGreatMatch
                ? 'bg-blue-50/40 dark:bg-blue-950/15 hover:bg-blue-100/50 dark:hover:bg-blue-900/25'
                : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'
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
                {event.organizer ? ` + "${event.organizer}"` : ''} is added to your filter
              </span>
            </div>
          )}

          {/* Image */}
          <Link
            href={eventUrl}
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenModal) handleOpenModal(e);
            }}
            className="relative w-full h-40 sm:h-32 xl:row-span-2 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden block"
          >
            {!imgError && event.imageUrl ? (
              <Image
                src={event.imageUrl}
                alt={event.title}
                fill
                className="object-cover object-[center_20%]"
                onError={() => setImgError(true)}
                unoptimized={event.imageUrl.startsWith('data:')}
                referrerPolicy="no-referrer"
              />
            ) : (
              <Image
                src="/asheville-default.jpg"
                alt="Asheville, NC"
                fill
                className="object-cover"
              />
            )}
          </Link>

          {/* Metadata: Title, Date, Location, Tags */}
          <div className="flex flex-col justify-between xl:row-span-2">
            <div>
              <div className="flex items-start gap-2 flex-wrap">
                <h3 className="text-base font-bold leading-tight text-brand-600 dark:text-brand-400">
                  <Link
                    href={eventUrl}
                    className="hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenModal) handleOpenModal(e);
                    }}
                  >
                    {ranking ? `${ranking}. ${event.title}` : event.title}
                  </Link>
                  {isGreatMatch && (
                    <Star
                      size={12}
                      className="inline-block ml-1.5 text-amber-500 fill-amber-500 mt-[-2px]"
                      style={{ verticalAlign: 'middle' }}
                    />
                  )}
                </h3>
              </div>

              <div className="text-xs text-gray-900 dark:text-gray-100 font-medium mt-2 sm:mt-1">
                {formatDate(event.startDate, event.timeUnknown)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 line-clamp-1">
                {event.organizer && event.location
                  ? event.location.toLowerCase().startsWith(event.organizer.toLowerCase())
                    ? event.location
                    : `${event.organizer} - ${event.location}`
                  : event.organizer || event.location || 'Online'}
              </div>
            </div>

            <div className="flex flex-wrap gap-1 mt-2 xl:mt-0">
              {/* Price Tag */}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${
                  displayPrice === 'Free'
                    ? 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                }`}
              >
                {displayPrice}
              </span>

              {/* Daily Recurring Badge */}
              {event.recurringType === 'daily' && (
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
                  const officialTags = event.tags.filter((tag) => OFFICIAL_TAGS_SET.has(tag));

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
                  const first4Chars = first4.join('').length;
                  const maxTags = first4Chars > 40 ? 3 : 4;
                  const visibleTags = officialTags.slice(0, maxTags);
                  const hiddenCount = officialTags.length - visibleTags.length;
                  // On mobile, limit to 3 tags; on desktop, use maxTags (3 or 4)
                  const mobileMaxTags = 3;
                  const mobileHiddenCount = officialTags.length - mobileMaxTags;

                  return (
                    <>
                      {visibleTags.map((tag, index) => (
                        <span
                          key={tag}
                          className={`items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800 ${
                            index >= mobileMaxTags ? 'hidden sm:inline-flex' : 'inline-flex'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                      {/* Mobile: show +N badge if more than 3 tags */}
                      {mobileHiddenCount > 0 && (
                        <span className="relative inline-flex sm:hidden group/tags">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800 cursor-default leading-4">
                            +{mobileHiddenCount}
                          </span>
                        </span>
                      )}
                      {/* Desktop: show +N badge if more than maxTags */}
                      {hiddenCount > 0 && (
                        <span className="relative hidden sm:inline-flex group/tags">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800 cursor-default leading-4">
                            +{hiddenCount}
                          </span>
                          <span className="absolute bottom-full left-0 mb-1 hidden group-hover/tags:flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg px-2 py-1.5 z-20 whitespace-nowrap">
                            {officialTags.slice(maxTags).map((tag) => (
                              <span key={tag} className="text-xs text-gray-700 dark:text-gray-300">
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

          {/* Description - Mobile version with 3-state expansion */}
          <div className="sm:hidden">
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {/* State 0: Show AI summary truncated to 2 lines (or full description if no AI summary) */}
              {mobileExpansionState === 0 && hasAiSummary && (
                <>
                  <span className="line-clamp-2">{cleanedAiSummary}</span>
                  <button
                    onClick={() => setMobileExpansionState(1)}
                    className="block text-xs text-gray-500 dark:text-gray-400 mt-1 cursor-pointer"
                  >
                    View more
                  </button>
                </>
              )}
              {/* State 0 without AI summary: Show truncated description */}
              {mobileExpansionState === 0 && !hasAiSummary && (
                <>
                  {truncatedDescriptionMobile}
                  {needsTruncationMobile && (
                    <button
                      onClick={() => setMobileExpansionState(2)}
                      className="block text-xs text-gray-500 dark:text-gray-400 mt-1 cursor-pointer"
                    >
                      View more
                    </button>
                  )}
                </>
              )}
              {/* State 1: Show full AI summary with View original button */}
              {mobileExpansionState === 1 && hasAiSummary && (
                <>
                  {cleanedAiSummary}
                  <button
                    onClick={() => setMobileExpansionState(2)}
                    className="block text-xs text-gray-500 dark:text-gray-400 mt-1 cursor-pointer"
                  >
                    View original
                  </button>
                </>
              )}
              {/* State 2: Show full original description */}
              {mobileExpansionState === 2 && (
                <>
                  {cleanedDescription}
                  <button
                    onClick={() => setMobileExpansionState(0)}
                    className="block text-xs text-gray-500 dark:text-gray-400 mt-1 cursor-pointer"
                  >
                    View less
                  </button>
                </>
              )}
            </p>
          </div>

          {/* Description - Tablet/Desktop version */}
          <div className="hidden sm:block sm:col-span-2 xl:col-span-1 xl:col-start-3">
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {truncatedDescriptionTablet}
              {showExpandButtonTablet && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                  className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium ml-1 cursor-pointer"
                >
                  {expandButtonText}
                </button>
              )}
            </p>
          </div>

          {/* Actions */}
          <div
            className="sm:col-span-2 xl:col-span-1 xl:col-start-3 flex flex-wrap gap-2 mt-2 xl:mt-0"
            onClick={(e) => e.stopPropagation()}
          >
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
                  className={`transition-transform ${calendarMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {calendarMenuOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[160px]">
                  <button
                    onClick={handleAddToGoogleCalendar}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <Image
                      src="/google_cal.svg"
                      alt="Google Calendar"
                      width={14}
                      height={14}
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
            {/* Favorite button */}
            <button
              onClick={() => {
                setIsHeartAnimating(true);
                onToggleFavorite(event.id);
                setTimeout(() => setIsHeartAnimating(false), 300);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
                isFavorited
                  ? 'text-red-500 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900/50'
                  : 'text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800'
              }`}
              title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart
                size={14}
                className={`transition-transform ${
                  isFavorited ? 'fill-current' : ''
                } ${isHeartAnimating ? 'animate-heart-pop' : ''}`}
              />
              {favoriteCount > 0 && <span>{favoriteCount}</span>}
            </button>
            {/* Share button */}
            <div className="relative">
              <button
                onClick={() => {
                  const eventUrl = `${window.location.origin}/events/${generateEventSlug(
                    event.title,
                    event.startDate,
                    event.id
                  )}`;
                  void navigator.clipboard.writeText(eventUrl);
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
                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg min-w-[200px]">
                  {/* Curate section */}
                  <button
                    onClick={() => {
                      if (!isLoggedIn) {
                        window.location.href = '/login';
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
                        ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    <Bookmark
                      size={14}
                      className={isCurated ? 'fill-current text-brand-600' : ''}
                    />
                    {isLoggedIn
                      ? isCurated
                        ? 'Remove from profile'
                        : 'Curate'
                      : 'Curate - log in to use'}
                  </button>
                  <a
                    href={`/events/${generateEventSlug(event.title, event.startDate, event.id)}`}
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
                    onClick={() => setMoreMenuOpen(false)}
                  >
                    <ExternalLink size={14} />
                    Open source
                  </a>
                  {/* Hide section */}
                  <div className="border-t border-gray-200 dark:border-gray-700" />
                  <button
                    onClick={() => {
                      handleHideEvent();
                      setMoreMenuOpen(false);
                    }}
                    disabled={isNewlyHidden}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left cursor-pointer ${
                      isNewlyHidden
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <EyeOff size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs font-medium">Hide event</div>
                      <div
                        className={`text-[10px] ${
                          isNewlyHidden
                            ? 'text-gray-400 dark:text-gray-600'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        Hide now & future occurrences
                      </div>
                    </div>
                  </button>
                  {event.organizer && (
                    <button
                      onClick={() => {
                        handleBlockHost();
                        setMoreMenuOpen(false);
                      }}
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
                  {/* Flag section */}
                  <div className="border-t border-gray-200 dark:border-gray-700" />
                  <button
                    onClick={() => handleReport('incorrect_info')}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <AlertTriangle size={14} />
                    Flag incorrect info
                  </button>
                  <button
                    onClick={() => handleReport('spam')}
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
      )}
    </div>
  );
}
