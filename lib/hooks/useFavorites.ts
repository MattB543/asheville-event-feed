'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'favoritedEventIds';
const EMPTY_FAVORITES: string[] = [];

/**
 * Module-level favorites store.
 *
 * A plain `useState` hook would give every component its own copy, so a favorite
 * toggled in the detail modal would never reach the feed's hearts. This store keeps
 * one array shared by every subscriber in the document, wraps localStorage, and owns
 * the single toggle that talks to `/api/events/[id]/favorite`.
 */
let favoriteIds: string[] = readStoredFavorites();
const listeners = new Set<() => void>();

interface PendingToggleState {
  tail: Promise<unknown>;
  confirmed: boolean;
  version: number;
}
const pendingToggles = new Map<string, PendingToggleState>();

function readStoredFavorites(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string')));
  } catch {
    return [];
  }
}

function writeStoredFavorites(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore quota / private-mode errors
  }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function setFavorites(ids: string[], persist = true): void {
  favoriteIds = ids;
  if (persist) writeStoredFavorites(ids);
  notify();
}

function setFavoriteMembership(eventId: string, isFavorited: boolean): void {
  const next = isFavorited
    ? Array.from(new Set([...favoriteIds, eventId]))
    : favoriteIds.filter((id) => id !== eventId);
  setFavorites(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string[] {
  return favoriteIds;
}

function getServerSnapshot(): string[] {
  return EMPTY_FAVORITES;
}

export interface ToggleFavoriteResult {
  isFavorited: boolean;
  /** Authoritative count returned by the endpoint, when it provided one. */
  favoriteCount: number | null;
}

/**
 * Toggle a favorite for everyone reading the store.
 *
 * Applies the change optimistically, then rolls back BOTH the store and localStorage
 * if the request fails or returns a non-2xx status. Throws on failure so callers can
 * surface an error; displayed counts are only changed from successful responses.
 */
async function sendToggle(eventId: string, desired: boolean): Promise<ToggleFavoriteResult> {
  const response = await fetch(`/api/events/${eventId}/favorite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: desired ? 'add' : 'remove' }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update favorite (${response.status})`);
  }

  const data = (await response.json().catch(() => ({}))) as { favoriteCount?: number };

  return {
    isFavorited: desired,
    favoriteCount: typeof data.favoriteCount === 'number' ? data.favoriteCount : null,
  };
}

export function toggleFavorite(eventId: string): Promise<ToggleFavoriteResult> {
  // Keep the latest click optimistic immediately, while serializing network
  // writes for this event. The confirmed state lets a failed final operation
  // roll back correctly even when earlier queued operations succeeded/failed.
  let state = pendingToggles.get(eventId);
  if (!state) {
    state = {
      tail: Promise.resolve(),
      confirmed: favoriteIds.includes(eventId),
      version: 0,
    };
    pendingToggles.set(eventId, state);
  }

  const desired = !favoriteIds.includes(eventId);
  const version = ++state.version;
  setFavoriteMembership(eventId, desired);

  const operation = state.tail.catch(() => undefined).then(() => sendToggle(eventId, desired));
  state.tail = operation;

  void operation.then(
    () => {
      state.confirmed = desired;
      if (state.version === version) {
        setFavoriteMembership(eventId, desired);
        pendingToggles.delete(eventId);
      }
    },
    () => {
      if (state.version === version) {
        setFavoriteMembership(eventId, state.confirmed);
        pendingToggles.delete(eventId);
      }
    }
  );

  return operation;
}

/** Replace the whole list (used by preference sync when merging server state). */
export function replaceFavorites(ids: string[]): void {
  setFavorites(Array.from(new Set(ids)));
}

/**
 * Subscribe a component to the shared favorites list.
 */
export function useFavorites(): {
  favoriteIds: string[];
  toggleFavorite: (eventId: string) => Promise<ToggleFavoriteResult>;
} {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { favoriteIds: ids, toggleFavorite };
}
