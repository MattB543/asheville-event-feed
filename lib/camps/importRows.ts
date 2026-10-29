/**
 * Turn verified cards into rows shaped like the §5 tables (drizzle/0025_camps.sql), keyed by
 * camp_key instead of uuid so the JSON import can be applied (or read by the pilot pages) as is.
 *
 * Every fact goes into its season's `facts`, with its check, for audit; the typed filter columns
 * are built only from publishable facts (verified or hand-checked). Milestones and availability
 * have their own tables and keep their verification there.
 */

import { cleanTitle } from '@/lib/utils/slugify';
import { platformOf } from './platforms';
import {
  evidenceItems,
  isPublishable,
  type CheckStatus,
  type Evidence,
  type ExtractedCard,
  type Extraction,
  type SINGLE_EVIDENCE_FIELDS,
} from './types';

/** Imports never write `hidden`: that is moderation, and stays in the database. */
export interface CampRow {
  campKey: string;
  slug: string;
  providerKey: string;
  providerName: string;
  name: string;
  variant: string | null;
  type: string;
  categories: string[];
  websiteUrl: string | null;
  campPageUrl: string | null;
  registrationUrl: string | null;
  platform: string | null;
  platformIds: Record<string, string[]> | null;
  description: string | null;
  discoveredBy: string[];
}

type SeasonField = Exclude<(typeof SINGLE_EVIDENCE_FIELDS)[number], 'availability'>;

/** One summer's facts, every one with its evidence and check (dropped ones kept for audit). */
export type SeasonFacts = { [K in SeasonField]?: NonNullable<ExtractedCard[K]> } & {
  prices?: ExtractedCard['prices'];
  fees?: ExtractedCard['fees'];
  locations?: ExtractedCard['locations'];
  sessions?: ExtractedCard['sessions'];
};

export interface SeasonRow {
  campKey: string;
  seasonYear: number;
  seasonStart: string | null;
  seasonEnd: string | null;
  ageMin: number | null;
  ageMax: number | null;
  gradeMin: number | null;
  gradeMax: number | null;
  gradeBasis: string | null;
  hoursStart: string | null;
  hoursEnd: string | null;
  earlyDropoffStart: string | null;
  latePickupEnd: string | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  priceUnit: string | null;
  town: string | null;
  state: string | null;
  driveSeconds: number | null;
  tags: string[];
  facts: SeasonFacts;
}

interface VerificationColumns {
  verifyStatus: CheckStatus;
  flags: string[];
  /** When the evidence was last checked against its page: never newer than that check. */
  checkedAt: string;
  handCheckedAt: string | null;
  handCheckedBy: string | null;
  handCheckSource: string | null;
}

export interface MilestoneRow extends VerificationColumns {
  campKey: string;
  seasonYear: number;
  audience: string;
  kind: string;
  date: string;
  time: string | null;
  precision: string;
  sourceUrl: string;
  quote: string;
  sourceKind: string;
}

export interface AvailabilityRow extends VerificationColumns {
  campKey: string;
  seasonYear: number;
  status: string;
  scope: string | null;
  sourceUrl: string;
  quote: string;
}

const kept = <T extends Evidence>(evidence: T | null | undefined): evidence is T =>
  !!evidence && evidence.check?.status !== 'dropped';

const publishable = <T extends Evidence>(evidence: T | null | undefined): evidence is T =>
  !!evidence && isPublishable(evidence.check);

function verificationColumns(evidence: Evidence): VerificationColumns {
  const check = evidence.check;
  return {
    verifyStatus: check?.status ?? 'review',
    flags: check?.flags ?? [],
    checkedAt: check?.checkedAt ?? '',
    handCheckedAt: check?.handCheckedAt ?? null,
    handCheckedBy: check?.handCheckedBy ?? null,
    handCheckSource: check?.handCheckSource ?? null,
  };
}

function campKeyFor(providerKey: string, card: ExtractedCard): string {
  return [providerKey, cleanTitle(card.name), card.variant ? cleanTitle(card.variant) : null]
    .filter(Boolean)
    .join(':');
}

export function buildCampRow(
  providerKey: string,
  extraction: Extraction,
  card: ExtractedCard,
  discoveredBy: string[],
  takenSlugs: Set<string>
): CampRow {
  const providerShort = extraction.provider_name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const nameHasProvider = card.name
    .toLowerCase()
    .includes(providerShort.toLowerCase().split(' ')[0]);
  let slug = cleanTitle(
    [nameHasProvider ? null : providerShort, card.name, card.variant].filter(Boolean).join(' ')
  ).replace(/-+$/, '');
  for (let n = 2; takenSlugs.has(slug); n++) slug = `${slug.replace(/-\d+$/, '')}-${n}`;
  takenSlugs.add(slug);

  const platformUrl = [card.registration_url, card.camp_page_url].find(
    (url) => url && platformOf(url)
  );

  return {
    campKey: campKeyFor(providerKey, card),
    slug,
    providerKey,
    providerName: extraction.provider_name,
    name: card.name,
    variant: card.variant,
    type: card.type,
    categories: card.categories,
    websiteUrl: extraction.website_url,
    campPageUrl: card.camp_page_url,
    registrationUrl: card.registration_url,
    platform: platformUrl ? platformOf(platformUrl) : null,
    platformIds: platformIdsFor(card),
    description: card.description || null,
    discoveredBy,
  };
}

