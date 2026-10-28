/**
 * Turn verified cards into rows shaped like the §5 tables (drizzle/0025_camps.sql), keyed by
 * camp_key instead of uuid so the JSON import can be applied (or read by the pilot pages) as is.
 */

import { cleanTitle } from '@/lib/utils/slugify';
import { platformOf } from './platforms';
import { evidenceItems } from './verify';
import type {
  Availability,
  CampLocation,
  CheckStatus,
  Evidence,
  ExtractedCard,
  Extraction,
  Milestone,
  SINGLE_EVIDENCE_FIELDS,
} from './types';
import { LIST_EVIDENCE_FIELDS } from './types';

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
  hidden: boolean;
}

/** One summer's facts, every one with its evidence and check (dropped ones kept for audit). */
export type SeasonFacts = Partial<Record<(typeof SINGLE_EVIDENCE_FIELDS)[number], Evidence>> &
  Partial<Record<(typeof LIST_EVIDENCE_FIELDS)[number], Evidence[]>> & {
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

export interface MilestoneRow {
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
  verifyStatus: CheckStatus;
  flags: string[];
  handCheckedAt: string | null;
}

export interface AvailabilityRow {
  campKey: string;
  seasonYear: number;
  status: string;
  scope: string | null;
  sourceUrl: string;
  quote: string;
  observedAt: string;
}

const kept = <T extends Evidence>(evidence: T | null | undefined): evidence is T =>
  !!evidence && evidence.check?.status !== 'dropped';

export function campKeyFor(providerKey: string, card: ExtractedCard): string {
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
    hidden: false,
  };
}

/** FMIDs and similar platform identities, kept for refresh (never a merge key on their own). */
function platformIdsFor(card: ExtractedCard): Record<string, string[]> | null {
  const urls = [card.camp_page_url, card.registration_url].filter((url): url is string => !!url);
  const fmid = urls.map((url) => url.match(/FMID=(\d+)/i)?.[1]).filter((id): id is string => !!id);
  const ryzer = urls
    .map((url) => url.match(/ryzer\.com\/camp\.cfm\?id=(\d+)/i)?.[1])
    .filter((id): id is string => !!id);
  const ids: Record<string, string[]> = {};
  if (fmid.length) ids.fmid = [...new Set(fmid)];
  if (ryzer.length) ids.ryzer = [...new Set(ryzer)];
  return Object.keys(ids).length ? ids : null;
}

/** One row per summer that has any fact, with typed columns from the kept facts only. */
export function buildSeasonRows(campKey: string, card: ExtractedCard): SeasonRow[] {
  const byYear = new Map<number, SeasonFacts>();
  const bucket = (year: number) => {
    let facts = byYear.get(year);
    if (!facts) {
      facts = {};
      byYear.set(year, facts);
    }
    return facts;
  };

  for (const { field, evidence } of evidenceItems(card)) {
    if (field === 'registration_milestones') continue; // their own table
    const facts = bucket(evidence.year) as Record<string, unknown>;
    if ((LIST_EVIDENCE_FIELDS as readonly string[]).includes(field)) {
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
      const dates = kept(facts.season_dates)
        ? (facts.season_dates as Evidence & { start: string | null; end: string | null })
        : null;
      const ages = kept(facts.ages)
        ? (facts.ages as Evidence & { min: number | null; max: number | null })
        : null;
      const grades = kept(facts.grades)
        ? (facts.grades as Evidence & { min: number | null; max: number | null; basis: string })
        : null;
      const hours = kept(facts.hours)
        ? (facts.hours as Evidence & { start: string | null; end: string | null })
        : null;
      const care = kept(facts.extended_care)
        ? (facts.extended_care as Evidence & {
            early_dropoff_start: string | null;
            late_pickup_end: string | null;
          })
        : null;
      const prices = (facts.prices ?? []).filter(kept) as Array<
        Evidence & { amount: number; unit: string }
      >;
      const location = ((facts.locations ?? []).filter(kept) as CampLocation[])[0];
      const cheapest = prices.length
        ? prices.reduce((a, b) => (b.amount < a.amount ? b : a))
        : null;

      const tags: string[] = [];
      for (const tag of ['financial_aid', 'special_needs', 'lunch', 'transportation'] as const) {
        const flag = facts[tag] as (Evidence & { available: boolean }) | undefined;
        if (kept(flag) && flag.available) tags.push(tag);
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
  return card.registration_milestones.filter(kept).map((milestone: Milestone) => ({
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
    verifyStatus: milestone.check?.status ?? 'review',
    flags: milestone.check?.flags ?? [],
    handCheckedAt: null,
  }));
}

export function buildAvailabilityRow(campKey: string, card: ExtractedCard): AvailabilityRow | null {
  const availability: Availability | null = card.availability;
  if (!kept(availability)) return null;
  return {
    campKey,
    seasonYear: availability.year,
    status: availability.status,
    scope: availability.scope,
    sourceUrl: availability.url,
    quote: availability.quote,
    observedAt: availability.check?.checkedAt ?? new Date().toISOString(),
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
