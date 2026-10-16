'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import EventCard, { CARD_BOX } from '@/components/EventCard';
import { useFavorites } from '@/lib/hooks/useFavorites';
import type { EndCapEvent } from '@/lib/news/queries';
import { useToggleSet } from '@/lib/hooks/useToggleSet';

/**
 * "That's the news. Now go do something." The Top 30 events in the next week,
 * as Top 30 cards with their Top 30 ranks. Hiding and curating need the events
 * feed around them, so those actions are left off here; favorites, calendar,
 * share and reporting work as they do anywhere.
 */
export default function NewsEndCap({ events }: { events: EndCapEvent[] }) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const [favoriteCounts, setFavoriteCounts] = useState<Record<string, number>>({});
  const mobileExpanded = useToggleSet();

  if (events.length === 0) return null;

  const handleToggleFavorite = async (eventId: string) => {
    try {
      const { favoriteCount } = await toggleFavorite(eventId);
      if (favoriteCount !== null) {
        setFavoriteCounts((prev) => ({ ...prev, [eventId]: favoriteCount }));
      }
    } catch {
      // The shared store rolls the heart back; counts only change on success.
    }
  };

  return (
    <section aria-labelledby="news-end-cap-title" className="mt-12">
      <div className="px-3 sm:px-0">
        <h2
          id="news-end-cap-title"
          className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-50"
        >
          That&apos;s the news. Now go do something.
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          The Top 30 events happening in the next 7 days.
        </p>
      </div>

      <div className={`mt-4 ${CARD_BOX}`}>
        {events.map((event) => (
          <EventCard
            key={event.id}
            event={{
              ...event,
              startDate: new Date(event.startDate),
              top30Occurrences: event.top30Occurrences?.map((occurrence) => ({
                ...occurrence,
                startDate: new Date(occurrence.startDate),
              })),
            }}
            isFavorited={favoriteIds.includes(event.id)}
            favoriteCount={favoriteCounts[event.id] ?? event.favoriteCount}
            onToggleFavorite={(eventId) => void handleToggleFavorite(eventId)}
            showCurate={false}
            displayMode="full"
            ranking={event.rank}
            isMobileExpanded={mobileExpanded.has(event.id)}
            onMobileExpand={mobileExpanded.toggle}
          />
        ))}
      </div>

      <div className="px-3 sm:px-0">
        <Link
          href="/events/top30"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400 hover:underline"
        >
          See the full Top 30
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
