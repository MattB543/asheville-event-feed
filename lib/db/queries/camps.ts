import { createHash, randomBytes } from 'node:crypto';
import { revalidateTag, unstable_cache } from 'next/cache';
import { and, asc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campCalendars, campProviders, camps, campSites, campViews } from '@/lib/db/schema';
import {
  needsReview,
  type AgeRange,
  type AvailabilityStatus,
  type CampCard,
  type CampCategory,
  type CampType,
  type GradeRange,
  type Hours,
  type Milestone,
  type PriceTier,
  type Session,
  type Site,
  type SupportFact,
  type SupportValue,
} from '@/lib/camps/contract';
import { DRIVE_LIMIT_MINUTES, driveMinutesFromDowntown, kmBetween } from '@/lib/camps/geo';
import { getTodayStringEastern } from '@/lib/utils/timezone';

/**
 * Summer camp reads and writes (/camps, /camps/[slug], /admin/camps). docs/camps/04-v2-plan.md §4.
 *
 * A camp row keeps Sol's card as extracted (`card`) and Matt's fixes (`override`, top-level CampCard
 * keys); everything shown is the effective card, {...card, ...override}. The page reads are cached
 * under the `camps` tag and return JSON-safe data (ISO strings, never Date objects), because
 * unstable_cache round-trips through JSON. The admin reads are uncached, and every admin write
 * expires the tag.
 */

export const CAMPS_TAG = 'camps';

const CAMP_CACHE_OPTIONS = { tags: [CAMPS_TAG], revalidate: 3600 };

/**
 * Part of every cache key. Bump it whenever a cached result's shape changes: the key is otherwise
 * the wrapper's source text plus these parts, so entries written by the old code would keep being
 * served until they expire (Vercel's data cache survives deploys).
 */
const CAMP_CACHE_SHAPE = 'v2';

/** Popularity window: views in the last 14 Eastern days, today included. */
const VIEW_WINDOW_DAYS = 14;

/** Live = shown on /camps: neither the camp nor its provider is hidden. Join camp_providers to use it. */
export const liveCamp = and(eq(camps.hidden, false), eq(campProviders.hidden, false))!;

// ---------------------------------------------------------------------------
// The effective card
// ---------------------------------------------------------------------------

export function effectiveCard(row: {
  card: CampCard;
  override: Partial<CampCard> | null;
}): CampCard {
  return { ...row.card, ...row.override };
}

/** JSON with object keys sorted, so the same card hashes the same after a jsonb round trip. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item ?? null)).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function cardHash(card: CampCard): string {
  return createHash('sha256').update(stableJson(card)).digest('hex');
}

function isoDateOrNull(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function wholeOrNull(
  value: number | null | undefined,
  round: (n: number) => number
): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? round(value) : null;
}

/**
 * The columns copied from the effective card for filtering. Fractional ages and grades round
 * outward, so a filter never drops a camp a child might fit (a 4.5 minimum is stored as 4).
 */
export function campColumns(card: CampCard) {
  return {
    name: card.name,
    type: card.type,
    categories: card.categories,
    confidence: card.confidence,
    reviewNotes: card.review_notes,
    ageMin: wholeOrNull(card.ages?.min, Math.floor),
    ageMax: wholeOrNull(card.ages?.max, Math.ceil),
    gradeMin: wholeOrNull(card.grades?.min, Math.floor),
    gradeMax: wholeOrNull(card.grades?.max, Math.ceil),
    seasonYear: card.season.year,
    seasonStart: isoDateOrNull(card.season.start),
    seasonEnd: isoDateOrNull(card.season.end),
  };
}

/** Expired at once, not stale-while-revalidate, so the admin's refresh shows the edit. */
function revalidateCamps(): void {
  revalidateTag(CAMPS_TAG, { expire: 0 });
}

