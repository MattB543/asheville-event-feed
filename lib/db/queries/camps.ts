import { createHash, randomBytes } from 'node:crypto';
import { revalidateTag, unstable_cache } from 'next/cache';
import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
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
  type Milestone,
  type PriceTier,
  type Session,
  type Site,
  type SupportFact,
  type SupportValue,
} from '@/lib/camps/contract';
import { cleanCard, validDate } from '@/lib/camps/display';
import {
  DRIVE_LIMIT_MINUTES,
  NEAR_CUTOFF_MINUTES,
  PACK_SQUARE,
  driveMinutesFromDowntown,
  kmBetween,
  townFromArea,
  townKey,
  type TownPoint,
} from '@/lib/camps/geo';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import townPointsFile from '@/data/camps/town-points.json';
import duplicatesFile from '@/data/camps/duplicates.json';

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
const CAMP_CACHE_SHAPE = 'v5';

/** Popularity window: views in the last 14 Eastern days, today included. */
const VIEW_WINDOW_DAYS = 14;

/**
 * Live = shown on /camps: neither the camp nor its provider is hidden, and the camp is in its
 * provider's newest extraction (a program that extraction dropped is retired, not deleted; it comes
 * back if a later one finds it). Join camp_providers to use it.
 */
export const liveCamp = and(
  eq(camps.hidden, false),
  eq(campProviders.hidden, false),
  eq(camps.lastExtractedAt, campProviders.extractedAt)
)!;

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

/**
 * What Matt's confirmation is tied to: the card's facts. Its confidence (the card's and each
 * registration date's), review notes and sources change from one extraction to the next when the
 * facts don't, and would otherwise send a confirmed camp back to his queue.
 */
export function cardHash(card: CampCard): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out of the hash
  const { confidence, review_notes, sources, ...facts } = card;
  const registration = facts.registration.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out of the hash
    ({ confidence: _confidence, ...milestone }) => milestone
  );
  return createHash('sha256')
    .update(stableJson({ ...facts, registration }))
    .digest('hex');
}

function wholeOrNull(
  value: number | null | undefined,
  round: (n: number) => number
): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? round(value) : null;
}

/**
 * The columns copied from the effective card for filtering. Fractional ages and grades round
 * outward, so a filter never drops a camp a child might fit (a 4.5 minimum is stored as 4). A
 * season date that isn't a real day ("2027-13-10") is null here, so it can't abort the import;
 * the card keeps it as extracted, for review.
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
    seasonStart: validDate(card.season.start),
    seasonEnd: validDate(card.season.end),
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
  /** The site's own point; null when it isn't placed (a town estimate has no point). */
  lat: number | null;
  lng: number | null;
  /**
   * Unrounded minutes from Pack Square: to the site's point, or for a site with no point, to its
   * town (driveFromTown). Null when neither is known or ORS couldn't route it.
   */
  driveMinutes: number | null;
  /**
   * driveMinutes is the drive to the town's centroid, not the site: an estimate ("~25 min"). Also
   * true for the one site a camp that lists none is given: its provider's area town, named after it.
   */
  driveFromTown: boolean;
}

export interface CampListing {
  id: string;
  slug: string;
  campKey: string;
  providerKey: string;
  providerName: string;
  /** The provider's own site, for when the card has no camp page. */
  providerUrl: string | null;
  /**
   * The effective card (the extraction with Matt's fixes on top), with any malformed date or time
   * read as unknown (cleanCard).
   */
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
  /**
   * When the provider's pages were last read (ISO), or null: the later of its last extraction and
   * its last successful refresh check (which finds them unchanged).
   */
  checkedAt: string | null;
  firstSeenAt: string;
  updatedAt: string;
}

/**
 * A session as the directory reads it: dates, site, eligibility, hours and price. Its label and
 * status are left to the detail page, so rows differing only in those are one row.
 */
export type CampListSession = Pick<
  Session,
  'start' | 'end' | 'site' | 'ages' | 'grades' | 'hours' | 'price'
