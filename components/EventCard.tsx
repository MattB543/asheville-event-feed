"use client";

import { Calendar, ExternalLink, EyeOff, Ban } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

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
  onHide: (id: string) => void;
  onBlockHost: (host: string) => void;
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
}: EventCardProps) {
  const [imgError, setImgError] = useState(false);

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
    <div className="bg-white border-b border-gray-200 hover:bg-gray-50 transition-colors flex flex-col sm:flex-row gap-4 p-4">
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
            unoptimized={event.imageUrl.startsWith('data:')}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <Calendar size={32} />
          </div>
        )}
      </div>

      {/* Details Column */}
      <div className="flex-shrink-0 w-full sm:w-80 flex flex-col gap-1">
        <h3 className="text-base font-bold text-blue-600 leading-tight">
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {event.title}
          </a>
        </h3>

        <div className="text-xs text-gray-500 font-medium">
          {event.organizer && <div className="mb-1">{event.organizer}</div>}
          <div className="text-gray-900 mb-1">
            {formatDate(event.startDate)}
          </div>
          <div className="text-gray-500 mb-1">{event.location || "Online"}</div>

          <div className="flex flex-wrap gap-1 mt-2">
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
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100"
                >
                  {tag}
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Description Column */}
      <div className="flex-grow min-w-0">
        <p className="text-sm text-gray-600 line-clamp-4 leading-relaxed mb-2">
          {event.description || "No description available."}
        </p>
      </div>

      {/* Actions Column */}
      <div className="flex flex-row sm:flex-col gap-2 flex-shrink-0 items-end sm:items-center justify-start pt-1">
        <a
          href={getSourceUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 text-gray-500 hover:bg-gray-100 rounded border border-gray-200 cursor-pointer"
          title="View Source Homepage"
        >
          <ExternalLink size={16} />
        </a>
        <button
          onClick={() => onHide(event.id)}
          className="p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 rounded border border-gray-200 cursor-pointer"
          title="Hide this event"
        >
          <EyeOff size={16} />
        </button>
        {event.organizer && (
          <button
            onClick={() => onBlockHost(event.organizer!)}
            className="p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 rounded border border-gray-200 cursor-pointer"
            title={`Block events from ${event.organizer}`}
          >
            <Ban size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
