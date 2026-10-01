'use client';

import { useEffect } from 'react';
import { storyAnchorId } from './display';

const HIGHLIGHT = 'var(--accent-warm-soft)';
const HOLD_MS = 1600;
const FADE_MS = 1400;

/**
 * The warm highlight that says "this one": on arriving at `/news?s=<id>` it
 * scrolls the shared story into view, and on a short-version sentence it marks
 * the card the link jumped to. Either way it holds, then fades. Renders
 * nothing; the stories themselves are server-rendered.
 */
export default function StoryFocus({ sharedId }: { sharedId: string | null }) {
  useEffect(() => {
    const timers = new Map<HTMLElement, number[]>();

    const highlight = (element: HTMLElement) => {
      // Clicking the same sentence again starts the highlight over
      timers.get(element)?.forEach((timer) => window.clearTimeout(timer));
      element.style.transition = '';
      element.style.backgroundColor = HIGHLIGHT;
      timers.set(element, [
        window.setTimeout(() => {
          element.style.transition = `background-color ${FADE_MS}ms ease-out`;
          element.style.backgroundColor = '';
        }, HOLD_MS),
        window.setTimeout(() => {
          element.style.transition = '';
          timers.delete(element);
        }, HOLD_MS + FADE_MS),
      ]);
    };

    const byHash = (hash: string) =>
      hash.startsWith('#story-') ? document.getElementById(hash.slice(1)) : null;

    // The browser does the jump; this only marks where it landed. A click
    // rather than `hashchange`, which doesn't fire for the same link twice.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest('a[href^="#story-"]');
      const element = link && byHash(link.getAttribute('href') ?? '');
      if (element) highlight(element);
    };
    document.addEventListener('click', onClick);

    const fromHash = byHash(window.location.hash);
    if (fromHash) highlight(fromHash);

    const shared = sharedId ? document.getElementById(storyAnchorId(sharedId)) : null;
    const frame = shared
      ? requestAnimationFrame(() => {
          shared.scrollIntoView({ block: 'center' });
          highlight(shared);
        })
      : 0;

    return () => {
      document.removeEventListener('click', onClick);
      cancelAnimationFrame(frame);
      for (const [element, pending] of timers) {
        pending.forEach((timer) => window.clearTimeout(timer));
        element.style.backgroundColor = '';
        element.style.transition = '';
      }
    };
  }, [sharedId]);

  return null;
}
