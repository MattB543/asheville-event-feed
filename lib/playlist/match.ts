import {
  azureChatCompletion,
  isAzureAIEnabled,
  parseJsonFromModel,
} from '@/lib/ai/provider-clients';
import { env } from '@/lib/config/env';
import { normalizeName } from '@/lib/utils/venueName';
import { getTrack, searchTracks, type SpotifyArtist, type SpotifyTrack } from './spotify';
import { fetchWithRetry } from '@/lib/utils/retry';

// Ported from the avlgo-playlist script, which ran these rules for months; keep
// them in step with it until that script is retired.

export interface PlaylistEvent {
  id: string;
  title: string;
  source: string;
  tags: string[] | null;
  description: string | null;
  aiSummary: string | null;
  url: string;
  location: string | null;
  organizer: string | null;
  startDate: Date;
  score: number | null;
}

const SKIP_REASONS = ['tribute', 'non_headliner', 'non_music', 'ambiguous'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** A stored or model-supplied reason, falling back to 'ambiguous' for anything else. */
export function toSkipReason(value: unknown): SkipReason {
  return SKIP_REASONS.find((r) => r === value) ?? 'ambiguous';
}

export type Classification = { artist: string } | { skip: SkipReason; reason: string };

export interface TrackMatch {
  trackId: string | null;
  trackName: string | null;
  spotifyArtist: string | null;
  note: string;
}

const SPOTIFY_TRACK_LINK_RE = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]+)/;

const CLASSIFY_SYSTEM = `You classify live-event titles to decide if each is a SINGLE-ACT HEADLINING music concert that belongs on a weekly Spotify playlist of upcoming Asheville shows.

For each input event, return either the headlining artist's canonical name OR a skip reason.

Artist name rules (IMPORTANT - this string is fed to Spotify search):
- Preserve diacritics and special characters exactly (e.g. 'Shavorã' not 'Shavora', 'Sigur Rós' not 'Sigur Ros', 'Beyoncé' not 'Beyonce').
- Use the canonical Spotify form when known (e.g. 'The Beatles' not 'Beatles', 'Yo La Tengo' not 'YO LA TENGO').
- Strip event/show/tour decoration but KEEP the artist name as-is - 'Shavorã: Roots & Wings Tour' → 'Shavorã'; 'Wonky Tonk - A psychedelic exploration of country classics' → 'Wonky Tonk'; 'Pisgah Brewing Presents Unspoken Tradition' → 'Unspoken Tradition'; 'Patterson Hood (of Drive-By Truckers)' → 'Patterson Hood'.
- For mixed bills ('Headliner w/ Opener', 'Artist A / Artist B'), return the FIRST (headlining) artist.
- Strip ad-hoc backing-band suffixes ('& The Sweet Critters', 'and his Friends') UNLESS the suffix is part of the canonical Spotify name (KEEP 'Dave Matthews Band', 'Ben Folds Five', 'Tedeschi Trucks Band', 'Tank and The Bangas'). When unsure, return the shorter form.

Skip categories:
- tribute: tribute/cover band performing another artist's catalog
- non_headliner: festival, multi-act bill with no clear headliner, classical ensemble (symphony/orchestra/choir/chorale), workshop, open mic, karaoke, drum circle, fundraiser, recurring dance class
- non_music: not actually a music concert (theater, book reading, sports, comedy, food event) even if music-tagged
- ambiguous: title is a thematic show/event name, NOT a real artist on Spotify (e.g. 'Save Me the Waltz' is a literary tribute to Zelda Fitzgerald, not a band). When in doubt about whether a name IS a real artist - assume it is and return it.

Return ONLY a JSON object {"results": [...]} with one entry per input, in the same order, each shaped as either {"artist": "..."} or {"skip": "tribute|non_headliner|non_music|ambiguous", "reason": "short explanation"}.`;

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/** The playlist can classify with either; Haiku is what the original script used. */
export function isClassifierEnabled(): boolean {
  return !!env.ANTHROPIC_API_KEY || isAzureAIEnabled();
}

async function haikuCompletion(system: string, user: string): Promise<string> {
  const response = await fetchWithRetry(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    },
    // One batched call for every title, so it gets longer than the default per try
    { timeoutMs: 60_000, maxRetries: 2 }
  );
  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

/** One AI call answered in JSON: Claude Haiku when ANTHROPIC_API_KEY is set, otherwise Azure */
export async function playlistAiText(system: string, user: string): Promise<string> {
  if (env.ANTHROPIC_API_KEY) return haikuCompletion(system, user);
  // The token cap counts the model's reasoning too, so it needs room beyond the answer
  const reply = await azureChatCompletion(system, user, {
    maxTokens: 16000,
    jsonMode: true,
    reasoningEffort: 'low',
  });
  return reply?.content ?? '';
}

