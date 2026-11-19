/**
 * Summer camps: load discovery and extraction output into camp_providers, camps and camp_sites
 * (docs/camps/04-v2-plan.md §3). Called by scripts/camps/import.ts (every provider, from the files in
 * data/camps) and by the refresh job (lib/camps/refresh.ts: only the providers it re-extracted).
 *
 * - Camps are keyed by camp_key (campKeyFor: provider key + program name). A new camp gets its slug
 *   once and it never changes. The import writes the card and the columns copied from the effective
 *   card; it never writes override, hidden or reviewed_*, and never deletes anything.
 * - Every camp in a provider's extraction, changed or not, gets last_extracted_at = that
 *   extraction's extractedAt. A camp that stays behind on an older stamp no longer matches the
 *   provider's extracted_at and is retired (liveCamp: not shown, not queued, no feed event).
 * - A live camp missing from the new extraction for the first time is kept one more round: it gets
 *   the new stamp and missed_at, and is retired when the next extraction lacks it too (Matt,
 *   2026-11-19: one extraction that left a program out, or misspelled it, retired a real camp).
 *   The refresh re-extracts a provider with such a camp at its next check, changed pages or not,
 *   so the second look comes within a week. Importing the same extraction again changes nothing.
 * - A new card whose name is one typo away from a program the extraction otherwise lacks
 *   ("Brevvard Distance Runners Camp") takes that program's name, and so its key, slug and saves:
 *   only when one word differs by one letter, both cards have the same camp page and type, and
 *   no other new or missing program is as close ("Junior High Camp" and "Senior High Camp" are
 *   two camps).
 * - An extraction older than the one the database already has (the refresh job re-extracted that
 *   provider since the file was written) is skipped, so a file import never undoes a refresh.
 * - Sites are keyed by (provider_key, name), from the effective cards. New, changed and unplaced
 *   sites are geocoded (geocodeSite, cached by the caller, misses included); placed sites without
 *   drive minutes get them on apply. A 'hand' pin is never overwritten. Sites an earlier import
 *   left unplaced or unrouted are retried too, whichever provider they belong to, since the refresh
 *   job imports only the providers it re-extracted. With `placeBy` (the refresh job's time limit),
 *   lookups and routing are cut off then, and what they didn't reach waits for the next import.
 * - The refresh columns (checked_at, check_error) belong to the refresh job and are never written
 *   here.
 *
 * Callers revalidate the 'camps' cache tag when they can (a route can, a script can't).
 */
import { inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { campProviders, camps, campSites } from '@/lib/db/schema';
import { campColumns, cardHash, effectiveCard, stableJson } from '@/lib/db/queries/camps';
import {
  campKeyFor,
  needsReview,
  slugPart,
  type CampCard,
  type Provider,
  type Site,
} from './contract';
import type { SavedExtraction } from './extract';
import {
  ROUTE_BATCH,
  driveMinutesFromDowntown,
  geocodeSite,
  geocodeText,
  type SiteGeo,
} from './geo';

type ProviderRow = typeof campProviders.$inferSelect;
type CampRow = typeof camps.$inferSelect;
type SiteRow = typeof campSites.$inferSelect;
type ProviderValues = Omit<
  typeof campProviders.$inferInsert,
  'hidden' | 'createdAt' | 'updatedAt' | 'checkedAt' | 'checkError'
>;
type CampValues = typeof camps.$inferInsert;
type SiteValues = typeof campSites.$inferInsert;

const SHOW = 15;

export interface ImportOptions {
  /** Printed after APPLY / DRY RUN, e.g. "742 providers from data/camps/providers.json; ..." */
  source: string;
  /** The provider list. Providers an extraction names but the list doesn't are added. */
  providers: Provider[];
  /** Each provider's latest extraction. */
  extractions: SavedExtraction[];
  /** Geocoder results by geocodeText, misses included (null). New lookups are added to it. */
  geocodeCache: Record<string, SiteGeo | null>;
  apply: boolean;
  /**
   * Epoch ms the import must be done placing sites by: geocoder lookups and drive-minutes calls in
   * flight then are cancelled and no more are started. The rows are still written, those sites
   * unplaced or without minutes, and the next import places them.
   */
  placeBy?: number;
}

export interface ImportSummary {
  providers: { new: number; changed: number; unchanged: number };
  /**
   * `retired`: live until now, missing from their provider's new extraction a second time;
   * `kept`: missing for the first time, so still live; `renamed`: new cards given
   * the name of the program they misspell.
   */
  camps: {
    new: number;
    changed: number;
    unchanged: number;
    retired: number;
    kept: number;
    renamed: number;
    duplicates: number;
  };
  sites: { new: number; updated: number; unchanged: number; unplaced: number; lookups: number };
  /** Extractions skipped because the database has a newer one. */
  staleFiles: string[];
  reviewQueue: number;
  /** Rows written (all zero on a dry run). */
  wrote: { providers: number; sites: number; camps: number };
}

function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (cause as { code?: string }).code;
}

