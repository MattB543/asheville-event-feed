"use client";

import {
  Calendar,
  CalendarPlus,
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
  };
  onHide: (title: string, organizer: string | null) => void;
  onBlockHost: (host: string) => void;
  isNewlyHidden?: boolean;
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
}: EventCardProps) {
  const [imgError, setImgError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if description is long enough to need truncation
  const cleanedDescription =
    cleanMarkdown(event.description) || "No description available.";
  const needsTruncation = cleanedDescription.length > 310;
  const truncatedDescription =
    needsTruncation && !isExpanded
      ? cleanedDescription.slice(0, 310).trimEnd() + "..."
      : cleanedDescription;

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(date));
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
      className={`relative border-b border-gray-200 transition-colors flex flex-col sm:flex-row gap-4 px-5 py-6 ${
        isNewlyHidden ? "bg-gray-200 opacity-40" : "bg-white hover:bg-gray-50"
      }`}
    >
      {/* Hidden banner - outside the opacity container */}
      {isNewlyHidden && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ opacity: 1 / 0.4 }}
        >
          <span className="bg-gray-800 text-white text-xs px-3 py-1.5 rounded-full font-medium shadow-lg pointer-events-none">
            Hidden — this title
            {event.organizer ? ` + "${event.organizer}"` : ""} is added to your
            filter
          </span>
        </div>
      )}
      {/* Image Column */}
      <div className="relative w-full sm:w-48 h-32 flex-shrink-0 bg-gray-200 rounded overflow-hidden">
        {!imgError && event.imageUrl ? (
          <Image
            src={event.imageUrl}
            alt={event.title}
            fill
            className="object-cover"
            onError={() => setImgError(true)}
            // Only use unoptimized for base64 data URLs (AI-generated images)
            // External URLs go through Next.js optimization which caches them
            unoptimized={event.imageUrl.startsWith("data:")}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <Calendar size={32} />
          </div>
        )}
      </div>

      {/* Details Column */}
      <div className="flex-shrink-0 w-full sm:w-96 sm:h-32 flex flex-col justify-between">
        <div>
          <h3 className="text-base font-bold text-brand-600 leading-tight">
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {event.title}
            </a>
          </h3>

          <div className="text-xs text-gray-900 font-medium mt-1">
            {formatDate(event.startDate)}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            {event.organizer && event.location
              ? `${event.organizer} - ${event.location}`
              : event.organizer || event.location || "Online"}
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {/* Price Tag */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${
              displayPrice === "Free"
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-gray-50 text-gray-700 border-gray-200"
            }`}
          >
            {displayPrice}
          </span>

          {/* Other Tags */}
          {event.tags &&
            event.tags.map((tag, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 text-brand-700 border border-brand-100"
              >
                {tag}
              </span>
            ))}
        </div>
      </div>

      {/* Description + Actions Column */}
      <div className="flex-grow min-w-0 flex flex-col">
        <p className="text-sm text-gray-600 leading-relaxed mb-3">
          {truncatedDescription}
          {needsTruncation && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium ml-1 cursor-pointer"
            >
              {isExpanded ? "View less" : "View more"}
            </button>
          )}
        </p>

        {/* Actions Row */}
        <div className="flex flex-wrap gap-2 mt-auto">
          <a
            href={generateCalendarUrlForEvent(event)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-brand-50 hover:text-brand-600 rounded border border-gray-200 cursor-pointer"
            title="Add to Google Calendar"
          >
            <CalendarPlus size={14} />
            <span>Calendar</span>
          </a>
          <button
            onClick={() => onHide(event.title, event.organizer)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600 rounded border border-gray-200 cursor-pointer"
            title="Hide this event"
            disabled={isNewlyHidden}
          >
            <EyeOff size={14} />
            <span>Hide event</span>
          </button>
          {event.organizer && (
            <button
              onClick={() => onBlockHost(event.organizer!)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600 rounded border border-gray-200 cursor-pointer"
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-200 cursor-pointer"
            title="View Source Homepage"
          >
            <ExternalLink size={14} />
            <span>Source</span>
          </a>
        </div>
      </div>
    </div>
  );
}
