'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';

// Types matching the API
export interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

export interface UserPreferencesData {
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: HiddenEventFingerprint[];
  favoritedEventIds: string[];
}

interface PreferencesResponse {
  preferences?: UserPreferencesData | null;
}

interface PreferenceSyncCallbacks {
  // Getters - return current localStorage values
  getBlockedHosts: () => string[];
  getBlockedKeywords: () => string[];
  getHiddenEvents: () => HiddenEventFingerprint[];
  getFavoritedEventIds: () => string[];

  // Setters - update state (will trigger localStorage save via useEffect)
  setBlockedHosts: (hosts: string[]) => void;
  setBlockedKeywords: (keywords: string[]) => void;
  setHiddenEvents: (events: HiddenEventFingerprint[]) => void;
  setFavoritedEventIds: (ids: string[]) => void;
}

const SYNC_BASE_KEY_PREFIX = 'preferenceSyncBase:';

const identity = (value: string) => value;
const hiddenEventKey = (event: HiddenEventFingerprint) =>
  `${event.title.toLowerCase()}|||${event.organizer.toLowerCase()}`;

/**
 * Three-way merge of one list. `base` is the list as this device last saved or
 * loaded it, so an item in `local` but not `base` was added here since, and one
 * that left `local` was removed here; `remote` carries every other device's
 * changes. A plain union would let a stale device put back what another one
 * cleared. With no base (this device has never synced the account) it falls
 * back to a union, which is how signed-out favorites join the account.
 */
function mergeList<T>(base: T[] | null, local: T[], remote: T[], keyOf: (item: T) => string): T[] {
  const merged = new Map<string, T>();
  if (!base) {
    for (const item of [...remote, ...local]) merged.set(keyOf(item), item);
    return Array.from(merged.values());
  }

  const baseKeys = new Set(base.map(keyOf));
  const localKeys = new Set(local.map(keyOf));
  for (const item of remote) {
    const key = keyOf(item);
    const removedHere = baseKeys.has(key) && !localKeys.has(key);
    if (!removedHere) merged.set(key, item);
  }
  for (const item of local) {
    if (!baseKeys.has(keyOf(item))) merged.set(keyOf(item), item);
  }
  return Array.from(merged.values());
}

function mergePreferences(
  base: UserPreferencesData | null,
  local: UserPreferencesData,
  remote: UserPreferencesData
): UserPreferencesData {
  return {
    blockedHosts: mergeList(
      base?.blockedHosts ?? null,
      local.blockedHosts,
      remote.blockedHosts,
      identity
    ),
    blockedKeywords: mergeList(
      base?.blockedKeywords ?? null,
      local.blockedKeywords,
      remote.blockedKeywords,
      identity
    ),
    hiddenEvents: mergeList(
      base?.hiddenEvents ?? null,
      local.hiddenEvents,
      remote.hiddenEvents,
      hiddenEventKey
    ),
    favoritedEventIds: mergeList(
      base?.favoritedEventIds ?? null,
      local.favoritedEventIds,
      remote.favoritedEventIds,
      identity
    ),
  };
}

function sameList<T>(a: T[], b: T[], keyOf: (item: T) => string): boolean {
  const aKeys = new Set(a.map(keyOf));
  const bKeys = new Set(b.map(keyOf));
  return aKeys.size === bKeys.size && [...bKeys].every((key) => aKeys.has(key));
}

function samePreferences(a: UserPreferencesData, b: UserPreferencesData): boolean {
  return (
    sameList(a.blockedHosts, b.blockedHosts, identity) &&
    sameList(a.blockedKeywords, b.blockedKeywords, identity) &&
    sameList(a.hiddenEvents, b.hiddenEvents, hiddenEventKey) &&
    sameList(a.favoritedEventIds, b.favoritedEventIds, identity)
  );
}

// The merge base is per account, so a second account signing in on this device
// starts from a union rather than from someone else's last sync
function readSyncBase(userId: string): UserPreferencesData | null {
  try {
    const saved = localStorage.getItem(SYNC_BASE_KEY_PREFIX + userId);
    return saved ? (JSON.parse(saved) as UserPreferencesData) : null;
  } catch {
    return null;
  }
}

