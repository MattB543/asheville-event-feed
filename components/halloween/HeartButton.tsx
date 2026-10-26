'use client';

import { Heart } from 'lucide-react';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { useFavoritesSync } from '@/lib/hooks/usePreferenceSync';

/** Saves hearts to the account; this page has no event feed doing it. Render once. */
export function FavoritesSync() {
  useFavoritesSync();
  return null;
}

export default function HeartButton({ eventId, title }: { eventId: string; title: string }) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const on = favoriteIds.includes(eventId);
  return (
    <button
      type="button"
      aria-label={on ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
      aria-pressed={on}
      onClick={() => {
        // The shared store rolls back a failed toggle on its own
        toggleFavorite(eventId).catch(() => undefined);
      }}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border cursor-pointer ${
        on
          ? 'border-red-800 bg-red-950/60 text-red-400'
          : 'border-gray-700 text-gray-200 hover:bg-white/5'
      }`}
    >
      <Heart size={14} className={on ? 'fill-current' : ''} />
    </button>
  );
}
