'use client';

import { useEffect, useRef, useState } from 'react';
import posthog from 'posthog-js';
import { isMusicEvent } from '@/lib/playlist/music';

interface SpotifyController {
  addListener: (event: string, callback: () => void) => void;
  destroy: () => void;
}

interface SpotifyIFrameAPI {
  createController: (
    element: HTMLElement,
    options: { uri: string; height: number; width: string },
    callback: (controller: SpotifyController) => void
  ) => void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
  }
}

// Spotify's embed script loads once per page and hands back its API through a global callback
let iframeApi: Promise<SpotifyIFrameAPI> | null = null;
function loadIframeApi(): Promise<SpotifyIFrameAPI> {
  iframeApi ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // Blocked or stalled (e.g. by an ad blocker): give up, and let the next player try again
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      iframeApi = null;
      reject(new Error('Spotify player script did not load'));
    };
    const timer = setTimeout(fail, 10_000);
    window.onSpotifyIframeApiReady = (api) => {
      clearTimeout(timer);
      resolve(api);
    };
    script.onerror = fail;
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.async = true;
    document.body.appendChild(script);
  });
  return iframeApi;
}

interface EventSpotifyPlayerProps {
  event: { id: string; source: string; title: string; tags?: string[] | null };
  className?: string;
  height?: number;
  /** Called once the lookup settles: whether a song was found */
  onResult?: (found: boolean) => void;
  /** Show the loading placeholder during the lookup too, when someone asked for the song */
  placeholderWhileSearching?: boolean;
}

/**
 * The headliner's top song for a music event. Asked for after the page loads, so
 * the page never waits on a first-time match; shows nothing when there's no song.
 */
export default function EventSpotifyPlayer({
  event,
  className = '',
  height = 352,
  onResult,
  placeholderWhileSearching = false,
}: EventSpotifyPlayerProps) {
  const [trackId, setTrackId] = useState<string | null>(null);
  const [searching, setSearching] = useState(true);
  const [ready, setReady] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const music = isMusicEvent(event);

  useEffect(() => {
    if (!music) return;
    const controller = new AbortController();
    fetch(`/api/events/${event.id}/track`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { track?: { id: string } | null } | null) => {
        const id = data?.track?.id ?? null;
        setTrackId(id);
        setSearching(false);
        onResult?.(id !== null);
      })
      .catch((error: unknown) => {
        if ((error as DOMException).name === 'AbortError') return;
        setSearching(false);
        onResult?.(false);
      });
    return () => controller.abort();
  }, [event.id, music, onResult]);

  useEffect(() => {
    const container = holder.current;
    if (!trackId || !container) return;
    // Spotify replaces the element it's given, so give it one React doesn't own
    const element = document.createElement('div');
    container.appendChild(element);
    let player: SpotifyController | null = null;
    let cancelled = false;
    loadIframeApi().then(
      (api) => {
        if (cancelled) return;
        api.createController(
          element,
          { uri: `spotify:track:${trackId}`, height, width: '100%' },
          (controller) => {
            player = controller;
            // Spotify's frame is white until its player draws; show it only then
            controller.addListener('ready', () => setReady(true));
            // Spotify's card sits on a white page; rounding alone leaves a faint white
            // rim, so trim a pixel off each edge as well
            const frame = container.querySelector('iframe');
            if (frame) frame.style.clipPath = 'inset(1px round 12px)';
            let reported = false;
            // Which shows people actually listen to, not just open
            controller.addListener('playback_started', () => {
              if (reported || !posthog.__loaded) return;
              reported = true;
              posthog.capture('spotify_play', { event_id: event.id, track_id: trackId });
            });
          }
        );
      },
      () => {
        if (cancelled) return;
        setTrackId(null);
        onResult?.(false);
      }
    );
    return () => {
      cancelled = true;
      setReady(false);
      player?.destroy();
      container.replaceChildren();
    };
  }, [trackId, event.id, height, onResult]);

  const loading = trackId ? !ready : placeholderWhileSearching && music && searching;
  if (!trackId && !loading) return null;
  return (
    <div className={`relative ${className}`} style={{ height }}>
      {loading && (
        <div className="absolute inset-0 rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse" />
      )}
      <div
        ref={holder}
        className={`relative transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