/** FMIDs and similar platform identities, kept for refresh (never a merge key on their own). */
function platformIdsFor(card: ExtractedCard): Record<string, string[]> | null {
  const ids: Record<string, Set<string>> = {};
  const add = (kind: string, id: string | undefined) => {
    if (id) (ids[kind] ??= new Set()).add(id);
  };
  for (const [kind, values] of Object.entries(card.platform_ids ?? {})) {
    for (const value of values) add(kind, value);
  }
  for (const url of [card.camp_page_url, card.registration_url]) {
    if (!url) continue;
    add('fmid', url.match(/FMID=(\d+)/i)?.[1]);
    add('ryzer', url.match(/ryzer\.com\/camp\.cfm\?id=(\d+)/i)?.[1]);
  }
  const entries = Object.entries(ids).map(([kind, set]): [string, string[]] => [kind, [...set]]);
  return entries.length ? Object.fromEntries(entries) : null;
}

/** One row per summer that has any fact, with typed columns from the publishable facts only. */
export function buildSeasonRows(campKey: string, card: ExtractedCard): SeasonRow[] {
  const byYear = new Map<number, SeasonFacts>();
  const bucket = (year: number): SeasonFacts => {
    let facts = byYear.get(year);
    if (!facts) {
      facts = {};
      byYear.set(year, facts);
    }
    return facts;
  };

  for (const { field, evidence } of evidenceItems(card)) {
    // Milestones and availability have their own tables.
    if (field === 'registration_milestones' || field === 'availability') continue;
    const facts = bucket(evidence.year) as Record<string, unknown>;
    if (field === 'prices' || field === 'fees' || field === 'locations') {
      facts[field] = [...((facts[field] as Evidence[] | undefined) ?? []), evidence];
    } else {
      facts[field] = evidence;
    }
  }
  for (const session of card.sessions) {
    const facts = bucket(session.year);
    facts.sessions = [...(facts.sessions ?? []), session];
  }

  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([seasonYear, facts]) => {
      const dates = publishable(facts.season_dates) ? facts.season_dates : null;
      const ages = publishable(facts.ages) ? facts.ages : null;
      const grades = publishable(facts.grades) ? facts.grades : null;
      const hours = publishable(facts.hours) ? facts.hours : null;
      const care = publishable(facts.extended_care) ? facts.extended_care : null;
      const prices = (facts.prices ?? []).filter(publishable);
      const location = (facts.locations ?? []).filter(publishable)[0];
      const cheapest = prices.length
        ? prices.reduce((a, b) => (b.amount < a.amount ? b : a))
        : null;

      const tags: string[] = [];
      for (const tag of ['financial_aid', 'special_needs', 'lunch', 'transportation'] as const) {
        const flag = facts[tag];
        if (publishable(flag) && flag.available) tags.push(tag);
      }
      if (care?.late_pickup_end || care?.early_dropoff_start) tags.push('aftercare');

      return {
        campKey,
        seasonYear,
        seasonStart: dates?.start ?? null,
        seasonEnd: dates?.end ?? null,
        ageMin: ages?.min ?? null,
        ageMax: ages?.max ?? null,
        gradeMin: grades?.min ?? null,
        gradeMax: grades?.max ?? null,
        gradeBasis: grades?.basis ?? null,
        hoursStart: hours?.start ?? null,
        hoursEnd: hours?.end ?? null,
        earlyDropoffStart: care?.early_dropoff_start ?? null,
        latePickupEnd: care?.late_pickup_end ?? null,
        priceMinCents: prices.length
          ? Math.round(Math.min(...prices.map((p) => p.amount)) * 100)
          : null,
        priceMaxCents: prices.length
          ? Math.round(Math.max(...prices.map((p) => p.amount)) * 100)
          : null,
        priceUnit: cheapest?.unit ?? null,
        town: location?.town ?? null,
        state: location?.state ?? null,
        driveSeconds: null,
        tags,
        facts,
      };
    });
}

export function buildMilestoneRows(campKey: string, card: ExtractedCard): MilestoneRow[] {
  return card.registration_milestones.filter(kept).map((milestone) => ({
    campKey,
    seasonYear: milestone.year,
    audience: milestone.audience,
    kind: milestone.kind,
    date: milestone.date,
    time: milestone.time,
    precision: milestone.precision,
    sourceUrl: milestone.url,
    quote: milestone.quote,
    sourceKind: milestone.source_kind,
    ...verificationColumns(milestone),
  }));
}

export function buildAvailabilityRow(campKey: string, card: ExtractedCard): AvailabilityRow | null {
  const availability = card.availability;
  if (!kept(availability)) return null;
  return {
    campKey,
    seasonYear: availability.year,
    status: availability.status,
    scope: availability.scope,
    sourceUrl: availability.url,
    quote: availability.quote,
    ...verificationColumns(availability),
  };
}

export function tallyCard(card: ExtractedCard): Record<CheckStatus, number> & { total: number } {
  const tally = { total: 0, verified: 0, review: 0, dropped: 0 };
  for (const { evidence } of evidenceItems(card)) {
    tally.total++;
    tally[evidence.check?.status ?? 'review']++;
  }
  return tally;
}
