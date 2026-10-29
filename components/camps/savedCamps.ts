'use client';

import { useSyncExternalStore } from 'react';

/**
 * Saved camps (the star) and the browser's calendar token, kept in localStorage: no account
 * (01 §4.4). One store for the whole document, like lib/hooks/useFavorites.ts, so every star and
 * the directory's "Saved" filter agree.
 *
 * Once the browser has subscribed to its saved-camps calendar, every save or unsave also rewrites
 * that calendar's row (POST /api/camps/calendar with the token), so the subscribed URL never
 * changes.
 */

const SAVED_KEY = 'avlgo:camps:saved';
const TOKEN_KEY = 'avlgo:camps:calendarToken';

interface SavedState {
  ids: string[];
  token: string | null;
}

const EMPTY: SavedState = { ids: [], token: null };

let state: SavedState = readStored();
const listeners = new Set<() => void>();

function readStored(): SavedState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    const ids = Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))]
      : [];
    return { ids, token: localStorage.getItem(TOKEN_KEY) };
  } catch {
    return EMPTY;
  }
}

function setState(next: SavedState): void {
  state = next;
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(next.ids));
    if (next.token) localStorage.setItem(TOKEN_KEY, next.token);
  } catch {
    // Private mode or full storage: saved for this visit only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSavedCamps(): SavedState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY
  );
}

/** Saves to the calendar row go one at a time, each sending the list as it is then. */
let calendarWrite: Promise<unknown> = Promise.resolve();

async function writeCalendar(): Promise<string> {
  const response = await fetch('/api/camps/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: state.token, campIds: state.ids }),
  });
  const data = (await response.json().catch(() => ({}))) as { token?: string };
  if (!response.ok || typeof data.token !== 'string') {
    throw new Error(`Calendar save failed (${response.status})`);
  }
  if (data.token !== state.token) setState({ ...state, token: data.token });
  return data.token;
}

function queueCalendarWrite(): Promise<string> {
  const write = calendarWrite.catch(() => undefined).then(writeCalendar);
  calendarWrite = write;
  return write;
}

export function toggleSavedCamp(campId: string): void {
  const ids = state.ids.includes(campId)
    ? state.ids.filter((id) => id !== campId)
    : [...state.ids, campId];
  setState({ ...state, ids });
  if (state.token) {
    queueCalendarWrite().catch((error) => console.error('[Camps] Calendar update failed:', error));
  }
}

/** Create (or refresh) this browser's saved-camps calendar; resolves with its token. */
export function subscribeSavedCamps(): Promise<string> {
  return queueCalendarWrite();
}

/** The feed's https URL; calendar apps get it as webcal:// or through Google's "add by URL". */
export function calendarFeedUrl(token: string): string {
  return `${window.location.origin}/api/camps/calendar/${token}.ics`;
}
