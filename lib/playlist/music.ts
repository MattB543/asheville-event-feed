// Which events count as music shows. No server imports, so event pages can use it
// to decide whether to look for a song at all.

// Sources that only host music. HARRAHS is left out: it also hosts wrestling and
// family shows, so it needs a music tag like any mixed source.
const MUSIC_SOURCES = new Set(['ORANGE_PEEL', 'GREY_EAGLE', 'LIVE_MUSIC_AVL']);
const MUSIC_TAG_HINTS = ['music', 'concert', 'band', 'live'];
const EXCLUDE_TAGS = new Set([
  'pro wrestling',
  'wrestling',
  'stand-up',
  'stand up',
  'stand-up comedy',
]);

// Keeps festivals and ensembles from eating the candidate pool; the AI decides the rest
const NON_HEADLINER_RE =
  /\b(festival|fest|symphony|orchestra|philharmonic|chorus|choral|choir|chorale|musical|workshop|open mic|karaoke|drum circle|fundraiser)\b/i;

export function isMusicEvent(event: {
  source: string;
  title: string;
  tags?: string[] | null;
}): boolean {
  const tags = (event.tags ?? []).map((t) => t.toLowerCase());
  if (tags.some((t) => EXCLUDE_TAGS.has(t))) return false;
  if (NON_HEADLINER_RE.test(event.title)) return false;
  if (MUSIC_SOURCES.has(event.source)) return true;
  return tags.some((t) => MUSIC_TAG_HINTS.some((hint) => t.includes(hint)));
}
