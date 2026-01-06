'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Heart,
  Calendar,
  Share,
  ExternalLink,
  EyeOff,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import Header from '@/components/Header';
import { useToast } from '@/components/ui/Toast';
import { generateEventSlug } from '@/lib/utils/slugify';

interface TasteEvent {
  event: {
    id: string;
    title: string;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    url: string;
    imageUrl: string | null;
  };
  signalType?: 'favorite' | 'calendar' | 'share' | 'viewSource' | 'hide'; // Legacy support for old signal types
  timestamp: string;
  active: boolean;
}

interface TasteData {
  positive: TasteEvent[];
  negative: TasteEvent[];
  inactive: TasteEvent[];
}

export default function MyTastePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [tasteData, setTasteData] = useState<TasteData | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [removingSignals, setRemovingSignals] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchTasteData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTasteData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/taste');
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch taste profile');
      }
      const data = (await response.json()) as TasteData;
      setTasteData(data);
    } catch (error) {
      console.error('Error fetching taste data:', error);
      showToast('Failed to load taste profile', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSignal = async (
    eventId: string,
    signalType: 'favorite' | 'calendar' | 'share' | 'viewSource' | 'hide'
  ) => {
    const signalKey = `${eventId}-${signalType}`;
    setRemovingSignals((prev) => new Set(prev).add(signalKey));

    try {
      const response = await fetch('/api/signals', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, signalType }),
      });

      if (!response.ok) {
        throw new Error('Failed to remove signal');
      }

      // Optimistically update UI
      setTasteData((prev) => {
        if (!prev) return prev;

        if (signalType === 'hide') {
          return {
            ...prev,
            negative: prev.negative.filter((e) => e.event.id !== eventId),
          };
        } else {
          return {
            ...prev,
            positive: prev.positive.filter(
              (e) => !(e.event.id === eventId && e.signalType === signalType)
            ),
          };
        }
      });

      showToast('Signal removed', 'success');
    } catch (error) {
      console.error('Error removing signal:', error);
      showToast('Failed to remove signal', 'error');
    } finally {
      setRemovingSignals((prev) => {
        const newSet = new Set(prev);
        newSet.delete(signalKey);
        return newSet;
      });
    }
  };

  const handleReactivate = async (eventId: string) => {
    const signalKey = `reactivate-${eventId}`;
    setRemovingSignals((prev) => new Set(prev).add(signalKey));

    try {
      const response = await fetch('/api/signals/reactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });

      if (!response.ok) {
        throw new Error('Failed to reactivate signal');
      }

      showToast('Signal reactivated', 'success');

      // Refresh data to show updated state
      await fetchTasteData();
    } catch (error) {
      console.error('Error reactivating signal:', error);
      showToast('Failed to reactivate signal', 'error');
    } finally {
      setRemovingSignals((prev) => {
        const newSet = new Set(prev);
        newSet.delete(signalKey);
        return newSet;
      });
    }
  };

  const getSignalIcon = (signalType: string) => {
    switch (signalType) {
      case 'favorite':
        return <Heart className="w-4 h-4 text-red-500" fill="currentColor" />;
      case 'calendar':
        return <Calendar className="w-4 h-4 text-blue-500" />;
      case 'share':
        return <Share className="w-4 h-4 text-green-500" />;
      case 'viewSource':
        return <ExternalLink className="w-4 h-4 text-gray-500" />;
      case 'hide':
        return <EyeOff className="w-4 h-4 text-gray-500" />;
      default:
        return null;
    }
  };

  const getSignalLabel = (signalType: string) => {
    switch (signalType) {
      case 'favorite':
        return 'Favorited';
      case 'calendar':
        return 'Added to calendar';
      case 'share':
        return 'Shared';
      case 'viewSource':
        return 'Viewed source';
      case 'hide':
        return 'Hidden';
      default:
        return signalType;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
        </div>
      </main>
    );
  }

  const hasSignals =
    (tasteData?.positive.length ?? 0) > 0 ||
    (tasteData?.negative.length ?? 0) > 0 ||
    (tasteData?.inactive.length ?? 0) > 0;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />
      <div className="flex-1 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Page Title */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              My Taste Profile
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Events you&apos;ve interacted with help personalize your &quot;For You&quot; feed.
              Signals older than 12 months are automatically deactivated.
            </p>
          </div>

          {!hasSignals ? (
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-12 text-center">
              <Heart className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-700" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                No signals yet
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                Start favoriting, sharing, or hiding events to build your personalized feed.
              </p>
              <Link
                href="/events"
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                Browse events
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Positive Signals */}
              {tasteData && tasteData.positive.length > 0 && (
                <section className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                    Events You Like
                    <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                      ({tasteData.positive.length})
                    </span>
                  </h2>
                  <div className="space-y-3">
                    {tasteData.positive.map((item) => {
                      const signalKey = `${item.event.id}-${item.signalType}`;
                      const isRemoving = removingSignals.has(signalKey);
                      const slug = generateEventSlug(
                        item.event.title,
                        new Date(item.event.startDate),
                        item.event.id
                      );

                      return (
                        <div
                          key={signalKey}
                          className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <div className="mt-1">{getSignalIcon(item.signalType || 'favorite')}</div>
                          <div className="flex-1 min-w-0">
                            <Link
                              href={`/events/${slug}`}
                              className="font-medium text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400 line-clamp-1"
                            >
                              {item.event.title}
                            </Link>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {getSignalLabel(item.signalType || 'favorite')} on{' '}
                              {formatTimestamp(item.timestamp)}
                            </p>
                          </div>
                          <button
                            onClick={() =>
                              void handleRemoveSignal(item.event.id, item.signalType || 'favorite')
                            }
                            disabled={isRemoving}
                            className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            title="Remove signal"
                          >
                            {isRemoving ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <X className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Negative Signals (Hidden Events) */}
              {tasteData && tasteData.negative.length > 0 && (
                <section className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                    Hidden Events
                    <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                      ({tasteData.negative.length})
                    </span>
                  </h2>
                  <div className="space-y-3">
                    {tasteData.negative.map((item) => {
                      const signalKey = `${item.event.id}-hide`;
                      const isRemoving = removingSignals.has(signalKey);
                      const slug = generateEventSlug(
                        item.event.title,
                        new Date(item.event.startDate),
                        item.event.id
                      );

                      return (
                        <div
                          key={signalKey}
                          className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <div className="mt-1">
                            <EyeOff className="w-4 h-4 text-gray-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <Link
                              href={`/events/${slug}`}
                              className="font-medium text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400 line-clamp-1"
                            >
                              {item.event.title}
                            </Link>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              Hidden on {formatTimestamp(item.timestamp)}
                            </p>
                          </div>
                          <button
                            onClick={() => void handleRemoveSignal(item.event.id, 'hide')}
                            disabled={isRemoving}
                            className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            title="Unhide event"
                          >
                            {isRemoving ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <X className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Inactive Signals */}
              {tasteData && tasteData.inactive.length > 0 && (
                <section className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <button
                    onClick={() => setShowInactive(!showInactive)}
                    className="w-full flex items-center justify-between p-6 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                      Inactive Signals (older than 12 months)
                      <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                        ({tasteData.inactive.length})
                      </span>
                    </h2>
                    {showInactive ? (
                      <ChevronUp className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    )}
                  </button>

                  {showInactive && (
                    <div className="p-6 pt-0 space-y-3">
                      {tasteData.inactive.map((item) => {
                        const signalKey = `reactivate-${item.event.id}`;
                        const isReactivating = removingSignals.has(signalKey);
                        const slug = generateEventSlug(
                          item.event.title,
                          new Date(item.event.startDate),
                          item.event.id
                        );

                        return (
                          <div
                            key={signalKey}
                            className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                          >
                            <div className="mt-1 opacity-50">
                              {getSignalIcon(item.signalType || 'favorite')}
                            </div>
                            <div className="flex-1 min-w-0">
                              <Link
                                href={`/events/${slug}`}
                                className="font-medium text-gray-700 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400 line-clamp-1"
                              >
                                {item.event.title}
                              </Link>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {item.signalType ? getSignalLabel(item.signalType) : 'Signal'} on{' '}
                                {formatTimestamp(item.timestamp)}
                              </p>
                            </div>
                            <button
                              onClick={() => void handleReactivate(item.event.id)}
                              disabled={isReactivating}
                              className="flex items-center gap-1 px-3 py-1.5 text-sm text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg transition-colors disabled:opacity-50"
                              title="Re-activate signal"
                            >
                              {isReactivating ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Re-activate</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
