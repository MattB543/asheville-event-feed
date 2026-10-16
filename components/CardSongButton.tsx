'use client';

import { useState } from 'react';
import { Music } from 'lucide-react';
import EventSpotifyPlayer from './EventSpotifyPlayer';
import { isMusicEvent } from '@/lib/playlist/music';

interface CardSongButtonProps {
  event: { id: string; source: string; title: string; tags?: string[] | null };
}

/**
 * A "Listen" button for a music event's card. The song is only looked up, and
 * Spotify's player only loaded, once tapped, so a feed of cards stays light.
 * Meant for a flex-wrap row of actions: the player takes its own line under the row.
 */
export default function CardSongButton({ event }: CardSongButtonProps) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<boolean | null>(null);
  if (!isMusicEvent(event)) return null;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
          open
            ? 'text-[#1DB954] border-[#1DB954]/40 bg-[#1DB954]/10'
            : 'text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:text-[#1DB954] hover:border-[#1DB954]/40'
        }`}
        title="Hear the headliner on Spotify"
      >
        <Music size={14} />
        Listen
      </button>
      {open && (
        // order-last: below the whole row, not between the buttons
        <div className="basis-full order-last">
          {found === false ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">No song found for this show.</p>
          ) : (
            <>
              {found === null && (
                <p className="text-xs text-gray-500 dark:text-gray-400">Finding a song…</p>
              )}
              <EventSpotifyPlayer
                event={event}
                height={80}
                onResult={setFound}
                className="max-w-md"
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
