'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import {
  CalendarPlus2,
  MapPin,
  Clock,
  User,
  Tag,
  DollarSign,
  ExternalLink,
  Heart,
  ChevronDown,
  Share,
} from 'lucide-react';
import { cleanAshevilleFromSummary, cleanMarkdown } from '@/lib/utils/parsers';
import { formatTagForDisplay } from '@/lib/utils/formatTag';
import { generateCalendarUrlForEvent } from '@/lib/utils/googleCalendar';
import { downloadEventAsICS } from '@/lib/utils/icsGenerator';

interface EventContentProps {
  event: {
    id: string;
    sourceId: string;
    source: string;
    title: string;
    description?: string | null;
    aiSummary?: string | null;
    startDate: Date | string;
    location?: string | null;
    organizer?: string | null;
    price?: string | null;
    imageUrl?: string | null;
    url: string;
    tags?: string[] | null;
    timeUnknown?: boolean | null;
  };
  eventPageUrl: string;
  isFavorited: boolean;
  favoriteCount: number;
  onToggleFavorite: (eventId: string) => void;
  onSignalCapture?: (eventId: string, signalType: 'calendar' | 'share' | 'viewSource') => void;
  showTitle?: boolean;
  className?: string;
}

export default function EventContent({
  event,
  eventPageUrl,
  isFavorited,
  favoriteCount,
  onToggleFavorite,
  onSignalCapture,
  showTitle = true,
  className = '',
}: EventContentProps) {
  const [imgError, setImgError] = useState(false);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isHeartAnimating, setIsHeartAnimating] = useState(false);
  const [showOriginalDescription, setShowOriginalDescription] = useState(false);
  const calendarMenuRef = useRef<HTMLDivElement>(null);

  const startDate =
    typeof event.startDate === 'string' ? new Date(event.startDate) : event.startDate;

  // Close calendar menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calendarMenuRef.current && !calendarMenuRef.current.contains(e.target as Node)) {
        setCalendarMenuOpen(false);
      }
    }

    if (calendarMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [calendarMenuOpen]);

  const handleAddToGoogleCalendar = () => {
    window.open(
      generateCalendarUrlForEvent({
        title: event.title,
        startDate,
        description: event.description ?? null,
        location: event.location ?? null,
      }),
      '_blank'
    );
    onSignalCapture?.(event.id, 'calendar');
    setCalendarMenuOpen(false);
  };

  const handleAddToAppleCalendar = () => {
    downloadEventAsICS({
      title: event.title,
      startDate,
      description: event.description ?? null,
      location: event.location ?? null,
      url: event.url,
    });
    onSignalCapture?.(event.id, 'calendar');
    setCalendarMenuOpen(false);
  };

  const handleToggleFavorite = () => {
    setIsHeartAnimating(true);
    onToggleFavorite(event.id);
    setTimeout(() => setIsHeartAnimating(false), 300);
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(eventPageUrl);
    onSignalCapture?.(event.id, 'share');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (date: Date, timeUnknown?: boolean | null) => {
    const dateStr = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);

    if (timeUnknown) {
      return { date: dateStr, time: 'Time TBD' };
    }

    const timeStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);

    return { date: dateStr, time: timeStr };
  };

  const formatPriceDisplay = (price: string | null | undefined): string => {
    if (!price || price === 'Unknown') return 'Price TBD';
    if (price.toLowerCase() === 'free') return 'Free';
    const match = price.match(/\$?([\d.]+)/);
    if (match) {
      const rounded = Math.round(parseFloat(match[1]));
      return `$${rounded}`;
    }
    return price;
  };

  const getSourceUrl = () => {
    if (event.source === 'AVL_TODAY') {
      const slug = event.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(startDate);
      const getPart = (type: string) => parts.find((p) => p.type === type)?.value;
      const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}`;

      return `https://avltoday.6amcity.com/events#/details/${slug}/${event.sourceId}/${dateStr}`;
    }
    return event.url;
  };

  const getSourceName = () => {
    switch (event.source) {
      case 'AVL_TODAY':
        return 'AVL Today';
      case 'EVENTBRITE':
        return 'Eventbrite';
      case 'MEETUP':
        return 'Meetup';
      case 'FACEBOOK':
        return 'Facebook';
      case 'HARRAHS':
        return "Harrah's Cherokee Center";
      case 'ORANGE_PEEL':
        return 'The Orange Peel';
      case 'GREY_EAGLE':
        return 'Grey Eagle Taqueria';
      case 'LIVE_MUSIC_AVL':
        return 'Live Music Asheville';
      case 'EXPLORE_ASHEVILLE':
        return 'Explore Asheville';
      case 'MISFIT_IMPROV':
        return 'Misfit Improv';
      case 'UDHARMA':
        return 'UDharma';
      case 'NC_STAGE':
        return 'NC Stage';
      case 'STORY_PARLOR':
        return 'Story Parlor';
      case 'MOUNTAIN_X':
        return 'Mountain X';
      case 'STATIC_AGE':
        return 'Static Age';
      case 'REVOLVE':
        return 'Revolve';
      case 'BMC_MUSEUM':
        return 'Asheville Museum of Science';
      case 'ASHEVILLE_ON_BIKES':
        return 'Asheville On Bikes';
      case 'UNCA':
        return 'UNC Asheville';
      case 'LITTLE_ANIMALS':
        return 'Little Animals';
      default:
        return 'Source';
    }
  };

  const { date: dateStr, time: timeStr } = formatDate(startDate, event.timeUnknown);
  const displayPrice = formatPriceDisplay(event.price);

  // AI Summary vs Original Description
  const hasAiSummary = !!event.aiSummary;
  const cleanedAiSummary = event.aiSummary
    ? cleanAshevilleFromSummary(cleanMarkdown(event.aiSummary))
    : null;
  const cleanedDescription =
    cleanMarkdown(event.description ?? null) || 'No description available.';
  const displayDescription = showOriginalDescription
    ? cleanedDescription
    : cleanedAiSummary || cleanedDescription;

  return (
    <div className={className}>
      {/* Hero Section - Image and metadata */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6 px-4 sm:px-0">
        {/* Image */}
        <div className="relative w-full sm:w-72 md:w-80 lg:w-96 xl:w-[420px] h-48 sm:h-48 md:h-56 lg:h-64 xl:h-72 shrink-0 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden">
          {!imgError && event.imageUrl ? (
            <Image
              src={event.imageUrl}
              alt={event.title}
              fill
              className="object-cover"
              onError={() => setImgError(true)}
              unoptimized={event.imageUrl.startsWith('data:')}
              priority
            />
          ) : (
            <Image src="/asheville-default.jpg" alt="Asheville, NC" fill className="object-cover" />
          )}
        </div>

        {/* Metadata */}
        <div className="flex-1 flex flex-col">
          {/* Title */}
          {showTitle && (
            <h1 className="text-2xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {event.title}
            </h1>
          )}

          {/* Quick Info */}
          <div className="flex flex-col gap-2.5 text-sm">
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
                <span className="text-gray-900 dark:text-gray-100">{event.organizer}</span>
              </div>
            )}

            {/* Price */}
            <div className="flex items-center gap-3">
              <DollarSign className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />
              <span
                className={
                  displayPrice === 'Free'
                    ? 'text-green-600 dark:text-green-400 font-medium'
                    : 'text-gray-900 dark:text-gray-100'
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

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-4">
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
                  className={`transition-transform ${calendarMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {calendarMenuOpen && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[160px]">
                  <button
                    onClick={handleAddToGoogleCalendar}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded-t-lg"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/google_cal.svg" alt="Google Calendar" className="w-3.5 h-3.5" />
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
                  ? 'bg-red-50 dark:bg-red-950/50 text-red-500 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-500 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800'
              }`}
              title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart
                size={15}
                className={`transition-transform ${
                  isFavorited ? 'fill-current' : ''
                } ${isHeartAnimating ? 'animate-heart-pop' : ''}`}
              />
              {favoriteCount > 0 && <span>{favoriteCount}</span>}
            </button>

            {/* Share */}
            <div className="relative">
              <button
                onClick={() => void handleCopyLink()}
                className="inline-flex items-center justify-center px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer h-[34px]"
                title="Copy link"
              >
                <Share size={15} />
              </button>
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
              onClick={() => onSignalCapture?.(event.id, 'viewSource')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <ExternalLink size={15} />
              View on {getSourceName()}
            </a>
          </div>
        </div>
      </div>

      {/* Description */}
      <section className="px-4 sm:px-0">
        <div className="prose prose-gray dark:prose-invert max-w-none">
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
            {displayDescription}
            {hasAiSummary && (
              <button
                onClick={() => setShowOriginalDescription(!showOriginalDescription)}
                className="text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium ml-2 cursor-pointer"
              >
                {showOriginalDescription ? 'View less' : 'View original'}
              </button>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