/** YYYY-MM-DD, `days` days before today in Eastern time. */
function easternDaysAgo(days: number): string {
  const [year, month, day] = getTodayStringEastern().split('-').map(Number);
  // Calendar arithmetic in UTC, where every day is 24h, so DST can't shift the result.
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

function siteKey(providerKey: string, name: string): string {
  return `${providerKey}\n${name}`;
}

// ---------------------------------------------------------------------------
// Page reads (cached)
// ---------------------------------------------------------------------------

export interface CampSiteInfo extends Site {
  lat: number | null;
  lng: number | null;
  /** Unrounded minutes from Pack Square; null when the site isn't placed or ORS couldn't route it. */
  driveMinutes: number | null;
}

export interface CampListing {
  id: string;
  slug: string;
  campKey: string;
  providerKey: string;
  providerName: string;
  /** The provider's own site, for when the card has no camp page. */
  providerUrl: string | null;
  /** The effective card: the extraction with Matt's fixes on top. */
  card: CampCard;
  /** The card's sites, in its order, with where they are. */
  sites: CampSiteInfo[];
  /** Views in the last 14 Eastern days, today included. */
  views: number;
  /**
   * Matt confirmed this exact card. Otherwise a registration date short of high confidence reads
   * "unconfirmed".
   */
  confirmed: boolean;
  /** When the provider's pages were last read (ISO), or null. */
  checkedAt: string | null;
  firstSeenAt: string;
  updatedAt: string;
}

/**
 * A session as the directory reads it: dates, eligibility and price (without its label). No label,
 * hours or site (the drive filter is per camp), so the same week at four sites is one row.
 */
export type CampListSession = Pick<Session, 'start' | 'end' | 'ages' | 'grades'> & {
  price: Omit<PriceTier, 'label'> | null;
};

/** A registration date without the camp's wording and link (the detail page shows those). */
export type CampListMilestone = Omit<Milestone, 'text' | 'url'>;

/**
 * The card trimmed to what the directory's cards and filters read. Every CampCard fits this
 * shape, so the display helpers in lib/camps/display.ts take either.
 */
export interface CampListCard {
  name: string;
  type: CampType;
  categories: CampCategory[];
  description: string;
  camp_page_url: string | null;
  season: CampCard['season'];
  ages: AgeRange | null;
  grades: GradeRange | null;
  hours: Hours | null;
  extended_care: CampCard['extended_care'];
  prices: Array<Omit<PriceTier, 'label'>>;
  sessions: CampListSession[];
  registration: CampListMilestone[];
  last_year_registration_opened: { date: string; time: string | null } | null;
  availability: { status: AvailabilityStatus; scope: string | null } | null;
  financial_aid: { value: SupportValue } | null;
  special_needs: { value: SupportValue } | null;
  lunch: { value: SupportValue } | null;
  transportation: { value: SupportValue } | null;
}

/**
 * One camp in the directory. Next's data cache refuses entries over 2MB and a full card runs to
 * ~9KB, so the cached list carries this; the detail page reads the full card (CampListing, which
 * fits this shape too).
 */
export interface CampListItem {
  id: string;
  slug: string;
  providerKey: string;
  providerName: string;
  providerUrl: string | null;
  card: CampListCard;
  sites: CampSiteInfo[];
  views: number;
  confirmed: boolean;
  updatedAt: string;
}

export function toListCard(card: CampCard): CampListCard {
  const price = ({ amount, unit, year }: PriceTier) => ({ amount, unit, year });
  const support = (fact: SupportFact | null) => (fact ? { value: fact.value } : null);
  const sessions = new Map<string, CampListSession>();
  for (const session of card.sessions) {
    const row = {
      start: session.start,
      end: session.end,
      ages: session.ages,
      grades: session.grades,
      price: session.price && price(session.price),
    };
    sessions.set(stableJson(row), row);
  }
  return {
    name: card.name,
    type: card.type,
    categories: card.categories,
    description: card.description,
    camp_page_url: card.camp_page_url,
    season: card.season,
    ages: card.ages,
    grades: card.grades,
    hours: card.hours && { start: card.hours.start, end: card.hours.end },
    extended_care: card.extended_care,
    prices: card.prices.map(price),
    sessions: [...sessions.values()],
    registration: card.registration.map((milestone) => ({
      audience: milestone.audience,
      kind: milestone.kind,
      date: milestone.date,
      time: milestone.time,
      precision: milestone.precision,
      certainty: milestone.certainty,
      year: milestone.year,
      confidence: milestone.confidence,
    })),
    last_year_registration_opened: card.last_year_registration_opened && {
      date: card.last_year_registration_opened.date,
      time: card.last_year_registration_opened.time,
    },
    availability: card.availability && {
      status: card.availability.status,
      scope: card.availability.scope,
    },
    financial_aid: support(card.financial_aid),
    special_needs: support(card.special_needs),
    lunch: support(card.lunch),
    transportation: support(card.transportation),
  };
}

function toListItem(camp: CampListing): CampListItem {
  return {
    id: camp.id,
    slug: camp.slug,
    providerKey: camp.providerKey,
    providerName: camp.providerName,
    providerUrl: camp.providerUrl,
    card: toListCard(camp.card),
    sites: camp.sites,
    views: camp.views,
    confirmed: camp.confirmed,
    updatedAt: camp.updatedAt,
  };
}

/** Live camps (optionally narrowed by `where`) with their sites and recent views, by name. */
async function queryCamps(where?: SQL): Promise<CampListing[]> {
  const rows = await db
    .select({
      id: camps.id,
      slug: camps.slug,
      campKey: camps.campKey,
      providerKey: camps.providerKey,
      providerName: campProviders.name,
      providerUrl: campProviders.websiteUrl,
      extractedAt: campProviders.extractedAt,
      card: camps.card,
      override: camps.override,
      reviewedHash: camps.reviewedHash,
      firstSeenAt: camps.firstSeenAt,
      updatedAt: camps.updatedAt,
    })
    .from(camps)
    .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
    .where(where ? and(liveCamp, where) : liveCamp)
    .orderBy(asc(camps.name), asc(camps.slug));
  if (rows.length === 0) return [];

  const [siteRows, viewRows] = await Promise.all([
    db
      .select({
        providerKey: campSites.providerKey,
        name: campSites.name,
        lat: campSites.lat,
        lng: campSites.lng,
        driveMinutes: campSites.driveMinutes,
      })
      .from(campSites)
      .where(inArray(campSites.providerKey, [...new Set(rows.map((row) => row.providerKey))])),
    db
      .select({ campId: campViews.campId, views: sql<number>`sum(${campViews.count})::int` })
      .from(campViews)
      .where(
        and(
          inArray(
            campViews.campId,
            rows.map((row) => row.id)
          ),
          gte(campViews.day, easternDaysAgo(VIEW_WINDOW_DAYS - 1))
        )
      )
      .groupBy(campViews.campId),
  ]);

  const sitesByKey = new Map(siteRows.map((site) => [siteKey(site.providerKey, site.name), site]));
  const viewsById = new Map(viewRows.map((row) => [row.campId, row.views]));

  const listings: CampListing[] = rows.map((row) => {
    const card = effectiveCard(row);
    return {
      id: row.id,
      slug: row.slug,
      campKey: row.campKey,
      providerKey: row.providerKey,
      providerName: row.providerName,
      providerUrl: row.providerUrl,
      card,
      // The card's own wording for each site, placed by the provider's site row of that name
      sites: card.sites.map((site) => {
        const placed = sitesByKey.get(siteKey(row.providerKey, site.name));
        return {
          ...site,
          lat: placed?.lat ?? null,
          lng: placed?.lng ?? null,
          driveMinutes: placed?.driveMinutes ?? null,
        };
      }),
      views: viewsById.get(row.id) ?? 0,
      confirmed: row.reviewedHash === cardHash(card),
      checkedAt: row.extractedAt?.toISOString() ?? null,
      firstSeenAt: row.firstSeenAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return listings.filter(withinRadius);
}

/**
 * D3: a camp is in when any of its sites is within the drive limit (55 min day, 75 overnight).
 * A camp with an unplaced site stays in until Matt pins it; discovery only looked near Asheville.
 */
function withinRadius(camp: CampListing): boolean {
  const limit =
    camp.card.type === 'overnight' ? DRIVE_LIMIT_MINUTES.overnight : DRIVE_LIMIT_MINUTES.day;
  if (camp.sites.length === 0) return true;
  return camp.sites.some((site) => site.driveMinutes === null || site.driveMinutes <= limit);
}

/**
 * Every live camp for the directory, trimmed (CampListItem). Keyed by the Eastern date, so the
 * views window moves at midnight.
 */
export function listLiveCamps(): Promise<CampListItem[]> {
  return unstable_cache(
    async () => (await queryCamps()).map(toListItem),
    ['camps-list', CAMP_CACHE_SHAPE, getTodayStringEastern()],
    CAMP_CACHE_OPTIONS
  )();
}

/** Camp slugs are slugPart output ([a-z0-9-]); anything else is a miss, not a query. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** One live camp with its full card, or null when it is missing or hidden. */
export async function getCampBySlug(slug: string): Promise<CampListing | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const [camp] = await unstable_cache(
    () => queryCamps(eq(camps.slug, slug)),
    ['camp-page', CAMP_CACHE_SHAPE, slug, getTodayStringEastern()],
    CAMP_CACHE_OPTIONS
  )();
  return camp ?? null;
}

/** One live camp by id (the reminder and feedback routes), or null. */
export async function getCampById(id: string): Promise<CampListing | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const [camp] = await unstable_cache(
    () => queryCamps(eq(camps.id, id)),
    ['camp-by-id', CAMP_CACHE_SHAPE, id, getTodayStringEastern()],
    CAMP_CACHE_OPTIONS
  )();
  return camp ?? null;
}

type Range = { min: number | null; max: number | null } | null;

/** A missing bound is open; a missing range overlaps everything (unknown is not a mismatch). */
function rangesOverlap(a: Range, b: Range): boolean {
  if (!a || !b) return true;
  return (a.max ?? Infinity) >= (b.min ?? -Infinity) && (b.max ?? Infinity) >= (a.min ?? -Infinity);
}

/** Ages when both cards state them, else grades when both do (grades are never converted to ages). */
function sameKids(a: CampListCard, b: CampListCard): boolean {
  if (a.ages && b.ages) return rangesOverlap(a.ages, b.ages);
  if (a.grades && b.grades) return rangesOverlap(a.grades, b.grades);
  return true;
}

/** Kilometres between the two camps' closest placed sites; Infinity when either has none. */
function siteDistanceKm(a: CampSiteInfo[], b: CampSiteInfo[]): number {
  let best = Infinity;
  for (const p of a) {
    for (const q of b) {
      if (p.lat === null || p.lng === null || q.lat === null || q.lng === null) continue;
      best = Math.min(best, kmBetween({ lat: p.lat, lng: p.lng }, { lat: q.lat, lng: q.lng }));
    }
  }
  return best;
}

/** A few other live camps in a shared category for overlapping ages, nearest first. */
export async function relatedCamps(camp: CampListItem, limit = 4): Promise<CampListItem[]> {
  const categories = new Set(camp.card.categories);
  return (await listLiveCamps())
    .filter(
      (other) =>
        other.id !== camp.id &&
        other.card.categories.some((category) => categories.has(category)) &&
        sameKids(camp.card, other.card)
    )
    .map((other) => ({ other, km: siteDistanceKm(camp.sites, other.sites) }))
    .sort((a, b) => a.km - b.km || b.other.views - a.other.views)
    .slice(0, limit)
    .map(({ other }) => other);
}

/** When the directory last changed: the newest extraction or card change among live camps (ISO). */
export function campsLastUpdated(): Promise<string | null> {
  return unstable_cache(
    async () => {
      const [row] = await db
        .select({
          at: sql<Date | null>`greatest(max(${camps.updatedAt}), max(${campProviders.extractedAt}))`.mapWith(
            camps.updatedAt
          ),
        })
        .from(camps)
        .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
        .where(liveCamp);
      return row?.at ? row.at.toISOString() : null;
    },
    ['camps-last-updated', CAMP_CACHE_SHAPE],
    CAMP_CACHE_OPTIONS
  )();
}

// ---------------------------------------------------------------------------
// Admin (/admin/camps): uncached reads, writes that expire the tag
// ---------------------------------------------------------------------------

export interface CampReviewItem {
  id: string;
  slug: string;
  campKey: string;
  providerKey: string;
  providerName: string;
  /** The effective card, as parents see it. */
  card: CampCard;
  /** As extracted, before Matt's fixes. */
  extracted: CampCard;
  override: Partial<CampCard> | null;
  reviewedAt: string | null;
  updatedAt: string;
}

/** Live camps short of high confidence that Matt hasn't confirmed in their current form. */
export async function reviewQueue(): Promise<CampReviewItem[]> {
  const rows = await db
    .select({
      id: camps.id,
      slug: camps.slug,
      campKey: camps.campKey,
      providerKey: camps.providerKey,
      providerName: campProviders.name,
      card: camps.card,
      override: camps.override,
      reviewedAt: camps.reviewedAt,
      reviewedHash: camps.reviewedHash,
      updatedAt: camps.updatedAt,
    })
    .from(camps)
    .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
    .where(liveCamp)
    .orderBy(asc(campProviders.name), asc(camps.name));

  return rows.flatMap((row) => {
    const card = effectiveCard(row);
    if (!needsReview(card) || row.reviewedHash === cardHash(card)) return [];
    return [
      {
        id: row.id,
        slug: row.slug,
        campKey: row.campKey,
        providerKey: row.providerKey,
        providerName: row.providerName,
        card,
        extracted: row.card,
        override: row.override,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });
}

export interface UnpinnedSite {
  id: string;
  providerKey: string;
  providerName: string;
  name: string;
  address: string | null;
  town: string | null;
  state: string | null;
  /** Names of the live camps that list this site. */
  camps: string[];
}

/** Sites a live camp lists that the geocoder couldn't place: they need a pin pasted by hand. */
export async function sitesWithoutPin(): Promise<UnpinnedSite[]> {
  const [siteRows, campRows] = await Promise.all([
    db
      .select({
        id: campSites.id,
        providerKey: campSites.providerKey,
        providerName: campProviders.name,
        name: campSites.name,
        address: campSites.address,
        town: campSites.town,
        state: campSites.state,
      })
      .from(campSites)
      .innerJoin(campProviders, eq(campSites.providerKey, campProviders.key))
      .where(and(isNull(campSites.lat), eq(campProviders.hidden, false)))
      .orderBy(asc(campProviders.name), asc(campSites.name)),
    db
      .select({ providerKey: camps.providerKey, card: camps.card, override: camps.override })
      .from(camps)
      .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
      .where(liveCamp),
  ]);

  const campsBySite = new Map<string, string[]>();
  for (const row of campRows) {
    const card = effectiveCard(row);
    for (const site of card.sites) {
      const key = siteKey(row.providerKey, site.name);
      campsBySite.set(key, [...(campsBySite.get(key) ?? []), card.name]);
    }
  }

  return siteRows.flatMap((site) => {
    const names = campsBySite.get(siteKey(site.providerKey, site.name));
    return names ? [{ ...site, camps: names }] : [];
  });
}

/** Matt confirms the camp as it stands now. False when there is no such camp. */
export async function confirmCamp(id: string): Promise<boolean> {
  const [row] = await db
    .select({ card: camps.card, override: camps.override })
    .from(camps)
    .where(eq(camps.id, id));
  if (!row) return false;
  await db
    .update(camps)
    .set({ reviewedAt: sql`now()`, reviewedHash: cardHash(effectiveCard(row)) })
    .where(eq(camps.id, id));
  revalidateCamps();
  return true;
}

export async function setCampHidden(id: string, hidden: boolean): Promise<boolean> {
  const updated = await db
    .update(camps)
    .set({ hidden })
    .where(eq(camps.id, id))
    .returning({ id: camps.id });
  revalidateCamps();
  return updated.length > 0;
}

/** Every top-level CampCard key; the Record type makes the compiler catch a key added to the contract. */
const CARD_KEYS: Record<keyof CampCard, true> = {
  name: true,
  type: true,
  categories: true,
  description: true,
  camp_page_url: true,
  registration_url: true,
  season: true,
  ages: true,
  grades: true,
  sites: true,
  hours: true,
  extended_care: true,
  prices: true,
  sessions: true,
  registration: true,
  last_year_registration_opened: true,
  availability: true,
  financial_aid: true,
  special_needs: true,
  lunch: true,
  transportation: true,
  sources: true,
  confidence: true,
  review_notes: true,
};

/**
 * Replace a camp's whole override (send every fix to keep, not just the new one); null or {}
 * clears it. Keys must be top-level CampCard keys; their values replace the extracted ones as
 * they are. False when there is no such camp.
 */
export async function setOverride(
  id: string,
  override: Partial<CampCard> | null
): Promise<boolean> {
  const entries = Object.entries(override ?? {}).filter(([, value]) => value !== undefined);
  const unknown = entries.filter(([key]) => !Object.hasOwn(CARD_KEYS, key)).map(([key]) => key);
  if (unknown.length) throw new Error(`Not CampCard keys: ${unknown.join(', ')}`);
  const next = entries.length ? (Object.fromEntries(entries) as Partial<CampCard>) : null;

  const [row] = await db.select({ card: camps.card }).from(camps).where(eq(camps.id, id));
  if (!row) return false;
  await db
    .update(camps)
    .set({
      override: next,
      ...campColumns(effectiveCard({ card: row.card, override: next })),
      updatedAt: sql`now()`,
    })
    .where(eq(camps.id, id));
  revalidateCamps();
  return true;
}

/**
 * A pin pasted from Google Maps. The import never overwrites a 'hand' pin. When ORS can't give
 * drive minutes the pin is still saved, and the next import fills them in. False when there is no
 * such site.
 */
export async function setSitePin(siteId: string, lat: number, lng: number): Promise<boolean> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error(`Not a map pin: ${lat}, ${lng}`);
  }
  let driveMinutes: number | null = null;
  try {
    [driveMinutes] = await driveMinutesFromDowntown([{ lat, lng }]);
  } catch (error) {
    console.error('[Camps] Drive minutes failed for a hand pin:', error);
  }
  const updated = await db
    .update(campSites)
    .set({
      lat,
      lng,
      geocodeSource: 'hand',
      geocodeLabel: null,
      driveMinutes,
      updatedAt: sql`now()`,
    })
    .where(eq(campSites.id, siteId))
    .returning({ id: campSites.id });
  revalidateCamps();
  return updated.length > 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Count one view of a live camp on today's Eastern date. Unknown or hidden camps are ignored. Does
 * not expire the cache: the directory picks views up within the hour.
 */
export async function recordCampView(campId: string): Promise<void> {
  if (!UUID_PATTERN.test(campId)) return;
  await db.execute(sql`
    INSERT INTO ${campViews} (camp_id, day, count)
    SELECT ${camps.id}, ${getTodayStringEastern()}::date, 1
    FROM ${camps} INNER JOIN ${campProviders} ON ${camps.providerKey} = ${campProviders.key}
    WHERE ${camps.id} = ${campId} AND ${liveCamp}
    ON CONFLICT (camp_id, day) DO UPDATE SET count = ${campViews.count} + 1
  `);
}

// ---------------------------------------------------------------------------
// Saved-camps calendar feed (01 §4.4): a token row per subscribing browser, no sign-in
// ---------------------------------------------------------------------------

/** Tokens are 16 random bytes, base64url. */
const CALENDAR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Most camps one calendar holds; more is a bug or abuse, not a family. */
export const MAX_CALENDAR_CAMPS = 200;

/**
 * Point a calendar at these camps. Updates the row when `token` names one (so the subscribed URL
 * never changes), otherwise creates a row with a fresh token. Returns the token.
 */
export async function saveCampCalendar(token: string | null, campIds: string[]): Promise<string> {
  const ids = [...new Set(campIds.filter((id) => UUID_PATTERN.test(id)))].slice(
    0,
    MAX_CALENDAR_CAMPS
  );
  if (token && CALENDAR_TOKEN_PATTERN.test(token)) {
    const updated = await db
      .update(campCalendars)
      .set({ campIds: ids, updatedAt: sql`now()` })
      .where(eq(campCalendars.token, token))
      .returning({ token: campCalendars.token });
    if (updated.length > 0) return token;
  }
  const fresh = randomBytes(16).toString('base64url');
  await db.insert(campCalendars).values({ token: fresh, campIds: ids });
  return fresh;
}

/**
 * The live camps a calendar holds, with full cards, or null for an unknown token. Marks the
 * calendar as fetched. Uncached: calendar apps poll every few hours and the route sets
 * Cache-Control.
 */
export async function campsForCalendar(token: string): Promise<CampListing[] | null> {
  if (!CALENDAR_TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .update(campCalendars)
    .set({ lastFetchedAt: sql`now()` })
    .where(eq(campCalendars.token, token))
    .returning({ campIds: campCalendars.campIds });
  if (!row) return null;
  return row.campIds.length > 0 ? queryCamps(inArray(camps.id, row.campIds)) : [];
}
