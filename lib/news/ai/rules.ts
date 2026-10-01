/**
 * The deterministic story rules from docs/news/05-v1-plan.md §6.4 and §7.4:
 * score, Top, lead article, image and filing day. No I/O.
 */

/** Top: live newsroom stories at or above this score, best first ... */
export const TOP_MIN_SCORE = 14;
/** ... at most this many per filing day ... */
export const TOP_MAX = 5;
/** ... topped up to this many from stories at or above TOP_FLOOR_MIN_SCORE. */
export const TOP_FLOOR = 2;
export const TOP_FLOOR_MIN_SCORE = 8;

/**
 * A newsroom story shows at all only at this importance (0-10) or above. 3 is
 * routine PSAs, promotions, campus and school items, minor community events;
 * Matt asked (10-01) to roughly halve the "More news" list by dropping them.
 */
export const MIN_LIVE_IMPORTANCE = 4;

/** Community stories that clear the bar: at most this many live per filing day. */
export const COMMUNITY_LIVE_PER_DAY = 3;

/** A body this long counts as full text when choosing the lead article. */
const FULL_TEXT_CHARS = 400;

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The ET calendar day of `date`, 'YYYY-MM-DD'. */
export function etDay(date: Date): string {
  return ET_DAY.format(date);
}

/** `day` ('YYYY-MM-DD') shifted by `delta` days. */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * score = 2·importance + min(2, outlet_count − 1) + 2 if any member is an outlet article.
 * The coverage term is small so importance dominates: a crime item carried by
 * several TV stations shouldn't outrank civic news one outlet reported.
 */
export function storyScore(
  importance: number,
  outletCount: number,
  hasOutletArticle: boolean
): number {
  return 2 * importance + Math.min(2, Math.max(0, outletCount - 1)) + (hasOutletArticle ? 2 : 0);
}

export interface TopCandidate {
  id: string;
  score: number;
  firstPublishedAt: Date;
  /** A live newsroom member has a dek or body: more than just a title. */
  hasText: boolean;
}

/**
 * A day's Top stories in rank order: up to TOP_MAX at TOP_MIN_SCORE or more,
 * topped up to TOP_FLOOR from TOP_FLOOR_MIN_SCORE. Ties go to the earlier story.
 * Only stories with text are eligible: a headline-only story (a paywalled
 * Google News link) has a one-sentence summary that restates its title.
 */
export function pickTop<T extends TopCandidate>(stories: T[]): T[] {
  const ranked = stories
    .filter((s) => s.hasText)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.firstPublishedAt.getTime() - b.firstPublishedAt.getTime() ||
        a.id.localeCompare(b.id)
    );
  const top = ranked.filter((s) => s.score >= TOP_MIN_SCORE).slice(0, TOP_MAX);
  if (top.length < TOP_FLOOR) {
    for (const s of ranked) {
      if (top.length >= TOP_FLOOR) break;
      if (s.score >= TOP_FLOOR_MIN_SCORE && !top.includes(s)) top.push(s);
    }
  }
  return top;
}

export interface LeadCandidate {
  id: string;
  kind: string;
  outletDomain: string;
  publishedAt: Date;
  contentText: string | null;
}

/** Greenville, SC stations and national sites: lead only when no local outlet has the story. */
const OUT_OF_MARKET_DOMAINS = new Set([
  'foxcarolina.com',
  'wspa.com',
  'wyff4.com',
  'fox.com',
  'foxweather.com',
  'yahoo.com',
]);

function kindRank(m: LeadCandidate): number {
  if (m.kind === 'outlet') return OUT_OF_MARKET_DOMAINS.has(m.outletDomain) ? 1 : 0;
  if (m.kind === 'government' || m.kind === 'institution') return 2;
  return 3;
}

/**
 * The lead: a local outlet's article, then an out-of-market outlet's, then
 * government/institution, then full text, then the earliest.
 */
export function pickLead<T extends LeadCandidate>(members: T[]): T | undefined {
  const hasText = (m: T) => ((m.contentText?.length ?? 0) >= FULL_TEXT_CHARS ? 0 : 1);
  return [...members].sort(
    (a, b) =>
      kindRank(a) - kindRank(b) ||
      hasText(a) - hasText(b) ||
      a.publishedAt.getTime() - b.publishedAt.getTime() ||
      a.id.localeCompare(b.id)
  )[0];
}

const NOT_A_PHOTO = /logo|placeholder|default|favicon|avatar|icon|blank|spacer/i;

/** An https image whose URL doesn't look like a logo or placeholder (§7.4). */
export function isUsableImage(url: string | null | undefined): url is string {
  return !!url && url.startsWith('https://') && !NOT_A_PHOTO.test(url);
}

/** The lead's image, or failing that any outlet member's, if usable. */
export function storyImage(
  lead: { imageUrl: string | null } | undefined,
  members: Array<{ kind: string; imageUrl: string | null }>
): string | null {
  if (lead && isUsableImage(lead.imageUrl)) return lead.imageUrl;
  return members.find((m) => m.kind === 'outlet' && isUsableImage(m.imageUrl))?.imageUrl ?? null;
}

/** Values ordered by how many lists contain them, ties by first appearance. */
export function mostCommon<T>(lists: T[][]): T[] {
  const counts = new Map<T, number>();
  for (const list of lists) for (const v of new Set(list)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
