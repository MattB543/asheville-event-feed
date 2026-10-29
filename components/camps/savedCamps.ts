'use client';

import { useSyncExternalStore } from 'react';

/**
 * Saved camps (the star) and the browser's calendar token, kept in localStorage: no account
 * (01 §4.4). One store for the whole document, like lib/hooks/useFavorites.ts, so every star and
 * the directory's "Saved" filter agree.
 *
 * Once the browser has subscribed to its saved-camps calendar, every save or unsave also rewrites
 * that calendar's row (POST /api/camps/calendar with the token), so the subscribed URL never
 * changes. Until a rewrite succeeds the list is marked unsynced in localStorage, and the rewrite
 * is retried on the next page load and when the browser comes back online.
 */

const SAVED_KEY = 'avlgo:camps:saved';
const TOKEN_KEY = 'avlgo:camps:calendarToken';
const UNSYNCED_KEY = 'avlgo:camps:calendarUnsynced';

/** The calendar row matches the list; a rewrite is on its way; or the last rewrite failed. */
export type CalendarSync = 'synced' | 'pending' | 'failed';

interface SavedState {
  ids: string[];
  token: string | null;
  sync: CalendarSync;
}

const EMPTY: SavedState = { ids: [], token: null, sync: 'synced' };

let state: SavedState = readStored();
const listeners = new Set<() => void>();

function readStored(): SavedState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    const ids = Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))]
      : [];
    const token = localStorage.getItem(TOKEN_KEY);
    const unsynced = !!token && localStorage.getItem(UNSYNCED_KEY) === '1';
    return { ids, token, sync: unsynced ? 'pending' : 'synced' };
  } catch {
    return EMPTY;
  }
}

function setState(next: SavedState): void {
  state = next;
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(next.ids));
    if (next.token) localStorage.setItem(TOKEN_KEY, next.token);
    if (next.sync === 'synced') localStorage.removeItem(UNSYNCED_KEY);
    else localStorage.setItem(UNSYNCED_KEY, '1');
  } catch {
    // Private mode or full storage: saved for this visit only.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  watchConnection();
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
/** Writes queued or in flight. While the first one is creating the calendar there's no token yet. */
let queuedWrites = 0;

async function writeCalendar(): Promise<string> {
  const ids = state.ids;
  const response = await fetch('/api/camps/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: state.token, campIds: ids }),
  });
  const data = (await response.json().catch(() => ({}))) as { token?: string };
  if (!response.ok || typeof data.token !== 'string') {
    throw new Error(`Calendar save failed (${response.status})`);
  }
  // Still pending when the list changed while this one was in flight: the next write sends it
  setState({ ...state, token: data.token, sync: state.ids === ids ? 'synced' : state.sync });
  return data.token;
}

function queueCalendarWrite(): Promise<string> {
  queuedWrites += 1;
  const write = calendarWrite.catch(() => undefined).then(writeCalendar);
  calendarWrite = write;
  write
    .catch(() => {
      if (state.token) setState({ ...state, sync: 'failed' });
    })
    .finally(() => {
      queuedWrites -= 1;
    });
  return write;
}

/** Rewrite the calendar row when it is behind the list (a failed or interrupted save). */
export function retryCalendarSync(): void {
  if (!state.token || state.sync === 'synced') return;
  setState({ ...state, sync: 'pending' });
  queueCalendarWrite().catch((error) => console.error('[Camps] Calendar update failed:', error));
}

let watching = false;

/** On the first subscriber: retry an unsynced list now, and whenever the browser is back online. */
function watchConnection(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('online', retryCalendarSync);
  retryCalendarSync();
}

export function toggleSavedCamp(campId: string): void {
  const ids = state.ids.includes(campId)
    ? state.ids.filter((id) => id !== campId)
    : [...state.ids, campId];
  // A calendar that is still being created gets the change too, written once its token is back
  const hasCalendar = !!state.token || queuedWrites > 0;
  setState({ ...state, ids, sync: hasCalendar ? 'pending' : 'synced' });
  if (hasCalendar) {
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
