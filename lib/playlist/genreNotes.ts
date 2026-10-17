import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { genreNotes } from '@/lib/db/schema';
import { parseJsonFromModel } from '@/lib/ai/provider-clients';
import { OFFICIAL_TAGS_SET } from '@/lib/config/tagCategories';
import { playlistAiText } from './match';

/** The show's genre: official tags are broad ("Live Music"), so the AI's own first tag */
export function mainGenre(tags: string[] | null): string | null {
  return (tags ?? []).find((tag) => !OFFICIAL_TAGS_SET.has(tag)) ?? null;
}

const GENRE_SYSTEM = `You explain music genre names to people browsing local concert listings.
For each genre in the JSON array, decide whether a typical concertgoer already knows it.
Well-known genres (rock, jazz, bluegrass, indie folk, hip hop, country, punk, blues...) get null.
Unusual or niche ones get one plain sentence under 90 characters saying what it sounds like,
with no lead-in like "A genre that". Example: "Zydeco" -> "Accordion-led dance music from Louisiana's Creole communities."
Answer {"notes": {"<genre exactly as given>": "<sentence>" | null, ...}}.`;

/**
 * Makes sure each genre has a saved note (or a saved "needs none"), asking the AI
 * once about the ones never seen. A failed call just leaves them for next time.
 */
export async function explainGenres(genres: string[]): Promise<void> {
  const unique = [...new Set(genres.filter(Boolean))];
  if (unique.length === 0) return;
  const known = await db
    .select({ genre: genreNotes.genre })
    .from(genreNotes)
    .where(inArray(genreNotes.genre, unique));
  const knownSet = new Set(known.map((row) => row.genre));
  const missing = unique.filter((genre) => !knownSet.has(genre));
  if (missing.length === 0) return;

  try {
    const raw = await playlistAiText(GENRE_SYSTEM, JSON.stringify(missing));
    const notes = parseJsonFromModel<{ notes?: Record<string, unknown> }>(raw, 'object')?.notes;
    if (!notes) return;
    const rows = missing
      .filter((genre) => genre in notes)
      .map((genre) => {
        const note = notes[genre];
        return { genre, note: typeof note === 'string' && note.trim() ? note.trim() : null };
      });
    if (rows.length) await db.insert(genreNotes).values(rows).onConflictDoNothing();
  } catch (error) {
    console.warn('[Playlist] Genre notes skipped:', error);
  }
}
