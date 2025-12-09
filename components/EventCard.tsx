"use client";

import {
  Calendar,
  CalendarPlus2,
  ExternalLink,
  EyeOff,
  Ban,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { cleanMarkdown } from "@/lib/utils/cleanMarkdown";
import { generateCalendarUrlForEvent } from "@/lib/utils/googleCalendar";

interface EventCardProps {
  event: {
    id: string;
    sourceId: string;
    source: string;
    title: string;
    description?: string | null;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    price: string | null;
    imageUrl: string | null;
    url: string;
    tags?: string[] | null;
    timeUnknown?: boolean;
  };
  onHide: (title: string, organizer: string | null) => void;
  onBlockHost: (host: string) => void;
  isNewlyHidden?: boolean;
  hideBorder?: boolean;
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
  isNewlyHidden = false,
  hideBorder = false,
}: EventCardProps) {
  const [imgError, setImgError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if description is long enough to need truncation
  // Mobile: 210 chars, Tablet+: 310 chars
  const cleanedDescription =
    cleanMarkdown(event.description) || "No description available.";
  const needsTruncationMobile = cleanedDescription.length > 210;
  const needsTruncationTablet = cleanedDescription.length > 310;
  const truncatedDescriptionMobile =
    needsTruncationMobile && !isExpanded
      ? cleanedDescription.slice(0, 210).trimEnd() + "..."
      : cleanedDescription;
  const truncatedDescriptionTablet =
    needsTruncationTablet && !isExpanded
      ? cleanedDescription.slice(0, 310).trimEnd() + "..."
      : cleanedDescription;

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

  return (
    <div
      className={`relative transition-colors grid gap-2 px-3 py-6
        grid-cols-1
        sm:grid-cols-[192px_1fr] sm:gap-4 sm:px-5
        xl:grid-cols-[192px_384px_1fr] xl:grid-rows-[1fr_auto]
        ${hideBorder ? "" : "border-b border-gray-200 dark:border-gray-700"}
        ${isNewlyHidden ? "bg-gray-200 dark:bg-gray-700 opacity-40" : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
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
      <div className="flex flex-col justify-between xl:row-span-2 xl:h-32">
        <div>
          <h3 className="text-base font-bold text-brand-600 dark:text-brand-400 leading-tight">
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {event.title}
            </a>
          </h3>

          <div className="text-xs text-gray-900 dark:text-gray-100 font-medium mt-2 sm:mt-1">
            {formatDate(event.startDate, event.timeUnknown)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {event.organizer && event.location
              ? `${event.organizer} - ${event.location}`
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

          {/* Other Tags */}
          {event.tags &&
            event.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 border border-brand-100 dark:border-brand-800"
              >
                {tag}
              </span>
            ))}
        </div>
      </div>

      {/* Description - Mobile version (210 chars) */}
      <div className="sm:hidden">
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          {truncatedDescriptionMobile}
          {needsTruncationMobile && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium ml-1 cursor-pointer"
            >
              {isExpanded ? "View less" : "View more"}
            </button>
          )}
        </p>
      </div>

      {/* Description - Tablet/Desktop version (310 chars) */}
      <div className="hidden sm:block sm:col-span-2 xl:col-span-1 xl:col-start-3">
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          {truncatedDescriptionTablet}
          {needsTruncationTablet && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium ml-1 cursor-pointer"
            >
              {isExpanded ? "View less" : "View more"}
            </button>
          )}
        </p>
      </div>

      {/* Actions */}
      <div className="sm:col-span-2 xl:col-span-1 xl:col-start-3 flex flex-wrap gap-2 mt-2 xl:mt-0">
        <a
          href={generateCalendarUrlForEvent(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-brand-50 dark:hover:bg-brand-950/50 hover:text-brand-600 dark:hover:text-brand-400 rounded border border-gray-200 dark:border-gray-700 cursor-pointer"
          title="Add to Google Calendar"
        >
          <CalendarPlus2 size={14} />
          <span className="sm:hidden">Calendar</span>
          <span className="hidden sm:inline">Add to Calendar</span>
        </a>
        <button
          onClick={() => onHide(event.title, event.organizer)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 rounded border border-gray-200 dark:border-gray-700 cursor-pointer"
          title="Hide this event"
          disabled={isNewlyHidden}
        >
          <EyeOff size={14} />
          <span>Hide event</span>
        </button>
        {event.organizer && (
          <button
            onClick={() => onBlockHost(event.organizer!)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 rounded border border-gray-200 dark:border-gray-700 cursor-pointer"
            title={`Block events from ${event.organizer}`}
          >
            <Ban size={14} />
            <span>Hide host</span>
          </button>
        )}
        <a
          href={getSourceUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 cursor-pointer"
          title="View Source Homepage"
        >
          <ExternalLink size={14} />
          <span className="hidden sm:inline">Source</span>
        </a>
      </div>
    </div>
  );
}
