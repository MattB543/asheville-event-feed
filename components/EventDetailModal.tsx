'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { generateEventSlug } from '@/lib/utils/slugify';
import { useFavorites } from '@/lib/hooks/useFavorites';
import EventContent from './EventContent';
import SimilarEventsSection from './SimilarEventsSection';

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

interface EventDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: {
    id: string;
    sourceId: string;
    source: string;
    title: string;
    description?: string | null;
    aiSummary?: string | null;
    startDate: Date;
    location?: string | null;
    organizer?: string | null;
    price?: string | null;
    imageUrl?: string | null;
    url: string;
    tags?: string[] | null;
    timeUnknown?: boolean | null;
  };
  isFavorited: boolean;
  favoriteCount: number;
  onToggleFavorite: (eventId: string) => void;
}

export default function EventDetailModal({
  isOpen,
  onClose,
  event,
  isFavorited,
  favoriteCount,
  onToggleFavorite,
}: EventDetailModalProps) {
  const didPushStateRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Similar events state
  const [similarEvents, setSimilarEvents] = useState<SimilarEvent[]>([]);
  const [similarEventsLoading, setSimilarEventsLoading] = useState(false);
  const { favoriteIds, toggleFavorite } = useFavorites();
  const similarFavorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const [similarFavoriteCounts, setSimilarFavoriteCounts] = useState<Record<string, number>>({});

  const startDate = new Date(event.startDate);
  const eventUrl = `/events/${generateEventSlug(event.title, event.startDate, event.id)}`;
  const fullEventUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${eventUrl}` : eventUrl;

  // Fetch similar events when modal opens
  useEffect(() => {
    if (!isOpen || !event.id) return;

    /* eslint-disable react-hooks/set-state-in-effect -- reset state before fetching similar events */
    setSimilarEventsLoading(true);
    setSimilarEvents([]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Abort on close/event change so a slow response can't populate a different event
    const controller = new AbortController();

    fetch(`/api/events/${event.id}/similar`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load similar events: ${res.status}`);
        return res.json();
      })
      .then((data: { similarEvents?: SimilarEvent[] }) => {
        const events = data.similarEvents || [];
        setSimilarEvents(events);
        // Initialize favorite counts from response
        const counts: Record<string, number> = {};
        events.forEach((e) => {
          counts[e.id] = e.favoriteCount;
        });
        setSimilarFavoriteCounts(counts);
      })
      .catch((error: unknown) => {
        if ((error as DOMException)?.name === 'AbortError') return;
        console.error(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSimilarEventsLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [isOpen, event.id]);

  // Handle URL state management - push state when modal opens
  useEffect(() => {
    if (isOpen && !didPushStateRef.current) {
      window.history.pushState({ modal: true, eventId: event.id }, '', eventUrl);
      didPushStateRef.current = true;
    }
  }, [isOpen, eventUrl, event.id]);

  // Handle browser back button - close modal when user navigates back
  useEffect(() => {
    const handlePopState = () => {
      if (didPushStateRef.current) {
        didPushStateRef.current = false;
        onClose();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onClose]);

  // Handle close - go back in history to restore previous URL, then close modal
  const handleClose = useCallback(() => {
    if (didPushStateRef.current) {
      didPushStateRef.current = false;
      window.history.back(); // Restore URL
    }
    onClose(); // Always close the modal
  }, [onClose]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      didPushStateRef.current = false;
      /* eslint-disable react-hooks/set-state-in-effect -- reset state on modal close */
      setSimilarEvents([]);
      setSimilarEventsLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isOpen]);

  // Handler for toggling favorites on similar events.
  // The shared store owns the id list, localStorage and rollback; only the
  // displayed count is local to this component.
  const handleToggleSimilarFavorite = async (eventId: string) => {
    try {
      const { favoriteCount } = await toggleFavorite(eventId);
      if (favoriteCount !== null) {
        setSimilarFavoriteCounts((prev) => ({ ...prev, [eventId]: favoriteCount }));
      }
    } catch {
      // Heart/localStorage rollback is owned by the shared store; counts only
      // change from successful server responses.
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Full-screen page overlay */}
      <div
        ref={modalRef}
        className="absolute inset-0 bg-gray-50 dark:bg-gray-950 flex flex-col overflow-hidden"
      >
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <article className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-4 sm:py-8">
            {/* Back button above content */}
            <button
              onClick={handleClose}
              className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer mb-4 px-4 sm:px-0"
              aria-label="Go back"
            >
              <ArrowLeft size={20} />
              <span className="text-sm font-medium">Back</span>
            </button>

            <EventContent
              event={{
                ...event,
                startDate,
              }}
              eventPageUrl={fullEventUrl}
              isFavorited={isFavorited}
              favoriteCount={favoriteCount}
              onToggleFavorite={onToggleFavorite}
              showTitle={true}
            />

            {/* Similar Events Section */}
            {(similarEvents.length > 0 || similarEventsLoading) && (
              <div className="mt-8">
                <SimilarEventsSection
                  similarEvents={similarEvents}
                  isLoading={similarEventsLoading}
                  onToggleFavorite={(id) => void handleToggleSimilarFavorite(id)}
                  favoriteIds={similarFavorites}
                  favoriteCounts={similarFavoriteCounts}
                  showBackLink={false}
                  navigateOnSimilarClick={true}
                />
              </div>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
