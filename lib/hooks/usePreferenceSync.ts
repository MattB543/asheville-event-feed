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

/**
 * Merge local and remote preferences
 * Strategy: Union arrays to preserve all user choices
 */
function mergePreferences(
  local: UserPreferencesData,
  remote: UserPreferencesData
): UserPreferencesData {
  // Union arrays (deduplicate)
  const mergedBlockedHosts = [...new Set([...local.blockedHosts, ...remote.blockedHosts])];
  const mergedBlockedKeywords = [...new Set([...local.blockedKeywords, ...remote.blockedKeywords])];
  const mergedFavorites = [...new Set([...local.favoritedEventIds, ...remote.favoritedEventIds])];

  // Merge hidden events by fingerprint key
  const hiddenMap = new Map<string, HiddenEventFingerprint>();
  for (const event of [...remote.hiddenEvents, ...local.hiddenEvents]) {
    const key = `${event.title.toLowerCase()}|||${event.organizer.toLowerCase()}`;
    hiddenMap.set(key, event);
  }
  const mergedHiddenEvents = Array.from(hiddenMap.values());

  return {
    blockedHosts: mergedBlockedHosts,
    blockedKeywords: mergedBlockedKeywords,
    hiddenEvents: mergedHiddenEvents,
    favoritedEventIds: mergedFavorites,
  };
}

/**
 * Hook to sync preferences with database when user is logged in.
 * Works alongside existing localStorage logic in EventFeed.
 *
 * - On login: Fetches from DB via API, merges with localStorage, updates state
 * - On preference change (when logged in): Debounced save to DB via API
 * - On logout: Keeps localStorage (anonymous usage continues)
 */
export function usePreferenceSync(callbacks: PreferenceSyncCallbacks) {
  const { user, isLoading: authLoading } = useAuth();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncedUserRef = useRef<string | null>(null);
  const isSyncingRef = useRef(false);

  // Get current preferences from localStorage via callbacks
  const getCurrentPreferences = useCallback((): UserPreferencesData => {
    return {
      blockedHosts: callbacks.getBlockedHosts(),
      blockedKeywords: callbacks.getBlockedKeywords(),
      hiddenEvents: callbacks.getHiddenEvents(),
      favoritedEventIds: callbacks.getFavoritedEventIds(),
    };
  }, [callbacks]);

  // Apply merged preferences to state
  const applyPreferences = useCallback(
    (prefs: UserPreferencesData) => {
      callbacks.setBlockedHosts(prefs.blockedHosts);
      callbacks.setBlockedKeywords(prefs.blockedKeywords);
      callbacks.setHiddenEvents(prefs.hiddenEvents);
      callbacks.setFavoritedEventIds(prefs.favoritedEventIds);
    },
    [callbacks]
  );

  // Sync preferences on login
  useEffect(() => {
    if (authLoading) return;

    const syncOnLogin = async () => {
      if (!user) {
        // User logged out - keep localStorage as is
        lastSyncedUserRef.current = null;
        return;
      }

      // Prevent duplicate syncs for same user
      if (lastSyncedUserRef.current === user.id) {
        return;
      }

      isSyncingRef.current = true;

      try {
        // Fetch from API
        const response = await fetch('/api/preferences');
        if (!response.ok) {
          throw new Error('Failed to fetch preferences');
        }

        const { preferences: remotePrefs } = (await response.json()) as PreferencesResponse;
        const localPrefs = getCurrentPreferences();

        if (remotePrefs) {
          // Merge local and remote
          const merged = mergePreferences(localPrefs, remotePrefs);
          applyPreferences(merged);

          // Save merged back to DB
          await fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences: merged }),
          });
        } else {
          // No remote prefs yet - save current local to DB
          await fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences: localPrefs }),
          });
        }

        lastSyncedUserRef.current = user.id;
      } catch (error) {
        console.error('Error syncing preferences on login:', error);
      } finally {
        isSyncingRef.current = false;
      }
    };

    void syncOnLogin();
  }, [user, authLoading, getCurrentPreferences, applyPreferences]);

  // Debounced save to DB when preferences change
  const saveToDatabase = useCallback(() => {
    if (!user || isSyncingRef.current) return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save to avoid too many API calls
    saveTimeoutRef.current = setTimeout(() => {
      void (async () => {
        try {
          const currentPrefs = getCurrentPreferences();
          await fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferences: currentPrefs }),
          });
        } catch (error) {
          console.error('Error saving preferences to database:', error);
        }
      })();
    }, 1000); // 1 second debounce
  }, [user, getCurrentPreferences]);

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
