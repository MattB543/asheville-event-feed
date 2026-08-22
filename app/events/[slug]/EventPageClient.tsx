'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import Header from '@/components/Header';
import EventContent from '@/components/EventContent';
import SimilarEventsSection from '@/components/SimilarEventsSection';
import AdminScorePanel from '@/components/AdminScorePanel';
import { useAuth } from '@/components/AuthProvider';
import { useFavorites } from '@/lib/hooks/useFavorites';
import type { ScoreOverride } from '@/lib/utils/scoreCalculation';

// Lazy load modal to reduce initial JS bundle
const EventDetailModal = dynamic(() => import('@/components/EventDetailModal'), { ssr: false });

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

interface EventPageClientProps {
  event: {
    id: string;
    sourceId: string;
    title: string;
    description: string | null;
    aiSummary: string | null;
    startDate: string;
    location: string | null;
    organizer: string | null;
    price: string | null;
    imageUrl: string | null;
    url: string;
    tags: string[] | null;
    source: string;
    timeUnknown: boolean;
    favoriteCount: number;
    // Score fields
    score: number | null;
    scoreRarity: number | null;
    scoreUnique: number | null;
    scoreMagnitude: number | null;
    scoreReason: string | null;
    scoreOverride: ScoreOverride | null;
  };
  eventPageUrl: string;
  similarEvents?: SimilarEvent[];
  canViewScores?: boolean;
  canEditScores?: boolean;
}

