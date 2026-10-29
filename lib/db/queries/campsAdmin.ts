import { revalidateTag } from 'next/cache';
import { and, asc, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campProviders, camps, campSites } from '@/lib/db/schema';
import { needsReview, type CampCard, type Site } from '@/lib/camps/contract';
import { EXTRACTION_SCHEMA } from '@/lib/camps/extractionSchema';
import { isRecord } from '@/lib/utils/validation';
import {
  CAMPS_TAG,
  cardHash,
  effectiveCard,
  liveCamp,
  queryCamps,
  setOverride,
  type CampReviewItem,
  type UnpinnedSite,
} from './camps';

/**
 * /admin/camps reads and writes beyond the shared ones in ./camps: camp search, hidden camps, ORS
 * pins to check, one-field fixes and Confirm. Reads are uncached like the other admin reads; every
 * write expires the `camps` tag, here or in ./camps.
 */

// ---------------------------------------------------------------------------
// One-field fixes, checked against the schema Sol extracts with, so a fix can't give the pages a
// shape they don't expect (a `sites` that isn't a list would break every page that reads it), nor
// a date or time that isn't one (a "2027-13-10" would break the directory's date math).
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

const CARD_FIELDS = (((EXTRACTION_SCHEMA.properties as Schema).cards as Schema).items as Schema)
  .properties as Record<string, Schema>;

export type CampCardKey = keyof CampCard;

/** Every top-level CampCard key, in contract order. */
export const CAMP_CARD_KEYS = Object.keys(CARD_FIELDS) as CampCardKey[];

export function isCampCardKey(value: unknown): value is CampCardKey {
  return typeof value === 'string' && Object.hasOwn(CARD_FIELDS, value);
}

function matchesType(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      return false;
  }
}

/** A real day on the calendar: "2027-02-30" has the shape but isn't one. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isClockTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

/**
 * A date or time string that isn't a real one. The schema marks those fields by their description,
 * which starts with the format Sol is told (DATE and TIME in extractionSchema.ts).
 */
function formatProblem(schema: Schema, value: string, path: string): string | null {
  const description = typeof schema.description === 'string' ? schema.description : '';
  if (description.startsWith('YYYY-MM-DD') && !isCalendarDate(value)) {
    return `${path} "${value}" isn't a real date (YYYY-MM-DD)`;
  }
  if (description.startsWith('HH:MM') && !isClockTime(value)) {
    return `${path} "${value}" isn't a 24-hour time (HH:MM, 00:00 to 23:59)`;
  }
  return null;
}

/** The first way `value` breaks `schema` (the JSON Schema subset extractionSchema.ts uses), or null. */
function schemaProblem(schema: Schema, value: unknown, path: string): string | null {
  if (Array.isArray(schema.anyOf)) {
    const problems = (schema.anyOf as Schema[]).map((option) => schemaProblem(option, value, path));
    return problems.includes(null) ? null : problems[0];
  }
  const types = [schema.type].flat();
  if (!types.some((type) => matchesType(type, value))) {
    return `${path} should be ${types.join(' or ')}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} should be one of: ${schema.enum.join(', ')}`;
  }
  if (typeof value === 'string') return formatProblem(schema, value, path);
  if (Array.isArray(value) && isRecord(schema.items)) {
    for (const [index, item] of value.entries()) {
      const problem = schemaProblem(schema.items, item, `${path}[${index}]`);
      if (problem) return problem;
    }
  }
  if (isRecord(value) && isRecord(schema.properties)) {
    const properties = schema.properties as Record<string, Schema>;
    const extra = Object.keys(value).find((key) => !Object.hasOwn(properties, key));
    if (extra) return `${path}.${extra} isn't a field`;
    for (const [key, property] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) return `${path}.${key} is missing`;
      const problem = schemaProblem(property, value[key], `${path}.${key}`);
      if (problem) return problem;
    }
  }
  return null;
}

/** Why `value` can't stand in for the card's `key`, or null when it can. */
export function overrideProblem(key: CampCardKey, value: unknown): string | null {
  return schemaProblem(CARD_FIELDS[key], value, key);
}

/**
 * Fix one top-level field, keeping Matt's other fixes. A fixed `sites` gets its new names into
 * camp_sites first. False when there is no such camp.
 */
export async function setOverrideField(
  id: string,
  key: CampCardKey,
  value: unknown
): Promise<boolean> {
  const [row] = await db
    .select({ providerKey: camps.providerKey, override: camps.override })
    .from(camps)
    .where(eq(camps.id, id));
  if (!row) return false;
  if (key === 'sites') await addSites(row.providerKey, value as Site[]);
  return setOverride(id, { ...row.override, [key]: value } as Partial<CampCard>);
}

/**
 * A site name no import has seen gets a camp_sites row with no point, so it shows under "Pins
 * needed" (and the next import geocodes it when it has a street address). Rows that exist, hand
 * pins included, are left alone: the import is what re-geocodes a changed address.
 */
async function addSites(providerKey: string, sites: Site[]): Promise<void> {
  const rows = new Map<string, typeof campSites.$inferInsert>();
  for (const { name, address, town, state } of sites) {
    // The first one wins when two share a name, as in the import
    if (name.trim() && !rows.has(name)) rows.set(name, { providerKey, name, address, town, state });
  }
  if (rows.size === 0) return;
  await db
    .insert(campSites)
    .values([...rows.values()])
    .onConflictDoNothing({ target: [campSites.providerKey, campSites.name] });
}

export type ConfirmResult = 'confirmed' | 'changed' | 'missing';

/**
 * Matt confirms the card he was shown: `hash` is the cardHash the admin page rendered. The row is
 * locked while it's compared, so an import that changes the card either lands first ('changed':
 * he reloads and looks again) or waits and then puts the camp back in the queue.
 */