/** The current rows; empty (and says so) when drizzle/0025_camps.sql hasn't been applied yet. */
async function readExisting(): Promise<{
  providers: ProviderRow[];
  camps: CampRow[];
  sites: SiteRow[];
  tablesExist: boolean;
}> {
  try {
    // One snapshot: a camp row read before another import commits and its provider read after
    // would look retired, and be skipped by the first-miss rule
    const [providerRows, campRows, siteRows] = await db.transaction(
      async (tx) =>
        [
          await tx.select().from(campProviders),
          await tx.select().from(camps),
          await tx.select().from(campSites),
        ] as const,
      { isolationLevel: 'repeatable read', accessMode: 'read only' }
    );
    return { providers: providerRows, camps: campRows, sites: siteRows, tablesExist: true };
  } catch (error) {
    // undefined_column: the schema is ahead of the live table
    if (errorCode(error) === '42703')
      throw new Error(
        'A camps table is missing a column: apply drizzle/0026_camps_refresh.sql, 0027_camps_last_extracted.sql and 0030_camps_refresh_lines.sql',
        { cause: error }
      );
    if (errorCode(error) !== '42P01') throw error;
    return { providers: [], camps: [], sites: [], tablesExist: false };
  }
}

/** Words that don't identify a provider, so they never decide whether a program name names it. */
const SLUG_STOPWORDS = new Set(['the', 'a', 'of', 'and', 'at', 'camp', 'camps', 'summer']);

/**
 * '<provider key>-<program>', without the provider when the program name already names it. The key,
 * not the provider's name: keys are short ('asheville-parks-rec') where names run long ('Town of
 * Black Mountain Recreation and Parks').
 */
function newSlug(providerKey: string, programName: string, taken: Set<string>): string {
  const program = slugPart(programName);
  const provider = providerKey;
  const word = provider.split('-').find((part) => !SLUG_STOPWORDS.has(part));
  const named = word !== undefined && program.split('-').includes(word);
  const base =
    (named ? program : `${provider}-${program}`).slice(0, 100).replace(/-+$/, '') || 'camp';
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/** Top-level card fields that differ, for the report. */
function changedFields(a: CampCard, b: CampCard): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof CampCard>;
  return [...keys].filter((key) => stableJson(a[key] ?? null) !== stableJson(b[key] ?? null));
}

function providerKeyOf(row: ProviderValues | CampValues | SiteValues): string {
  return 'providerKey' in row ? row.providerKey : row.key;
}

function siteKey(providerKey: string, name: string): string {
  return `${providerKey}\n${name}`;
}

type CampAfter = Pick<
  CampRow,
  'providerKey' | 'card' | 'override' | 'reviewedHash' | 'hidden' | 'lastExtractedAt'
>;

/** One letter added, dropped or replaced. */
function oneLetterApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let start = 0;
  while (start < short.length && short[start] === long[start]) start++;
  // Past the first difference the rest must line up: after the extra letter, or after the swap
  const rest = short.length === long.length ? start + 1 : start;
  return short.slice(rest) === long.slice(start + 1);
}

/** Words that tell two real programs apart even one letter from each other ("Camp I", "Camp II"). */
const TYPO_WORD_MIN = 6;

/**
 * The same program name but for a typo: the same words, except that one long word differs by a
 * single letter ("Brevard" / "Brevvard"), or the same letters with different spacing or
 * punctuation. Anything looser merges real programs: "Junior High Camp" and "Senior High Camp" are
 * two letters apart, "Men's" and "Women's" two, "Camp I" and "Camp II" one.
 */
