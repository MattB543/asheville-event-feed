'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import EventCard from '@/components/EventCard';
import { ToastProvider } from '@/components/ui/Toast';
import { generateEventSlug } from '@/lib/utils/slugify';

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

type ModalEvent = {
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
};

interface SimilarEventsSectionProps {
  similarEvents: SimilarEvent[];
  isLoading: boolean;
  onToggleFavorite: (eventId: string) => void;
  favoriteIds: Set<string>;
  favoriteCounts: Record<string, number>;
  onOpenEventModal?: (event: ModalEvent) => void;
  showBackLink?: boolean;
  navigateOnSimilarClick?: boolean; // If true, navigate to page instead of opening modal
}

// Type for deduplicated similar event with recurring info
type DedupedSimilarEvent = SimilarEvent & {
  isRecurring: boolean;
  recurringCount: number;
};

export default function SimilarEventsSection({
  similarEvents,
  isLoading,
  onToggleFavorite,
  favoriteIds,
  favoriteCounts,
  onOpenEventModal,
  showBackLink = true,
  navigateOnSimilarClick = false,
}: SimilarEventsSectionProps) {
  const router = useRouter();
  const [similarSortBy, setSimilarSortBy] = useState<'similarity' | 'date'>('similarity');
  const [mobileExpandedIds, setMobileExpandedIds] = useState<Set<string>>(new Set());

  // Deduplicate recurring events (same title + description = recurring)
  const dedupedSimilarEvents = useMemo(() => {
    const groups = new Map<string, SimilarEvent[]>();

    for (const event of similarEvents) {
      const key = `${event.title}|||${event.description || ''}`;
      const existing = groups.get(key);
      if (existing) {
        existing.push(event);
      } else {
        groups.set(key, [event]);
      }
    }

    const deduped: DedupedSimilarEvent[] = [];
    for (const [, events] of groups) {
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

    return deduped.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
  }, [similarEvents]);

  // Sort deduped events based on selected sort option
  const sortedSimilarEvents = useMemo(() => {
    if (similarSortBy === 'date') {
      return [...dedupedSimilarEvents].sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      );
    }
    return dedupedSimilarEvents;
  }, [dedupedSimilarEvents, similarSortBy]);

  // Group similar events by date (only when sorted by date)
  const groupedSimilarEvents = useMemo(() => {
    if (similarSortBy !== 'date') return null;

    return Object.entries(
      sortedSimilarEvents.reduce(
        (groups, event) => {
          const date = new Date(event.startDate);
          const dateKey = date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          if (!groups[dateKey]) groups[dateKey] = { date, events: [] as DedupedSimilarEvent[] };
          groups[dateKey].events.push(event);
          return groups;
        },
        {} as Record<string, { date: Date; events: DedupedSimilarEvent[] }>
      )
    ).sort(([, a], [, b]) => a.date.getTime() - b.date.getTime());
  }, [sortedSimilarEvents, similarSortBy]);

  // Format date header with Today/Tomorrow support
  const formatDateHeader = (date: Date): string => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return `Today, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Handle event click - either navigate or open modal
  const handleEventClick = (eventData: ModalEvent) => {
    if (navigateOnSimilarClick) {
      const slug = generateEventSlug(eventData.title, eventData.startDate, eventData.id);
      router.push(`/events/${slug}`);
    } else {
      onOpenEventModal?.(eventData);
    }
  };

  if (similarEvents.length === 0 && !isLoading) {
    return null;
  }

  return (
    <section className="mb-8 pt-6 border-t-2 border-gray-300 dark:border-gray-600">
      <div className="flex items-center justify-between mb-4 px-4 sm:px-0 sticky top-0 bg-gray-50 dark:bg-gray-950 py-3 z-20 sm:rounded-lg">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Similar Events</h2>
        <div className="flex items-center gap-3">
          {showBackLink && (
            <Link
              href="/events"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors hidden sm:flex items-center gap-1"
            >
              <ArrowLeft size={14} />
              Back to main list
            </Link>
          )}
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
          {isLoading ? (
            // Loading skeleton
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 animate-pulse">
                  <div className="flex gap-4">
                    <div className="w-24 h-24 bg-gray-200 dark:bg-gray-700 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-3">
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : similarSortBy === 'date' && groupedSimilarEvents ? (
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
                      isFavorited={favoriteIds.has(similarEvent.id)}
                      favoriteCount={favoriteCounts[similarEvent.id] || 0}
                      onToggleFavorite={onToggleFavorite}
                      hideBorder={
                        groupIndex === groupedSimilarEvents.length - 1 &&
                        index === groupEvents.length - 1
                      }
                      showRecurringBadge={similarEvent.isRecurring}
                      isMobileExpanded={mobileExpandedIds.has(similarEvent.id)}
                      onMobileExpand={(id) =>
                        setMobileExpandedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) {
                            next.delete(id);
                          } else {
                            next.add(id);
                          }
                          return next;
                        })
                      }
                      onOpenModal={(eventData) =>
                        handleEventClick({
                          ...eventData,
                          startDate: new Date(eventData.startDate),
                        })
                      }
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
                isFavorited={favoriteIds.has(similarEvent.id)}
                favoriteCount={favoriteCounts[similarEvent.id] || 0}
                onToggleFavorite={onToggleFavorite}
                hideBorder={index === sortedSimilarEvents.length - 1}
                showRecurringBadge={similarEvent.isRecurring}
                isMobileExpanded={mobileExpandedIds.has(similarEvent.id)}
                onMobileExpand={(id) =>
                  setMobileExpandedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) {
                      next.delete(id);
                    } else {
                      next.add(id);
                    }
                    return next;
                  })
                }
                onOpenModal={(eventData) =>
                  handleEventClick({
                    ...eventData,
                    startDate: new Date(eventData.startDate),
                  })
                }
              />
            ))
          )}
        </div>
      </ToastProvider>
    </section>
  );
}