function writeSyncBase(userId: string, prefs: UserPreferencesData): void {
  try {
    localStorage.setItem(SYNC_BASE_KEY_PREFIX + userId, JSON.stringify(prefs));
  } catch {
    // Ignore quota / private-mode errors; the next sync falls back to a union
  }
}

/**
 * Hook to sync preferences with database when user is logged in.
 * Works alongside existing localStorage logic in EventFeed.
 *
 * - On login: Fetches from DB via API, merges with localStorage, updates state
 * - On preference change (when logged in): Debounced merge-and-save via API
 * - On logout: Keeps localStorage (anonymous usage continues)
 */
export function usePreferenceSync(callbacks: PreferenceSyncCallbacks) {
  const { user, isLoading: authLoading } = useAuth();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncedUserRef = useRef<string | null>(null);
  const isSyncingRef = useRef(false);

  // Callers pass fresh inline callbacks every render; keep them in a ref so the
  // sync effect doesn't re-run (and re-fire GET+POST) on every parent render.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Get current preferences from localStorage via callbacks
  const getCurrentPreferences = useCallback((): UserPreferencesData => {
    const current = callbacksRef.current;
    return {
      blockedHosts: current.getBlockedHosts(),
      blockedKeywords: current.getBlockedKeywords(),
      hiddenEvents: current.getHiddenEvents(),
      favoritedEventIds: current.getFavoritedEventIds(),
    };
  }, []);

  // Apply merged preferences to state
  const applyPreferences = useCallback((prefs: UserPreferencesData) => {
    const current = callbacksRef.current;
    current.setBlockedHosts(prefs.blockedHosts);
    current.setBlockedKeywords(prefs.blockedKeywords);
    current.setHiddenEvents(prefs.hiddenEvents);
    current.setFavoritedEventIds(prefs.favoritedEventIds);
  }, []);

  // Fetch the server copy, fold in what changed on this device since it last
  // synced, and save the result when it differs. Saves go through here too, so a
  // device holding an old copy can't overwrite changes made elsewhere.
  const syncWithServer = useCallback(
    async (userId: string) => {
      isSyncingRef.current = true;
      try {
        const response = await fetch('/api/preferences');
        if (!response.ok) {
          throw new Error('Failed to fetch preferences');
        }

        const { preferences: remotePrefs } = (await response.json()) as PreferencesResponse;
        const localPrefs = getCurrentPreferences();
        const merged = remotePrefs
          ? mergePreferences(readSyncBase(userId), localPrefs, remotePrefs)
          : localPrefs;

        if (!samePreferences(merged, localPrefs)) {
          applyPreferences(merged);
        }

        if (!remotePrefs || !samePreferences(merged, remotePrefs)) {
          const saved = await fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences: merged }),
          });
          if (!saved.ok) {
            throw new Error('Failed to save preferences');
          }
        }

        writeSyncBase(userId, merged);
      } finally {
        isSyncingRef.current = false;
      }
    },
    [getCurrentPreferences, applyPreferences]
  );

  // Sync preferences on login
  const userId = user?.id ?? null;
  useEffect(() => {
    if (authLoading) return;

    if (!userId) {
      // User logged out - keep localStorage as is
      lastSyncedUserRef.current = null;
      return;
    }

    // Prevent duplicate syncs for same user, or a parallel sync already in flight
    if (lastSyncedUserRef.current === userId || isSyncingRef.current) {
      return;
    }

    syncWithServer(userId).then(
      () => {
        lastSyncedUserRef.current = userId;
      },
      (error) => {
        console.error('Error syncing preferences on login:', error);
      }
    );
  }, [userId, authLoading, syncWithServer]);

  // Debounced save to DB when preferences change
  const saveToDatabase = useCallback(() => {
    if (!user || isSyncingRef.current) return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save to avoid too many API calls
    const saveUserId = user.id;
    const save = () => {
      // Don't overlap a sync still in flight; try again once it has had time
      if (isSyncingRef.current) {
        saveTimeoutRef.current = setTimeout(save, 1000);
        return;
      }
      syncWithServer(saveUserId).catch((error) => {
        console.error('Error saving preferences to database:', error);
      });
    };
    saveTimeoutRef.current = setTimeout(save, 1000); // 1 second debounce
  }, [user, syncWithServer]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    saveToDatabase,
    isLoggedIn: !!user,
  };
}