export function nearlySameName(a: string, b: string): boolean {
  const [x, y] = [slugPart(a).split('-'), slugPart(b).split('-')];
  if (x.join('') === y.join('')) return true;
  if (x.length !== y.length) return false;
  const differing = x.flatMap((word, index) => (word === y[index] ? [] : [[word, y[index]]]));
  if (differing.length !== 1) return false;
  const [one, other] = differing[0];
  return (
    Math.min(one.length, other.length) >= TYPO_WORD_MIN &&
    !/\d/.test(one + other) &&
    oneLetterApart(one, other)
  );
}

/** In its provider's newest extraction (liveCamp's rule), as the rows will stand. */
function inLatestExtraction(camp: CampAfter, providerExtractedAt: Date | null): boolean {
  return (
    !!camp.lastExtractedAt &&
    !!providerExtractedAt &&
    camp.lastExtractedAt.getTime() === providerExtractedAt.getTime()
  );
}

/** The same rule as the pages: live camps short of high confidence, not confirmed as they stand. */
function inReviewQueue(
  row: CampAfter,
  providerHidden: boolean,
  providerExtractedAt: Date | null
): boolean {
  if (row.hidden || providerHidden || !inLatestExtraction(row, providerExtractedAt)) return false;
  const card = effectiveCard(row);
  return needsReview(card) && row.reviewedHash !== cardHash(card);
}

