'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import Header from '@/components/Header';
import EventContent from '@/components/EventContent';
import SimilarEventsSection from '@/components/SimilarEventsSection';
import AdminScorePanel from '@/components/AdminScorePanel';
import { useAuth } from '@/components/AuthProvider';
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

// Helper to get initial favorite state from localStorage
function getInitialFavorited(eventId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const savedFavorites = localStorage.getItem('favoritedEventIds');
    if (savedFavorites) {
      const favorites = JSON.parse(savedFavorites) as unknown[];
      return Array.isArray(favorites) && favorites.includes(eventId);
    }
  } catch {
    // Ignore localStorage errors
  }
  return false;
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

  const [isFavorited, setIsFavorited] = useState(() => getInitialFavorited(event.id));
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

  // Similar events favorites state
  const [similarFavorites, setSimilarFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('favoritedEventIds');
      return new Set(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const [similarFavoriteCounts, setSimilarFavoriteCounts] = useState<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    similarEvents.forEach((e) => {
      counts[e.id] = e.favoriteCount;
    });
    return counts;
  });

  // Helper to capture signals for personalization (only 'favorite' signals now)
  const captureSignal = useCallback(
    async (eventId: string, signalType: 'favorite') => {
      if (authLoading) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!isLoggedIn) return;

      try {
        await fetch('/api/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, signalType }),
        });
      } catch (error) {
        console.error('[Signal:EventPage] Error:', error);
      }
    },
    [isLoggedIn, authLoading]
  );

  const handleToggleFavorite = async (eventId: string) => {
    // Optimistic update
    const newIsFavorited = !isFavorited;
    setIsFavorited(newIsFavorited);
    setFavoriteCount((prev) => (newIsFavorited ? prev + 1 : Math.max(0, prev - 1)));

    // Update localStorage
    const savedFavorites = localStorage.getItem('favoritedEventIds');
    const favorites: string[] = savedFavorites ? (JSON.parse(savedFavorites) as string[]) : [];
    if (newIsFavorited) {
      favorites.push(eventId);
    } else {
      const index = favorites.indexOf(eventId);
      if (index > -1) favorites.splice(index, 1);
    }
    localStorage.setItem('favoritedEventIds', JSON.stringify(favorites));

    // Update server
    try {
      await fetch(`/api/events/${eventId}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newIsFavorited ? 'add' : 'remove' }),
      });

      // Capture signal for personalization (only when adding)
      if (newIsFavorited) {
        await captureSignal(eventId, 'favorite');
      }
    } catch {
      // Revert on error
      setIsFavorited(!newIsFavorited);
      setFavoriteCount((prev) => (!newIsFavorited ? prev + 1 : Math.max(0, prev - 1)));
    }
  };

  // Handler for toggling favorites on similar events
  const handleToggleSimilarFavorite = async (eventId: string) => {
    const newIsFavorited = !similarFavorites.has(eventId);

    // Optimistic update
    setSimilarFavorites((prev) => {
      const next = new Set(prev);
      if (newIsFavorited) {
        next.add(eventId);
      } else {
        next.delete(eventId);
      }
      return next;
    });
    setSimilarFavoriteCounts((prev) => ({
      ...prev,
      [eventId]: newIsFavorited ? (prev[eventId] || 0) + 1 : Math.max(0, (prev[eventId] || 0) - 1),
    }));

    // Update localStorage
    const savedFavorites = localStorage.getItem('favoritedEventIds');
    const favorites: string[] = savedFavorites ? (JSON.parse(savedFavorites) as string[]) : [];
    if (newIsFavorited) {
      favorites.push(eventId);
    } else {
      const index = favorites.indexOf(eventId);
      if (index > -1) favorites.splice(index, 1);
    }
    localStorage.setItem('favoritedEventIds', JSON.stringify(favorites));

    // Update server
    try {
      await fetch(`/api/events/${eventId}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: newIsFavorited ? 'add' : 'remove' }),
      });

      // Capture signal for personalization (only when adding)
      if (newIsFavorited) {
        await captureSignal(eventId, 'favorite');
      }
    } catch {
      // Revert on error
      setSimilarFavorites((prev) => {
        const next = new Set(prev);
        if (!newIsFavorited) {
          next.add(eventId);
        } else {
          next.delete(eventId);
        }
        return next;
      });
      setSimilarFavoriteCounts((prev) => ({
        ...prev,
        [eventId]: !newIsFavorited
          ? (prev[eventId] || 0) + 1
          : Math.max(0, (prev[eventId] || 0) - 1),
      }));
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
          &copy; {new Date().getFullYear()} Asheville Event Feed. Not affiliated with AVL Today,
          Eventbrite, Facebook Events, or Meetup.
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
