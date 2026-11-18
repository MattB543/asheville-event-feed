/**
 * The daily head-to-head pass for the Top 30 "Meet people" and "Asheville weird" lists.
 *
 * Every event gets a 1-10 social and weird score when it is first scored, on its own.
 * That is good enough to pick candidates and too coarse to order them: on 2026-11-18,
 * 90 events tied at social 8, and the tie was broken by overall score, so the list was
 * mostly the biggest club nights. Here one AI call per list reads the candidates side by
 * side and puts the best in order. The order is saved in `top30_ranks` and
 * `queryTop30CategoryEvents` lists ranked events first.
 *
 * The overall list is not ranked this way: it is the score.
 */

import { and, asc, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { events, top30Ranks } from '@/lib/db/schema';
import {
  buildTop30BaseWhere,
  TOP30_CATEGORY_SCORE,
  type RankedTop30Category,
} from '@/lib/db/queries/events';
import { azureChatCompletion, parseJsonFromModel } from '@/lib/ai/provider-clients';
import {
  getEventOccurrences,
  mergeTop30CategoryEvents,
  normalizeTop30KeyPart,
} from '@/lib/utils/top30Ranking';

export const RANKED_CATEGORIES: RankedTop30Category[] = ['social', 'weird'];

// Candidates need this overall score (Matt, 2026-11-18). It keeps out listings that fit a
// list but are thin (a 9/30 dinner meetup) without favoring big events: past this bar,
// size and fame count for nothing.
const MIN_OVERALL_SCORE = 13;
// The best this many by the list's own score are compared
const MAX_CANDIDATES = 120;
// Event rows read to find them: a multi-day run or a weekly event is several rows, one candidate
const CANDIDATE_ROWS = 400;
// How many the AI puts in order. The page shows 30; the rest keep a filtered list ranked.
const RANKED = 50;
// An answer with fewer than this share of the picks asked for is thrown away
const MIN_RANKED_SHARE = 0.8;

const LIST_BRIEF: Record<RankedTop30Category, string> = {
  social: `THE LIST: "Meet people" - where someone who turns up alone is most likely to end the night having talked with people they did not know.
What counts is what people do there:
- Best: the format itself mixes strangers. Rotating partners (social dances with a beginner lesson, speed dating, round-robin games), small hosted tables (supper clubs, hosted dinners), teams made up on the spot, facilitated introductions, groups that exist to welcome newcomers.
- Good: small gatherings held so people can meet and talk (potlucks, game nights, newcomer meetups, volunteer days, group hikes).
- Lower: classes and workshops where people mostly follow an instructor or work on their own project. Talking happens, but it is not the point.
- Weak, usually left out: events where people watch, listen, or dance with the friends they came with (concerts, club nights, DJ sets, discos, festivals, screenings, shows), however fun.
- Weak: gatherings for one narrow group that a newcomer could not simply join.`,
  weird: `THE LIST: "Asheville weird" - the strangest, most only-in-Asheville things on the calendar.
Weird means countercultural, boundary-pushing, artsy, queer, performative, ritualistic, subversive, bohemian, gloriously strange. The test: would a visitor do a double-take and say "only in Asheville"?
- Best: one-of-a-kind local oddities (underground puppet theater, experimental performance art, ritual theater, costumed parades and runs, bizarre local traditions, events with a premise you have to read twice).
- Good: distinctly alternative gatherings (fire spinning, ecstatic dance, trance and sound ceremonies, drag and burlesque, noise shows).
- Weak, usually left out: mainstream touring acts, benefit concerts, standard festivals and markets, tribute nights, however big. Also the merely cute, wholesome or hobbyist (pet events, bake-offs, craft classes).
- The same kind of event many times over (several sound baths, several drag brunches) should not fill the list: keep the most distinctive few.`,
};

function systemPrompt(category: RankedTop30Category, count: number): string {
  return `You are ranking events for AVL GO, an events site for Asheville, NC. From the numbered candidates, choose the best ${count} for one list and put them in order, best first.

${LIST_BRIEF[category]}

RULES
- Judge fit for this list and nothing else. Every candidate has already passed a quality bar, so size, fame and price do not matter: a 12-person night can outrank a 1,000-person party.
- Compare the candidates with each other. Go by what the title, host and description say actually happens, not by words like "community" or "connect".
- If two candidates are the same recurring event, or near-identical nights from the same host, keep only the one that happens first.
- "prev" is the event's place in yesterday's list, which was made the same way. Events without it are new. Keep yesterday's order unless there is a clear reason to change it: a new event that belongs above others, or a placement that is plainly wrong. Do not shuffle events for small differences.

Return only JSON: {"ranking": [candidate numbers, best first]}`;
}

/** One event to rank. A multi-day run is one entry holding each day's row. */
export interface RankEntry {
  title: string;
  organizer: string | null;
  startDate: Date;
  score: number | null;
  /** Its place in the saved list (matched by title, host and venue: a weekly event keeps its place) */
  previousRank: number | null;
  /** The event rows, soonest first */
  rows: { id: string; title: string }[];
}

export interface Top30Ranking {
  category: RankedTop30Category;
  /** How many entries were compared */
  candidates: number;
  /** The chosen entries, best first */
  ranked: RankEntry[];
}

const WHEN_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

async function loadCandidates(category: RankedTop30Category, fresh: boolean) {
  const categoryScore = TOP30_CATEGORY_SCORE[category];
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      location: events.location,
      startDate: events.startDate,
      timeUnknown: events.timeUnknown,
      price: events.price,
      aiSummary: events.aiSummary,
      score: events.score,
    })
    .from(events)
    .where(
      and(buildTop30BaseWhere(), isNotNull(categoryScore), gte(events.score, MIN_OVERALL_SCORE))
    )
    // Not by overall score: past the floor it must not decide who gets compared
    .orderBy(desc(categoryScore), asc(events.startDate), asc(events.id))
    .limit(CANDIDATE_ROWS);

  // The same event on another date has the same title, host and venue
  const eventKey = (e: { title: string; organizer: string | null; location: string | null }) =>
    [e.title, e.organizer, e.location?.split(',')[0]].map(normalizeTop30KeyPart).join('|');

  const saved = fresh
    ? []
    : await db
        .select({
          rank: top30Ranks.rank,
          title: top30Ranks.title,
          organizer: events.organizer,
          location: events.location,
        })
        .from(top30Ranks)
        .innerJoin(events, eq(events.id, top30Ranks.eventId))
        .where(eq(top30Ranks.category, category))
        .orderBy(desc(top30Ranks.rank));
  // Descending, so each event ends up with its best (lowest) rank
  const previousRank = new Map(saved.map((r) => [eventKey(r), r.rank]));

  // One entry per event: a multi-day run collapses the way the page collapses it, and
  // of a weekly event's dates only the soonest is ranked (the later ones stay in the
  // unranked part of the list).
  const titleOf = new Map(rows.map((r) => [r.id, r.title]));
  const strength = new Map(rows.map((r, i) => [r.id, i]));
  const byDate = [...rows].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const seen = new Set<string>();
  const entries = mergeTop30CategoryEvents(byDate)
    .filter((event) => {
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((event) => {
      const occurrences = getEventOccurrences(event);
      return {
        event,
        // An entry is as strong as its best-scored date
        strength: Math.min(...occurrences.map((o) => strength.get(o.id)!)),
        entry: {
          title: event.title,
          organizer: event.organizer,
          startDate: event.startDate,
          score: event.score,
          previousRank: previousRank.get(eventKey(event)) ?? null,
          rows: occurrences.map((o) => ({ id: o.id, title: titleOf.get(o.id)! })),
        } satisfies RankEntry,
      };
    })
    .sort((a, b) => a.strength - b.strength)
    .slice(0, MAX_CANDIDATES);

  // Yesterday's list in its order, then the new events, strongest first
  entries.sort(
    (a, b) =>
      (a.entry.previousRank ?? Infinity) - (b.entry.previousRank ?? Infinity) ||
      a.strength - b.strength
  );
  // Saved ranks have gaps (events that have passed, the extra days of a run): close them
  entries.forEach(({ entry }, i) => {
    if (entry.previousRank !== null) entry.previousRank = i + 1;
  });
  return entries;
}

/**
 * Rank one list. Reads only; `saveTop30Ranking` stores the result. `fresh` ranks without
 * the saved order, for after a change to the prompt: otherwise the AI is told to keep
 * yesterday's order unless it has a reason, so the list doesn't reshuffle every day.
 */
export async function rankTop30Category(
  category: RankedTop30Category,
  { fresh = false } = {}
): Promise<Top30Ranking> {
  const entries = await loadCandidates(category, fresh);
  if (entries.length === 0) return { category, candidates: 0, ranked: [] };

  const count = Math.min(RANKED, entries.length);
  const lines = entries.map(({ event, entry }, i) =>
    JSON.stringify({
      n: i + 1,
      title: event.title,
      host: event.organizer ?? undefined,
      venue: event.location?.split(',')[0] || undefined,
      when: (event.timeUnknown ? DAY_FORMAT : WHEN_FORMAT).format(event.startDate),
      price: event.price ?? undefined,
      about: event.aiSummary ?? undefined,
      prev: entry.previousRank ?? undefined,
    })
  );

  const response = await azureChatCompletion(
    systemPrompt(category, count),
    `${entries.length} candidates:\n${lines.join('\n')}`,
    {
      jsonMode: true,
      reasoningEffort: 'medium',
      maxTokens: 16000,
      timeoutMs: 180_000,
      maxRetries: 2,
    }
  );
  if (!response) throw new Error('Azure AI is not configured');
  if (response.finishReason === 'length') throw new Error(`${category}: the answer was cut off`);

  const parsed = parseJsonFromModel<{ ranking?: unknown }>(response.content, 'object');
  const numbers = Array.isArray(parsed?.ranking) ? parsed.ranking : [];
  const picked = new Set<number>();
  for (const n of numbers) {
    if (Number.isInteger(n) && n >= 1 && n <= entries.length) picked.add(n as number);
    if (picked.size === count) break;
  }
  if (picked.size < count * MIN_RANKED_SHARE) {
    throw new Error(
      `${category}: the AI ranked ${picked.size} of ${entries.length} candidates: ${response.content.slice(0, 200)}`
    );
  }

  return {
    category,
    candidates: entries.length,
    ranked: [...picked].map((n) => entries[n - 1].entry),
  };
}

/** Replace a list's saved order. Returns how many event rows now carry a rank. */
export async function saveTop30Ranking(ranking: Top30Ranking): Promise<number> {
  // Each day of a multi-day run gets its own consecutive rank, soonest first, so the
  // page's collapse finds them together
  const rankedAt = new Date();
  const rows = ranking.ranked
    .flatMap((entry) => entry.rows)
    .map((row, i) => ({
      category: ranking.category,
      eventId: row.id,
      rank: i + 1,
      title: row.title,
      rankedAt,
    }));
  await db.transaction(async (tx) => {
    await tx.delete(top30Ranks).where(eq(top30Ranks.category, ranking.category));
    if (rows.length > 0) await tx.insert(top30Ranks).values(rows);
  });
  return rows.length;
}