export async function importCamps(options: ImportOptions): Promise<ImportSummary> {
  const { apply, providers: listed, geocodeCache: cache, placeBy } = options;
  const placeSignal =
    placeBy === undefined ? undefined : AbortSignal.timeout(Math.max(0, placeBy - Date.now()));
  const existing = await readExisting();

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${options.source}`);
  if (!existing.tablesExist) {
    console.log(
      '  The camps tables do not exist yet (drizzle/0025_camps.sql not applied): treating them as empty'
    );
    if (apply) throw new Error('Apply drizzle/0025_camps.sql before --apply');
  } else {
    console.log(
      `  Table has ${existing.providers.length} providers, ${existing.camps.length} camps, ${existing.sites.length} sites`
    );
  }

  // An extraction older than the database's: the refresh job has re-extracted that provider since
  const existingProvider = new Map(existing.providers.map((row) => [row.key, row]));
  const staleFiles: string[] = [];
  const files = options.extractions.filter((file) => {
    const stored = existingProvider.get(file.provider.key)?.extractedAt;
    if (!stored || new Date(file.extractedAt) >= stored) return true;
    staleFiles.push(file.provider.key);
    return false;
  });
  for (const key of staleFiles)
    console.log(
      `  ! ${key}: the database has a newer extraction (refresh job); this one is skipped`
    );

  // --- Providers: the list plus any provider an extraction file names that it doesn't.
  const fileByKey = new Map(files.map((file) => [file.provider.key, file]));
  const providers = [...listed];
  const listedKeys = new Set(listed.map((p) => p.key));
  const unlisted = files.filter((file) => !listedKeys.has(file.provider.key));
  providers.push(...unlisted.map((file) => file.provider));
  const providerByKey = new Map(providers.map((p) => [p.key, p]));

  const providerPlan = {
    new: [] as ProviderValues[],
    changed: [] as ProviderValues[],
    unchanged: 0,
  };
  /** The extraction each provider's rows come from, checked again inside the write. */
  const plannedExtractedAt = new Map<string, Date | null>();
  for (const provider of providers) {
    const file = fileByKey.get(provider.key);
    const current = existingProvider.get(provider.key);
    // Without a new extraction, keep what the last one recorded
    const values: ProviderValues = {
      key: provider.key,
      name: provider.name,
      websiteUrl: file ? file.extraction.website_url : (current?.websiteUrl ?? null),
      urls: provider.urls,
      area: provider.area,
      discoveredBy: provider.discovered_by,
      notes: file ? file.extraction.notes : (current?.notes ?? null),
      extractedAt: file ? new Date(file.extractedAt) : (current?.extractedAt ?? null),
      sourceHash: file ? file.sourceHash : (current?.sourceHash ?? null),
      sourceLines: file ? (file.sourceLines ?? null) : (current?.sourceLines ?? null),
      extractionFingerprint: file ? file.fingerprint : (current?.extractionFingerprint ?? null),
    };
    plannedExtractedAt.set(provider.key, values.extractedAt ?? null);
    if (!current) {
      providerPlan.new.push(values);
      continue;
    }
    const stored = Object.fromEntries(
      Object.keys(values).map((column) => [column, current[column as keyof ProviderValues]])
    );
    if (stableJson(values) !== stableJson(stored)) providerPlan.changed.push(values);
    else providerPlan.unchanged += 1;
  }

  // --- Camps
  const existingCamp = new Map(existing.camps.map((row) => [row.campKey, row]));
  const takenSlugs = new Set(existing.camps.map((row) => row.slug));
  const campPlan = {
    new: [] as CampValues[],
    changed: [] as Array<{ values: CampValues; fields: string[] }>,
    unchanged: 0,
    /** Unchanged camps that only need this extraction's last_extracted_at. */
    restamp: [] as Array<{ campKey: string; providerKey: string; at: Date }>,
    duplicates: [] as string[],
    renamed: [] as string[],
    /** Live until now and missing a second time, or excluded by the extraction: retired. */
    retired: [] as CampRow[],
    /** Live and missing for the first time: stamped with this extraction and missed_at. */
    kept: [] as Array<{ campKey: string; providerKey: string; at: Date }>,
  };
  /** Every camp as it will stand after the import, for sites and the review count. */
  const after = new Map<string, CampAfter>(existing.camps.map((row) => [row.campKey, row]));

  for (const file of files) {
    const provider = providerByKey.get(file.provider.key)!;
    const extractedAt = new Date(file.extractedAt);
    const seen = new Set<string>();
    const ownCamps = existing.camps.filter((row) => row.providerKey === provider.key);
    const cardKeys = new Set(
      file.extraction.cards.map((card) => campKeyFor(provider.key, card.name))
    );
    // Programs this extraction lacks, and cards it has under a name the provider never had
    const lacking = ownCamps.filter((row) => !cardKeys.has(row.campKey));
    const unknown = file.extraction.cards.filter(
      (card) => !existingCamp.has(campKeyFor(provider.key, card.name))
    );
    for (const extracted of file.extraction.cards) {
      // A new name one typo away from a program this extraction otherwise lacks is that program,
      // when they are each other's only near match and share a camp page and type ("Baking Camp"
      // and "Biking Camp" are one letter apart too, on different pages)
      let card = extracted;
      if (unknown.includes(card)) {
        const near = lacking.filter(
          (row) =>
            nearlySameName(row.card.name, card.name) &&
            row.card.type === card.type &&
            !!card.camp_page_url &&
            row.card.camp_page_url === card.camp_page_url
        );
        const rivals = unknown.filter(
          (other) => near.length === 1 && nearlySameName(near[0].card.name, other.name)
        );
        if (near.length === 1 && rivals.length === 1) {
          campPlan.renamed.push(`${provider.key}: "${card.name}" is "${near[0].card.name}"`);
          card = { ...card, name: near[0].card.name };
        }
      }
      const campKey = campKeyFor(provider.key, card.name);
      if (seen.has(campKey)) {
        campPlan.duplicates.push(`${campKey} ("${card.name}")`);
        continue;
      }
      seen.add(campKey);

      const current = existingCamp.get(campKey);
      const override = current?.override ?? null;
      const columns = campColumns(effectiveCard({ card, override }));
      const values: CampValues = {
        campKey,
        slug: current?.slug ?? newSlug(provider.key, card.name, takenSlugs),
        providerKey: provider.key,
        card,
        ...columns,
        lastExtractedAt: extractedAt,
        missedAt: null,
      };
      after.set(campKey, {
        providerKey: provider.key,
        card,
        override,
        reviewedHash: current?.reviewedHash ?? null,
        hidden: current?.hidden ?? false,
        lastExtractedAt: extractedAt,
      });

      if (!current) {
        campPlan.new.push(values);
        continue;
      }
      const fields = changedFields(current.card, card);
      // Stored columns that no longer match also count, e.g. after a change to campColumns
      const stored = Object.fromEntries(
        Object.keys(columns).map((column) => [column, current[column as keyof typeof columns]])
      );
      if (fields.length || stableJson(columns) !== stableJson(stored))
        campPlan.changed.push({ values, fields });
      else {
        campPlan.unchanged += 1;
        if (current.lastExtractedAt?.getTime() !== extractedAt.getTime() || current.missedAt)
          campPlan.restamp.push({ campKey, providerKey: provider.key, at: extractedAt });
      }
    }
    // Live camps this extraction lacks: kept for one more round, retired when an earlier
    // extraction lacked them too. The same extraction imported twice is one miss, not two.
    const wasExtractedAt = existingProvider.get(provider.key)?.extractedAt ?? null;
    for (const row of ownCamps) {
      if (seen.has(row.campKey) || !inLatestExtraction(row, wasExtractedAt)) continue;
      if (row.missedAt && row.missedAt.getTime() !== extractedAt.getTime()) {
        campPlan.retired.push(row);
        continue;
      }
      if (!row.missedAt)
        campPlan.kept.push({ campKey: row.campKey, providerKey: provider.key, at: extractedAt });
      after.set(row.campKey, { ...row, lastExtractedAt: extractedAt });
    }
  }

  /** Each provider's extracted_at as it will stand after the import. */
  const providerExtractedAt = (key: string): Date | null =>
    plannedExtractedAt.get(key) ?? existingProvider.get(key)?.extractedAt ?? null;

  // --- Sites: every site an extracted provider's effective cards list (not its retired cards')
  const existingSite = new Map(
    existing.sites.map((row) => [siteKey(row.providerKey, row.name), row])
  );
  const wanted = new Map<string, Site & { providerKey: string }>();
  for (const camp of after.values()) {
    if (!fileByKey.has(camp.providerKey)) continue;
    if (!inLatestExtraction(camp, providerExtractedAt(camp.providerKey))) continue;
    for (const site of effectiveCard(camp).sites) {
      if (!site.name?.trim()) continue;
      const key = siteKey(camp.providerKey, site.name);
      const seenSite = wanted.get(key);
      // Cards that share a site may word it differently: the first stated value of each field wins
      wanted.set(key, {
        providerKey: camp.providerKey,
        name: site.name,
        address: seenSite?.address ?? site.address,
        town: seenSite?.town ?? site.town,
        state: seenSite?.state ?? site.state,
      });
    }
  }
  // Sites an earlier import couldn't place (out of time, a geocoder error) or route, as they stand.
  // Known misses are in the cache, so they aren't looked up again.
  for (const row of existing.sites) {
    const key = siteKey(row.providerKey, row.name);
    const unplaced = row.lat == null && row.geocodeSource !== 'hand' && !!row.address?.trim();
    const unrouted = row.lat != null && row.driveMinutes == null;
    if (!wanted.has(key) && (unplaced || unrouted)) {
      wanted.set(key, {
        providerKey: row.providerKey,
        name: row.name,
        address: row.address,
        town: row.town,
        state: row.state,
      });
      // So the check under lock skips it if the provider is re-extracted meanwhile
      if (!plannedExtractedAt.has(row.providerKey))
        plannedExtractedAt.set(
          row.providerKey,
          existingProvider.get(row.providerKey)?.extractedAt ?? null
        );
    }
  }

  let lookups = 0;
  let outOfTime = 0;
  const geocodeErrors: string[] = [];
  const sitePlan = {
    write: [] as Array<{ values: SiteValues; isNew: boolean }>,
    unchanged: 0,
    handKept: [] as string[],
  };
  /** Every wanted site as it will stand after the import. */
  const finalSites: SiteValues[] = [];

  for (const [key, site] of wanted) {
    const current = existingSite.get(key);
    const textChanged =
      !current ||
      current.address !== site.address ||
      current.town !== site.town ||
      current.state !== site.state;
    const values: SiteValues = {
      providerKey: site.providerKey,
      name: site.name,
      address: site.address,
      town: site.town,
      state: site.state,
      lat: current?.lat ?? null,
      lng: current?.lng ?? null,
      geocodeSource: current?.geocodeSource ?? null,
      geocodeLabel: current?.geocodeLabel ?? null,
      driveMinutes: current?.driveMinutes ?? null,
    };

    if (current?.geocodeSource === 'hand') {
      if (textChanged)
        sitePlan.handKept.push(
          `${site.providerKey} / ${site.name}: ${site.address ?? '(no address)'}`
        );
    } else if (textChanged || current?.lat == null) {
      const text = geocodeText(site);
      if (!(text in cache) && placeSignal?.aborted) {
        outOfTime += 1;
      } else if (!(text in cache)) {
        try {
          lookups += 1;
          cache[text] = await geocodeSite(site, placeSignal);
        } catch (error) {
          // Not cached, so the next run retries it
          if (placeSignal?.aborted) outOfTime += 1;
          else
            geocodeErrors.push(
              `${text}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
      }
      const geo = cache[text] ?? null;
      const moved = geo?.lat !== current?.lat || geo?.lng !== current?.lng;
      Object.assign(values, {
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        geocodeSource: geo?.source ?? null,
        geocodeLabel: geo?.label ?? null,
        driveMinutes: moved ? null : values.driveMinutes,
      });
    }

    const needsDrive = values.lat != null && values.driveMinutes == null;
    if (!current || textChanged || needsDrive || values.lat !== current.lat)
      sitePlan.write.push({ values, isNew: !current });
    else sitePlan.unchanged += 1;
    finalSites.push(values);
  }

  const placed = finalSites.filter((site) => site.lat != null);
  const unplaced = finalSites.filter((site) => site.lat == null);
  const bySource = (source: string) =>
    placed.filter((site) => site.geocodeSource === source).length;
  const toDrive = sitePlan.write.filter(
    (w) => w.values.lat != null && w.values.driveMinutes == null
  );

  const providerHidden = new Map(existing.providers.map((row) => [row.key, row.hidden]));
  const reviewCount = [...after.values()].filter((camp) =>
    inReviewQueue(
      camp,
      providerHidden.get(camp.providerKey) ?? false,
      providerExtractedAt(camp.providerKey)
    )
  ).length;

  // --- Report
  console.log(
    `\nProviders: ${providerPlan.new.length} new, ${providerPlan.changed.length} changed, ${providerPlan.unchanged} unchanged; ${providers.filter((p) => !fileByKey.has(p.key)).length} have no extraction yet`
  );
  for (const file of unlisted)
    console.log(`  ! ${file.provider.key}: has an extraction but is not in the provider list`);

  console.log(
    `\nCamps: ${campPlan.new.length} new, ${campPlan.changed.length} changed, ${campPlan.unchanged} unchanged (${campPlan.restamp.length} of them restamped with their extraction)`
  );
  for (const v of campPlan.new.slice(0, SHOW)) console.log(`  + /camps/${v.slug} (${v.campKey})`);
  if (campPlan.new.length > SHOW) console.log(`  + ... and ${campPlan.new.length - SHOW} more`);
  for (const c of campPlan.changed.slice(0, SHOW))
    console.log(`  ~ ${c.values.campKey}: ${c.fields.join(', ') || 'derived columns'}`);
  if (campPlan.changed.length > SHOW)
    console.log(`  ~ ... and ${campPlan.changed.length - SHOW} more`);
  for (const line of campPlan.renamed) console.log(`  = ${line} (a near-identical name)`);
  if (campPlan.kept.length) {
    console.log(
      `  ${campPlan.kept.length} live camps missing from their provider's new extraction for the first time: still shown, retired if the next one lacks them too:`
    );
    for (const row of campPlan.kept) console.log(`  ? ${row.campKey}`);
  }
  if (campPlan.retired.length) {
    console.log(
      `  ${campPlan.retired.length} retired (kept, not shown): missing from two extractions in a row:`
    );
    for (const row of campPlan.retired)
      console.log(`  - ${row.campKey}${row.hidden ? ' (hidden)' : ''}`);
  }
  if (campPlan.duplicates.length) {
    console.log(
      `  ${campPlan.duplicates.length} cards skipped: same program name as an earlier card of that provider:`
    );
    for (const d of campPlan.duplicates) console.log(`  x ${d}`);
  }

  const newSites = sitePlan.write.filter((w) => w.isNew).length;
  console.log(
    `\nSites: ${newSites} new, ${sitePlan.write.length - newSites} to update, ${sitePlan.unchanged} unchanged`
  );
  console.log(
    `  placed ${placed.length} (census ${bySource('census')}, ors ${bySource('ors')}, hand ${bySource('hand')}), unplaced ${unplaced.length}; ${lookups} geocoder lookups this run`
  );
  console.log(`  drive minutes to compute: ${toDrive.length}${apply ? '' : ' (on --apply)'}`);
  for (const site of unplaced)
    console.log(
      `  - ${site.providerKey} / ${site.name}: ${[site.address, site.town, site.state].filter(Boolean).join(', ') || '(no address)'}`
    );
  for (const line of sitePlan.handKept) console.log(`  hand pin kept, address now ${line}`);
  for (const line of geocodeErrors) console.log(`  geocode failed (retried next run): ${line}`);
  if (outOfTime) console.log(`  ${outOfTime} sites not looked up: out of time (next run)`);

  console.log(`\nReview queue after import: ${reviewCount} camps`);

  let providerRows = [...providerPlan.new, ...providerPlan.changed];
  let campRows = [...campPlan.new, ...campPlan.changed.map((c) => c.values)];
  let siteRows = sitePlan.write.map((w) => w.values);
  let restamp = campPlan.restamp;
  let kept = campPlan.kept;
  const summary: ImportSummary = {
    providers: {
      new: providerPlan.new.length,
      changed: providerPlan.changed.length,
      unchanged: providerPlan.unchanged,
    },
    camps: {
      new: campPlan.new.length,
      changed: campPlan.changed.length,
      unchanged: campPlan.unchanged,
      retired: campPlan.retired.length,
      kept: campPlan.kept.length,
      renamed: campPlan.renamed.length,
      duplicates: campPlan.duplicates.length,
    },
    sites: {
      new: newSites,
      updated: sitePlan.write.length - newSites,
      unchanged: sitePlan.unchanged,
      unplaced: unplaced.length,
      lookups,
    },
    staleFiles,
    reviewQueue: reviewCount,
    wrote: { providers: 0, sites: 0, camps: 0 },
  };

  if (!apply) {
    console.log('\n(dry run - no rows written; re-run with --apply)');
    return summary;
  }

  // --- Write. Drive minutes first: they're API calls, and a failure only leaves them for next time.
  // One ORS call per batch, so the batches routed before placeBy keep their minutes.
  for (let start = 0; start < toDrive.length; start += ROUTE_BATCH) {
    if (placeSignal?.aborted) {
      console.log(
        `  drive minutes for ${toDrive.length - start} sites left for the next run: out of time`
      );
      break;
    }
    const batch = toDrive.slice(start, start + ROUTE_BATCH);
    try {
      const minutes = await driveMinutesFromDowntown(
        batch.map((w) => ({ lat: w.values.lat!, lng: w.values.lng! })),
        placeSignal
      );
      batch.forEach((w, index) => (w.values.driveMinutes = minutes[index]));
    } catch (error) {
      console.log(
        `  drive minutes for ${batch.length} sites failed, left for the next run: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const excluded = (column: string) => sql.raw(`excluded.${column}`);
  // A pin pasted by hand is never overwritten, even one saved while this import ran
  const unlessHand = (column: string) =>
    sql.raw(
      `CASE WHEN camp_sites.geocode_source = 'hand' THEN camp_sites.${column} ELSE excluded.${column} END`
    );
  // Drive minutes were routed from this import's point; a pin pasted meanwhile keeps its own
  const driveMinutesUnlessRepinned = sql.raw(
    `CASE WHEN camp_sites.geocode_source = 'hand' AND (camp_sites.lat IS DISTINCT FROM excluded.lat OR camp_sites.lng IS DISTINCT FROM excluded.lng) THEN camp_sites.drive_minutes ELSE excluded.drive_minutes END`
  );

  await db.transaction(async (tx) => {
    // Checked again under lock: a refresh that re-extracted a provider after readExisting wins, so
    // none of this import's rows for that provider are written (they'd restore older cards)
    const keys = [
      ...new Set([
        ...[...providerRows, ...campRows, ...siteRows].map((row) => providerKeyOf(row)),
        ...restamp.map((row) => row.providerKey),
        ...kept.map((row) => row.providerKey),
      ]),
    ];
    const stored = keys.length
      ? await tx
          .select({ key: campProviders.key, extractedAt: campProviders.extractedAt })
          .from(campProviders)
          .where(inArray(campProviders.key, keys))
          .for('update')
      : [];
    // Any other extraction than the one this import was planned against: what's new, changed,
    // missing for the first time or the second was all judged against that one
    const newer = new Set(
      stored
        .filter(
          (row) =>
            row.extractedAt?.getTime() !== existingProvider.get(row.key)?.extractedAt?.getTime()
        )
        .map((row) => row.key)
    );
    if (newer.size) {
      for (const key of newer) {
        staleFiles.push(key);
        console.log(`  ! ${key}: re-extracted while this import ran; its rows are skipped`);
      }
      const fresh = <T extends ProviderValues | CampValues | SiteValues>(rows: T[]) =>
        rows.filter((row) => !newer.has(providerKeyOf(row)));
      providerRows = fresh(providerRows);
      campRows = fresh(campRows);
      siteRows = fresh(siteRows);
      restamp = restamp.filter((row) => !newer.has(row.providerKey));
      kept = kept.filter((row) => !newer.has(row.providerKey));
    }

    if (providerRows.length)
      await tx
        .insert(campProviders)
        .values(providerRows)
        .onConflictDoUpdate({
          target: campProviders.key,
          set: {
            name: excluded('name'),
            websiteUrl: excluded('website_url'),
            urls: excluded('urls'),
            area: excluded('area'),
            discoveredBy: excluded('discovered_by'),
            notes: excluded('notes'),
            extractedAt: excluded('extracted_at'),
            sourceHash: excluded('source_hash'),
            sourceLines: excluded('source_lines'),
            extractionFingerprint: excluded('extraction_fingerprint'),
            updatedAt: sql`now()`,
          },
        });
    if (siteRows.length)
      await tx
        .insert(campSites)
        .values(siteRows)
        .onConflictDoUpdate({
          target: [campSites.providerKey, campSites.name],
          set: {
            address: excluded('address'),
            town: excluded('town'),
            state: excluded('state'),
            lat: unlessHand('lat'),
            lng: unlessHand('lng'),
            geocodeSource: unlessHand('geocode_source'),
            geocodeLabel: unlessHand('geocode_label'),
            driveMinutes: driveMinutesUnlessRepinned,
            updatedAt: sql`now()`,
          },
        });
    // The slug, override, hidden and reviewed_* of an existing camp are never touched
    if (campRows.length)
      await tx
        .insert(camps)
        .values(campRows)
        .onConflictDoUpdate({
          target: camps.campKey,
          set: {
            card: excluded('card'),
            name: excluded('name'),
            type: excluded('type'),
            categories: excluded('categories'),
            confidence: excluded('confidence'),
            reviewNotes: excluded('review_notes'),
            ageMin: excluded('age_min'),
            ageMax: excluded('age_max'),
            gradeMin: excluded('grade_min'),
            gradeMax: excluded('grade_max'),
            seasonYear: excluded('season_year'),
            seasonStart: excluded('season_start'),
            seasonEnd: excluded('season_end'),
            lastExtractedAt: excluded('last_extracted_at'),
            missedAt: excluded('missed_at'),
            updatedAt: sql`now()`,
          },
        });
    // Unchanged camps: only the stamp that keeps them live (their card and updated_at stand).
    // Camps missing for the first time get the stamp too, and missed_at.
    const stamp = async (rows: typeof restamp, missed: boolean) => {
      const byAt = new Map<number, string[]>();
      for (const { campKey, at } of rows)
        byAt.set(at.getTime(), [...(byAt.get(at.getTime()) ?? []), campKey]);
      for (const [at, campKeys] of byAt)
        await tx
          .update(camps)
          .set({ lastExtractedAt: new Date(at), missedAt: missed ? new Date(at) : null })
          .where(inArray(camps.campKey, campKeys));
    };
    await stamp(restamp, false);
    await stamp(kept, true);
  });

  summary.wrote = {
    providers: providerRows.length,
    sites: siteRows.length,
    camps: campRows.length + restamp.length + kept.length,
  };
  return summary;
}
