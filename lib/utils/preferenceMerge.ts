/** How this device's preference lists merge with the account's saved copy (usePreferenceSync). */

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

export function mergePreferences(
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

export function samePreferences(a: UserPreferencesData, b: UserPreferencesData): boolean {
  return (
    sameList(a.blockedHosts, b.blockedHosts, identity) &&
    sameList(a.blockedKeywords, b.blockedKeywords, identity) &&
    sameList(a.hiddenEvents, b.hiddenEvents, hiddenEventKey) &&
    sameList(a.favoritedEventIds, b.favoritedEventIds, identity)
  );
}
