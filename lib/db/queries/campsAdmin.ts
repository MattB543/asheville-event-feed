import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campProviders, camps, campSites } from '@/lib/db/schema';
import type { CampCard } from '@/lib/camps/contract';
import { EXTRACTION_SCHEMA } from '@/lib/camps/extractionSchema';
import { isRecord } from '@/lib/utils/validation';
import { effectiveCard, liveCamp, setOverride, type UnpinnedSite } from './camps';

/**
 * /admin/camps reads and writes beyond the shared ones in ./camps: hidden camps, ORS pins to check,
 * and one-field fixes. Reads are uncached like the other admin reads; writes go through ./camps,
 * which expires the `camps` tag.
 */

// ---------------------------------------------------------------------------
// One-field fixes, checked against the schema Sol extracts with, so a fix can't give the pages a
// shape they don't expect (a `sites` that isn't a list would break every page that reads it).
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

/** Fix one top-level field, keeping Matt's other fixes. False when there is no such camp. */
export async function setOverrideField(
  id: string,
  key: CampCardKey,
  value: unknown
): Promise<boolean> {
  const [row] = await db.select({ override: camps.override }).from(camps).where(eq(camps.id, id));
  if (!row) return false;
  return setOverride(id, { ...row.override, [key]: value } as Partial<CampCard>);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

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