>;

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
  /** With the camp's own wording ("Friday pickup at noon"). */
  hours: CampCard['hours'];
  extended_care: CampCard['extended_care'];
  /** With their labels ("half day", "starting at"): a price alone can read as the full-day one. */
  prices: PriceTier[];
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
  const support = (fact: SupportFact | null) => (fact ? { value: fact.value } : null);
  const sessions = new Map<string, CampListSession>();
  for (const session of card.sessions) {
    const row = {
      start: session.start,
      end: session.end,
      site: session.site,
      ages: session.ages,
      grades: session.grades,
      hours: session.hours,
      price: session.price,
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
    hours: card.hours,
    extended_care: card.extended_care,
    prices: card.prices,
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

/**
 * Live camps (optionally narrowed by `where`) with their sites and recent views, by name.
 * Uncached: the reader for scripts and crons, where unstable_cache can't run.
 */
export async function queryCamps(where?: SQL): Promise<CampListing[]> {
  const rows = await db
    .select({
      id: camps.id,
      slug: camps.slug,
      campKey: camps.campKey,
      providerKey: camps.providerKey,
      providerName: campProviders.name,
      providerUrl: campProviders.websiteUrl,
      providerArea: campProviders.area,
      extractedAt: campProviders.extractedAt,
      checkedAt: campProviders.checkedAt,
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
    const effective = effectiveCard(row);
    const card = cleanCard(effective);
    // The pages were last read by an extraction or by a refresh check that found them unchanged
    const checkedAt =
      row.checkedAt && (!row.extractedAt || row.checkedAt > row.extractedAt)
        ? row.checkedAt
        : row.extractedAt;
    return {
      id: row.id,
      slug: row.slug,
      campKey: row.campKey,
      providerKey: row.providerKey,
      providerName: row.providerName,
      providerUrl: row.providerUrl,
      card,
      // The card's own wording for each site, placed by the provider's site row of that name, or
      // else estimated from its town; a camp that lists no sites gets its provider's area town
      sites:
        card.sites.length > 0
          ? card.sites.map((site) => {
              const placed = sitesByKey.get(siteKey(row.providerKey, site.name));
              if (placed?.lat != null && placed.lng != null) {
                return {
                  ...site,
                  lat: placed.lat,
                  lng: placed.lng,
                  driveMinutes: placed.driveMinutes,
                  driveFromTown: false,
                };
              }
              const town = townMinutes(site.town, site.state);
              return {
                ...site,
                lat: null,
                lng: null,
                driveMinutes: town,
                driveFromTown: town !== null,
              };
            })
          : areaSite(row.providerArea),
      views: viewsById.get(row.id) ?? 0,
      confirmed: row.reviewedHash === cardHash(effective),
      checkedAt: checkedAt?.toISOString() ?? null,
      firstSeenAt: row.firstSeenAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return listings.filter((camp) => withinRadius(camp) && !DUPLICATE_OF.has(camp.campKey));
}

/** data/camps/town-points.json (scripts/camps/town-points.ts) by lower-cased townKey. */
const TOWN_POINTS = new Map(
  Object.entries(townPointsFile as unknown as Record<string, TownPoint | null>).map(
    ([key, point]) => [key.toLowerCase(), point]
  )
);

/** Minutes from Pack Square to a town's centroid, or null when the town isn't known or routed. */
function townMinutes(town: string | null, state: string | null): number | null {
  if (!town?.trim() || !state?.trim()) return null;
  return TOWN_POINTS.get(townKey(town, state).toLowerCase())?.minutes ?? null;
}

/** The one site a camp that lists none is given: its provider's area town, when that's known. */
function areaSite(area: string | null): CampSiteInfo[] {
  const place = townFromArea(area);
  const minutes = place && townMinutes(place.town, place.state);
  if (!place || minutes == null) return [];
  return [
    {
      name: place.town,
      address: null,
      town: place.town,
      state: place.state,
      lat: null,
      lng: null,
      driveMinutes: minutes,
      driveFromTown: true,
    },
  ];
}

/**
 * D3: a camp is in when any of its sites is within the drive limit (55 min day, 75 overnight).
 * A town estimate gets NEAR_CUTOFF_MINUTES of slack, since the site can be anywhere around the
 * town's centroid. A site with neither a point nor a known town stays in unless it's plainly far
 * away (FAR_KM, NEARBY_STATES), as does a camp with no sites and no known area town; discovery
 * only looked near Asheville.
 */
/** Straight-line km past which no camp is within 75 minutes' drive (Camp Greenville is ~60). */
const FAR_KM = 160;

/** States within 75 minutes of Asheville. An unplaced site elsewhere is a same-named church in Florida. */
const NEARBY_STATES = new Set(['NC', 'SC', 'TN', 'GA', 'VA']);

function siteMayBeNear(site: CampSiteInfo): boolean {
  if (site.lat !== null && site.lng !== null) {
    return kmBetween(PACK_SQUARE, { lat: site.lat, lng: site.lng }) <= FAR_KM;
  }
  return !site.state || NEARBY_STATES.has(site.state.trim().toUpperCase());
}

function withinRadius(camp: CampListing): boolean {
  const limit =
    camp.card.type === 'overnight' ? DRIVE_LIMIT_MINUTES.overnight : DRIVE_LIMIT_MINUTES.day;
  if (camp.sites.length === 0) return true;
  // No route (unplaced with no known town, or ORS found none): out only when plainly far away
  return camp.sites.some((site) =>
    site.driveMinutes === null
      ? siteMayBeNear(site)
      : site.driveMinutes <= limit + (site.driveFromTown ? NEAR_CUTOFF_MINUTES : 0)
  );
}

/**
 * Camps listed twice (one program under the provider that runs it and under its host, say), by
 * dropped camp_key to the kept one: data/camps/duplicates.json, reviewed pairs from
 * scripts/camps/find-duplicates.ts. queryCamps leaves the dropped camp out, so every page, export,
 * calendar and feed event follows, and its page redirects to the kept camp's (keptCampSlug).
 */
const DUPLICATE_OF = new Map(
  (duplicatesFile as { duplicates: Array<{ drop: string; keep: string }> }).duplicates.map(
    ({ drop, keep }) => [drop, keep]
  )
);

/** The kept camp's slug when `slug` is a camp dropped as a duplicate, else null. */
export async function keptCampSlug(slug: string): Promise<string | null> {
  if (!SLUG_PATTERN.test(slug) || DUPLICATE_OF.size === 0) return null;
  const [dropped] = await db
    .select({ campKey: camps.campKey })
    .from(camps)
    .where(eq(camps.slug, slug));
  const keep = dropped && DUPLICATE_OF.get(dropped.campKey);
  if (!keep) return null;
  const [kept] = await db.select({ slug: camps.slug }).from(camps).where(eq(camps.campKey, keep));
  return kept?.slug ?? null;
}

/**
 * The list is cached in this many parts by provider: Next refuses a cache entry over 2MB, and
 * ~1,100 trimmed camps at ~2KB each pass that. Raise it if a part's entry nears 2MB again.
 */
const LIST_CACHE_PARTS = 4;

/**
 * Every live camp for the directory, trimmed (CampListItem). Keyed by the Eastern date, so the
 * views window moves at midnight.
 */
export async function listLiveCamps(): Promise<CampListItem[]> {
  const parts = await Promise.all(
    Array.from({ length: LIST_CACHE_PARTS }, (_, part) =>
      unstable_cache(
        async () =>
          (
            await queryCamps(
              sql`mod(abs(hashtext(${camps.providerKey})), ${LIST_CACHE_PARTS}) = ${part}`
            )
          ).map(toListItem),
        ['camps-list', CAMP_CACHE_SHAPE, String(part), getTodayStringEastern()],
        CAMP_CACHE_OPTIONS
      )()
    )
  );
  // queryCamps orders each part by name, then slug
  return parts
    .flat()
    .sort((a, b) => a.card.name.localeCompare(b.card.name) || a.slug.localeCompare(b.slug));
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

/**
 * When camps' own pages were last read: the newest extraction or successful refresh check among
 * live camps' providers (ISO). Not an admin edit, which changes a card without checking the
 * camp's site.
 */
export function campsLastChecked(): Promise<string | null> {
  return unstable_cache(
    async () => {
      const [row] = await db
        .select({
          // greatest() skips a null: a provider never checked since its extraction
          at: sql<Date | null>`max(greatest(${campProviders.checkedAt}, ${campProviders.extractedAt}))`.mapWith(
            campProviders.extractedAt
          ),
        })
        .from(camps)
        .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
        .where(liveCamp);
      return row?.at ? row.at.toISOString() : null;
    },
    ['camps-last-checked', CAMP_CACHE_SHAPE],
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

/** Could be a calendar token: checked before anything touches the database. */
export function isCalendarToken(token: string): boolean {
  return CALENDAR_TOKEN_PATTERN.test(token);
}

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
 * calendar as fetched, at most once an hour, so a polling app (or a script) can't turn every
 * request into a write. Uncached: calendar apps poll every few hours and the route sets
 * Cache-Control.
 */
export async function campsForCalendar(token: string): Promise<CampListing[] | null> {
  if (!isCalendarToken(token)) return null;
  const [row] = await db
    .select({ campIds: campCalendars.campIds })
    .from(campCalendars)
    .where(eq(campCalendars.token, token));
  if (!row) return null;
  await db
    .update(campCalendars)
    .set({ lastFetchedAt: sql`now()` })
    .where(
      and(
        eq(campCalendars.token, token),
        or(
          isNull(campCalendars.lastFetchedAt),
          lt(campCalendars.lastFetchedAt, sql`now() - interval '1 hour'`)
        )
      )
    );
  return row.campIds.length > 0 ? queryCamps(inArray(camps.id, row.campIds)) : [];
}
