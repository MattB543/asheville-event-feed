'use client';

import { Calendar, MapPin, User as UserIcon, ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { generateEventSlug } from '@/lib/utils/slugify';

interface CuratedEvent {
  id: string;
  note: string | null;
  curatedAt: Date;
  event: {
    id: string;
    title: string;
    description: string | null;
    aiSummary: string | null;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    price: string | null;
    url: string;
    imageUrl: string | null;
    tags: string[] | null;
    source: string;
  };
}

interface CuratedEventListProps {
  curations: CuratedEvent[];
}

export default function CuratedEventList({ curations }: CuratedEventListProps) {
  if (curations.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">No curated events yet.</p>
      </div>
    );
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatCuratedDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {curations.map((curation) => (
        <div
          key={curation.id}
          className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
        >
          {/* Curator note */}
          {curation.note && (
            <div className="bg-brand-50 dark:bg-brand-900/20 px-4 py-3 border-b border-brand-100 dark:border-brand-800">
              <p className="text-sm text-brand-800 dark:text-brand-200 italic">
                &ldquo;{curation.note}&rdquo;
              </p>
            </div>
          )}

          {/* Event content */}
          <div className="p-4">
            {/* Image */}
            {curation.event.imageUrl && (
              <div className="relative w-full h-48 rounded-lg overflow-hidden mb-4">
                <Image
                  src={curation.event.imageUrl}
                  alt={curation.event.title}
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            )}

            {/* Title */}
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              <Link
                href={`/events/${generateEventSlug(curation.event.title, curation.event.startDate, curation.event.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer"
              >
                {curation.event.title}
              </Link>
            </h3>

            {/* Date */}
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
              <Calendar size={14} />
              <span>{formatDate(curation.event.startDate)}</span>
            </div>

            {/* Location */}
            {curation.event.location && (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                <MapPin size={14} />
                <span>{curation.event.location}</span>
              </div>
            )}

            {/* Organizer */}
            {curation.event.organizer && (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                <UserIcon size={14} />
                <span>{curation.event.organizer}</span>
              </div>
            )}

            {/* Summary or Description */}
            {(curation.event.aiSummary || curation.event.description) && (
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 line-clamp-3">
                {curation.event.aiSummary || curation.event.description}
              </p>
            )}

            {/* Tags */}
            {curation.event.tags && curation.event.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-4">
                {curation.event.tags.slice(0, 5).map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-400">
                Curated on {formatCuratedDate(curation.curatedAt)}
              </span>

              <Link
                href={`/events/${generateEventSlug(curation.event.title, curation.event.startDate, curation.event.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 cursor-pointer"
              >
                View Event
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
