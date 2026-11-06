import { describe, expect, it } from 'vitest';
import { mergePreferences, type UserPreferencesData } from './preferenceMerge';

const prefs = (favoritedEventIds: string[], over: Partial<UserPreferencesData> = {}) => ({
  blockedHosts: [],
  blockedKeywords: [],
  hiddenEvents: [],
  favoritedEventIds,
  ...over,
});
const favorites = (merged: UserPreferencesData) => [...merged.favoritedEventIds].sort();

describe('syncing preferences between devices', () => {
  it('keeps a favorite another device cleared cleared, instead of putting it back', () => {
    // This device last synced [a, b]; the phone has since removed b
    const merged = mergePreferences(prefs(['a', 'b']), prefs(['a', 'b']), prefs(['a']));
    expect(favorites(merged)).toEqual(['a']);
  });

  it('applies what this device added and removed since its last sync', () => {
    const merged = mergePreferences(prefs(['a', 'b']), prefs(['b', 'c']), prefs(['a', 'b', 'd']));
    expect(favorites(merged)).toEqual(['b', 'c', 'd']);
  });

  it('adds signed-out favorites to the account on a first sign-in', () => {
    const merged = mergePreferences(null, prefs(['local']), prefs(['saved']));
    expect(favorites(merged)).toEqual(['local', 'saved']);
  });

  it('matches hidden events whatever their capitalisation', () => {
    const hidden = (title: string) => ({ hiddenEvents: [{ title, organizer: 'Grey Eagle' }] });
    const merged = mergePreferences(
      prefs([], hidden('Trivia Night')),
      prefs([]),
      prefs([], hidden('TRIVIA NIGHT'))
    );
    expect(merged.hiddenEvents).toEqual([]);
  });
});
