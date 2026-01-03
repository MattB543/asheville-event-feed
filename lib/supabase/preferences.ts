import { db } from '@/lib/db';
import { userPreferences } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// Types matching localStorage structure
export interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

export interface UserPreferencesData {
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: HiddenEventFingerprint[];
  useDefaultFilters: boolean;
  favoritedEventIds: string[];
  filterSettings?: Record<string, unknown>;
  updatedAt?: Date;
}

// Default preferences
export const DEFAULT_PREFERENCES: UserPreferencesData = {
  blockedHosts: [],
  blockedKeywords: [],
  hiddenEvents: [],
  useDefaultFilters: true,
  favoritedEventIds: [],
};

/**
 * Get user preferences from database
 */
export async function getUserPreferences(userId: string): Promise<UserPreferencesData | null> {
  try {
    const result = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      blockedHosts: row.blockedHosts ?? [],
      blockedKeywords: row.blockedKeywords ?? [],
      hiddenEvents: (row.hiddenEvents as HiddenEventFingerprint[]) ?? [],
      useDefaultFilters: row.useDefaultFilters ?? true,
      favoritedEventIds: row.favoritedEventIds ?? [],
      filterSettings: row.filterSettings as Record<string, unknown> | undefined,
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return null;
  }
}

/**
 * Save user preferences to database (upsert)
 */
export async function saveUserPreferences(
  userId: string,
  prefs: Partial<UserPreferencesData>
): Promise<boolean> {
  try {
    await db
      .insert(userPreferences)
      .values({
        userId,
        blockedHosts: prefs.blockedHosts ?? [],
        blockedKeywords: prefs.blockedKeywords ?? [],
        hiddenEvents: prefs.hiddenEvents ?? [],
        useDefaultFilters: prefs.useDefaultFilters ?? true,
        favoritedEventIds: prefs.favoritedEventIds ?? [],
        filterSettings: prefs.filterSettings,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          blockedHosts: prefs.blockedHosts,
          blockedKeywords: prefs.blockedKeywords,
          hiddenEvents: prefs.hiddenEvents,
          useDefaultFilters: prefs.useDefaultFilters,
          favoritedEventIds: prefs.favoritedEventIds,
          filterSettings: prefs.filterSettings,
          updatedAt: new Date(),
        },
      });
    return true;
  } catch (error) {
    console.error('Error saving user preferences:', error);
    return false;
  }
}

/**
 * Merge local and remote preferences
 * Strategy: Union arrays, prefer local for booleans (user's current intent)
 */
export function mergePreferences(
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
    useDefaultFilters: local.useDefaultFilters, // Prefer local (user's current choice)
    favoritedEventIds: mergedFavorites,
    filterSettings: local.filterSettings ?? remote.filterSettings,
  };
}