/**
 * One batched AI call: Claude Haiku when ANTHROPIC_API_KEY is set, otherwise
 * Azure. Returns null when the call fails or the answer doesn't line up with the
 * input, so the caller can avoid saving a guess.
 */
export async function classifyTitles(events: PlaylistEvent[]): Promise<Classification[] | null> {
  if (events.length === 0) return [];
  const payload = events.map((e) => ({
    title: e.title,
    tags: e.tags ?? [],
    summary: (e.aiSummary ?? '').slice(0, 200),
  }));
  try {
    const raw = await playlistAiText(CLASSIFY_SYSTEM, JSON.stringify(payload));
    const parsed = parseJsonFromModel<{ results?: unknown }>(raw, 'object');
    const results = parsed?.results;
    if (!Array.isArray(results) || results.length !== events.length) return null;
    return results.map((r): Classification => {
      const item = r as { artist?: unknown; skip?: unknown; reason?: unknown };
      if (typeof item.artist === 'string' && item.artist.trim()) return { artist: item.artist };
      return {
        skip: toSkipReason(item.skip),
        reason: typeof item.reason === 'string' ? item.reason : '',
      };
    });
  } catch (error) {
    console.error('[Playlist] Classifier call failed:', error);
    return null;
  }
}

function credits(artists: SpotifyArtist[]): string {
  return artists.map((a) => a.name).join(', ');
}

// Returns the track, or a note on why nothing matched
async function searchTrackForArtist(
  artistName: string
): Promise<{ track: SpotifyTrack; kind: 'primary' | 'feature' } | string> {
  // Unquoted field filter: quoting it turns off Spotify's popularity ranking
  let items = await searchTracks(`artist:${artistName}`);
  // Freeform fallback for names the field filter chokes on, e.g. "Curren$y"
  if (items.length === 0) items = await searchTracks(artistName);
  if (items.length === 0) return `no Spotify tracks for '${artistName}'`;

  const target = normalizeName(artistName);
  // Only the query-inside-Spotify-name direction: the reverse matched "Save Me
  // the Waltz" to an unrelated band called "save me."
  // Whole words only, so "dan" doesn't match "daniel caesar". A duo credited as two
  // people ("Dan Reeder, Peggy Reeder") matches when one full name is in the act's
  const targetWords = new Set(target.split(' '));
  const matches = (candidate: string) => {
    if (!target || !candidate) return false;
    if (` ${candidate} `.includes(` ${target} `)) return true;
    const words = candidate.split(' ');
    return words.length >= 2 && words.every((w) => targetWords.has(w));
  };

  let feature: SpotifyTrack | null = null;
  for (const track of items) {
    const names = track.artists.map((a) => normalizeName(a.name));
    if (names.length === 0) continue;
    if (matches(names[0])) return { track, kind: 'primary' };
    if (!feature && names.some(matches)) feature = track;
  }
  if (feature) return { track: feature, kind: 'feature' };
  const top = items[0];
  return `no track credits matched '${artistName}' (top hit: '${top.name}' by ${credits(top.artists)})`;
}

export async function findTrack(event: PlaylistEvent, artist: string): Promise<TrackMatch> {
  // An explicit track link in the listing beats any search
  for (const field of [event.description, event.aiSummary, event.url]) {
    const link = field?.match(SPOTIFY_TRACK_LINK_RE);
    if (link) {
      const track = await getTrack(link[1]);
      if (track) {
        return {
          trackId: track.id,
          trackName: track.name,
          spotifyArtist: track.artists[0]?.name ?? null,
          note: `link: track ${track.id}`,
        };
      }
    }
  }

  // A backing-band suffix Spotify doesn't use ("Caleb Caudle & The Sweet Critters")
  // gets a second try without it; "Dan and Peggy Reeder" is one act, so it doesn't
  const candidates = [artist];
  const short = artist.split(/\s+(?:&|and)\s+(?:the|his|her)\s+/i)[0];
  if (short && short !== artist) candidates.push(short);

  let lastNote = '';
  for (const query of candidates) {
    const hit = await searchTrackForArtist(query);
    if (typeof hit !== 'string') {
      return {
        trackId: hit.track.id,
        trackName: hit.track.name,
        spotifyArtist: hit.track.artists[0]?.name ?? null,
        note: `search: '${query}' → '${hit.track.name}' by ${credits(hit.track.artists)} (${hit.kind})`,
      };
    }
    lastNote = hit;
  }
  return { trackId: null, trackName: null, spotifyArtist: null, note: lastNote };
}

/**
 * Spotify's playlist description. Spotify already shows each song's artist, so it
 * just says what this is and where the lineup lives, written short for people to type.
 */
export function playlistDescription(pageUrl: string): string {
  const shortUrl = pageUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return `One song from each headliner playing Asheville this week. Dates and tickets: ${shortUrl}`;
}