export async function confirmCampRevision(id: string, hash: string): Promise<ConfirmResult> {
  const result = await db.transaction(async (tx): Promise<ConfirmResult> => {
    const [row] = await tx
      .select({ card: camps.card, override: camps.override })
      .from(camps)
      .where(eq(camps.id, id))
      .for('update');
    if (!row) return 'missing';
    if (cardHash(effectiveCard(row)) !== hash) return 'changed';
    await tx
      .update(camps)
      .set({ reviewedAt: sql`now()`, reviewedHash: hash })
      .where(eq(camps.id, id));
    return 'confirmed';
  });
  // Expired at once, as in ./camps, so the refresh shows it
  if (result === 'confirmed') revalidateTag(CAMPS_TAG, { expire: 0 });
  return result;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A camp as the admin page shows it. */
export interface AdminCamp extends CampReviewItem {
  /** cardHash of `card`: Confirm sends it back, so Matt approves the card he saw. */
  hash: string;
  /** Matt confirmed this exact card. */
  confirmed: boolean;
}

/** Camps matching `where` (join-ready for camp_providers), each with its effective card and hash. */
async function adminCamps(where: SQL, limit?: number): Promise<AdminCamp[]> {
  const query = db
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
    .where(where)
    .orderBy(asc(campProviders.name), asc(camps.name))
    .$dynamic();
  const rows = await (limit ? query.limit(limit) : query);

  return rows.map(({ reviewedHash, reviewedAt, updatedAt, ...row }) => {
    const card = effectiveCard(row);
    const hash = cardHash(card);
    return {
      ...row,
      card,
      extracted: row.card,
      reviewedAt: reviewedAt?.toISOString() ?? null,
      updatedAt: updatedAt.toISOString(),
      hash,
      confirmed: reviewedHash === hash,
    };
  });
}

/** Live camps short of high confidence that Matt hasn't confirmed in their current form. */
/** Review order, by what parents act on: a wrong registration date is the worst mistake. */
export const REVIEW_TIERS = [
  'A registration date short of high confidence',
  'Low confidence',
  'Medium confidence, 2027 facts',
  'Medium confidence, 2026 facts only (shown labelled 2026)',
] as const;

export function reviewTier(card: CampCard): number {
  if (card.registration.some((milestone) => milestone.confidence !== 'high')) return 0;
  if (card.confidence === 'low') return 1;
  return card.season.year >= 2027 ? 2 : 3;
}

/** Unconfirmed camps short of high confidence that parents can see (in the D3 radius), by tier. */
export async function adminReviewQueue(): Promise<AdminCamp[]> {
  const shown = new Set((await queryCamps()).map((camp) => camp.id));
  return (await adminCamps(liveCamp))
    .filter((camp) => shown.has(camp.id) && needsReview(camp.card) && !camp.confirmed)
    .sort((a, b) => reviewTier(a.card) - reviewTier(b.card));
}

/** The most camps a search shows; a broader one is asked to narrow down. */
export const CAMP_SEARCH_LIMIT = 20;

/**
 * Live camps whose name, provider or slug contains `query`, ignoring case, so Matt can fix one that
 * isn't in the queue. Returns up to CAMP_SEARCH_LIMIT + 1, so the page can tell there are more.
 */
export function searchCamps(query: string): Promise<AdminCamp[]> {
  // LIKE's wildcards and escape character, matched as typed
  const pattern = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
  const matches = or(
    ilike(camps.name, pattern),
    ilike(campProviders.name, pattern),
    ilike(camps.slug, pattern)
  )!;
  return adminCamps(and(liveCamp, matches)!, CAMP_SEARCH_LIMIT + 1);
}

/** How many camps are live (shown on /camps). */
export async function liveCampCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(camps)
    .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
    .where(liveCamp);
  return row?.count ?? 0;
}

export interface HiddenCamp {
  id: string;
  name: string;
  providerName: string;
}

/** Camps hidden one by one (a hidden provider hides its camps without appearing here). */
export function hiddenCamps(): Promise<HiddenCamp[]> {
  return db
    .select({ id: camps.id, name: camps.name, providerName: campProviders.name })
    .from(camps)
    .innerJoin(campProviders, eq(camps.providerKey, campProviders.key))
    .where(eq(camps.hidden, true))
    .orderBy(asc(campProviders.name), asc(camps.name));
}

export interface OrsPinnedSite extends UnpinnedSite {
  lat: number;
  lng: number;
  /** What ORS matched, e.g. "Beaverdam Road, Asheville, NC, USA". */
  label: string | null;
}

/**
 * Sites a live camp lists that ORS placed. ORS can match another street of the same name, so Matt
 * checks each one; a hand pin takes it off this list.
 */
export async function orsPinnedSites(): Promise<OrsPinnedSite[]> {
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
        lat: campSites.lat,
        lng: campSites.lng,
        label: campSites.geocodeLabel,
      })
      .from(campSites)
      .innerJoin(campProviders, eq(campSites.providerKey, campProviders.key))
      .where(
        and(
          eq(campSites.geocodeSource, 'ors'),
          isNotNull(campSites.lat),
          isNotNull(campSites.lng),
          eq(campProviders.hidden, false)
        )
      )
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
      const key = `${row.providerKey}\n${site.name}`;
      campsBySite.set(key, [...(campsBySite.get(key) ?? []), card.name]);
    }
  }

  return siteRows.flatMap(({ lat, lng, ...site }) => {
    const names = campsBySite.get(`${site.providerKey}\n${site.name}`);
    return names && lat !== null && lng !== null ? [{ ...site, lat, lng, camps: names }] : [];
  });
}