// Wait (bounded) for auth to finish loading, polling a ref so callers read the
// current value rather than one captured in a closure
async function waitForAuth(
  authLoadingRef: { current: boolean },
  timeoutMs = 2000,
  intervalMs = 50
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (authLoadingRef.current && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export default function EventPageClient({
  event,
  eventPageUrl,
  similarEvents = [],
  canViewScores = false,
  canEditScores = false,
}: EventPageClientProps) {
  const { user, isLoading: authLoading } = useAuth();
  const isLoggedIn = !!user;

  // Auth state read through refs so an await inside captureSignal sees current values
  const isLoggedInRef = useRef(isLoggedIn);
  const authLoadingRef = useRef(authLoading);
  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
    authLoadingRef.current = authLoading;
  }, [isLoggedIn, authLoading]);

  const { favoriteIds, toggleFavorite } = useFavorites();
  const isFavorited = favoriteIds.includes(event.id);
  const [favoriteCount, setFavoriteCount] = useState(event.favoriteCount);
  const [scoreOverride, setScoreOverride] = useState<ScoreOverride | null>(event.scoreOverride);

  // Similar event modal state
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
  const [similarEventModalOpen, setSimilarEventModalOpen] = useState(false);
  const [selectedSimilarEvent, setSelectedSimilarEvent] = useState<ModalEvent | null>(null);

  // Similar events favorites come from the same shared store as the main heart
  const similarFavorites = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const [similarFavoriteCounts, setSimilarFavoriteCounts] = useState<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    similarEvents.forEach((e) => {
      counts[e.id] = e.favoriteCount;
    });
    return counts;
  });

  // Helper to capture signals for personalization (only 'favorite' signals now)
  const captureSignal = useCallback(async (eventId: string, signalType: 'favorite') => {
    // Wait for auth to settle (bounded), then read the current value - not the one
    // captured when this handler was created
    await waitForAuth(authLoadingRef);

    if (!isLoggedInRef.current) return;

    try {
      await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, signalType }),
      });
    } catch (error) {
      console.error('[Signal:EventPage] Error:', error);
    }
  }, []);

  // The shared store owns the favorite id list, localStorage and rollback;
  // only the displayed counts are local to this page.
  const handleToggleFavorite = async (eventId: string) => {
    try {
      const { isFavorited: nowFavorited, favoriteCount: serverCount } =
        await toggleFavorite(eventId);
      if (serverCount !== null) {
        setFavoriteCount(serverCount);
      }

      // Capture signal for personalization (only when adding)
      if (nowFavorited) {
        await captureSignal(eventId, 'favorite');
      }
    } catch {
      // The shared store rolls the heart/localStorage back. The count is only
      // changed from an authoritative successful response, so it needs no undo.
    }
  };

  // Handler for toggling favorites on similar events
  const handleToggleSimilarFavorite = async (eventId: string) => {
    try {
      const { isFavorited: nowFavorited, favoriteCount: serverCount } =
        await toggleFavorite(eventId);
      if (serverCount !== null) {
        setSimilarFavoriteCounts((prev) => ({ ...prev, [eventId]: serverCount }));
      }

      // Capture signal for personalization (only when adding)
      if (nowFavorited) {
        await captureSignal(eventId, 'favorite');
      }
    } catch {
      // Heart/localStorage rollback is owned by the shared store; counts only
      // change from successful server responses.
    }
  };

  // Handler to open similar event in modal
  const handleOpenSimilarEventModal = useCallback((eventData: ModalEvent) => {
    setSelectedSimilarEvent(eventData);
    setSimilarEventModalOpen(true);
  }, []);

  const handleCloseSimilarEventModal = useCallback(() => {
    setSimilarEventModalOpen(false);
    setSelectedSimilarEvent(null);
  }, []);

  const startDate = new Date(event.startDate);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />

      {/* Main Content */}
      <article className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-4 sm:py-8">
        <EventContent
          event={{
            ...event,
            startDate,
          }}
          eventPageUrl={eventPageUrl}
          isFavorited={isFavorited}
          favoriteCount={favoriteCount}
          onToggleFavorite={(id) => void handleToggleFavorite(id)}
          showTitle={true}
          className="mb-8"
        />

        {/* Admin Score Panel - only show if event has scores and user has permission */}
        {canViewScores && event.score !== null && (
          <div className="px-4 sm:px-0">
            <AdminScorePanel
              eventId={event.id}
              aiScores={{
                rarity: event.scoreRarity,
                unique: event.scoreUnique,
                magnitude: event.scoreMagnitude,
              }}
              scoreReason={event.scoreReason}
              scoreOverride={scoreOverride}
              canEdit={canEditScores}
              onScoreUpdate={setScoreOverride}
            />
          </div>
        )}

        {/* Similar Events */}
        {similarEvents.length > 0 && (
          <SimilarEventsSection
            similarEvents={similarEvents}
            isLoading={false}
            onToggleFavorite={(id) => void handleToggleSimilarFavorite(id)}
            favoriteIds={similarFavorites}
            favoriteCounts={similarFavoriteCounts}
            onOpenEventModal={handleOpenSimilarEventModal}
            showBackLink={true}
          />
        )}

        {/* Back Link */}
        <div className="pt-8 border-t border-gray-200 dark:border-gray-700 px-4 sm:px-0">
          <Link
            href="/events"
            className="inline-flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium"
          >
            <ArrowLeft size={18} />
            Browse all Asheville events
          </Link>
        </div>
      </article>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="mb-2">
          Built by{' '}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            Matt
          </a>{' '}
          at Brooks Solutions, LLC.
        </p>
        <p>
          &copy; {new Date().getFullYear()} AVL GO. Not affiliated with AVL Today, Eventbrite,
          Facebook Events, or Meetup.
        </p>
      </footer>

      {/* Similar Event Modal */}
      {selectedSimilarEvent && (
        <EventDetailModal
          isOpen={similarEventModalOpen}
          onClose={handleCloseSimilarEventModal}
          event={selectedSimilarEvent}
          isFavorited={similarFavorites.has(selectedSimilarEvent.id)}
          favoriteCount={similarFavoriteCounts[selectedSimilarEvent.id] || 0}
          onToggleFavorite={(id) => void handleToggleSimilarFavorite(id)}
        />
      )}
    </main>
  );
}
