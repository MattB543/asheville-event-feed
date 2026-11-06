// What the playlist page reads, kept apart from the weekly job so the page doesn't load Spotify and the AI clients.
import { OFFICIAL_TAGS_SET } from '@/lib/config/tagCategories';

export const WINDOW_DAYS = 8; // Sunday through the next Sunday

/** The show's genre: official tags are broad ("Live Music"), so the AI's own first tag */
export function mainGenre(tags: string[] | null): string | null {
  return (tags ?? []).find((tag) => !OFFICIAL_TAGS_SET.has(tag)) ?? null;
}
