'use client';

import { useEffect } from 'react';
import { storyAnchorId } from './display';

const HIGHLIGHT = 'var(--accent-warm-soft)';
const HOLD_MS = 1600;
const FADE_MS = 1400;

/**
 * Arriving on `/news?s=<id>`: scroll the shared story into view and give it a
 * warm highlight that fades, so it's clear which one the link meant. Renders
 * nothing; the story itself is server-rendered wherever it sits on the page.
 */
export default function SharedStoryFocus({ shortId }: { shortId: string }) {
  useEffect(() => {
    const element = document.getElementById(storyAnchorId(shortId));
    if (!element) return;

    const timers: number[] = [];
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: 'center' });
      element.style.backgroundColor = HIGHLIGHT;
      timers.push(
        window.setTimeout(() => {
          element.style.transition = `background-color ${FADE_MS}ms ease-out`;
          element.style.backgroundColor = '';
        }, HOLD_MS),
        window.setTimeout(() => {
          element.style.transition = '';
        }, HOLD_MS + FADE_MS)
      );
    });

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      element.style.backgroundColor = '';
      element.style.transition = '';
    };
  }, [shortId]);

  return null;
}
