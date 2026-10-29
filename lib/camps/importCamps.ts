/**
 * Summer camps: load discovery and extraction output into camp_providers, camps and camp_sites
 * (docs/camps/04-v2-plan.md §3). Called by scripts/camps/import.ts (every provider, from the files in
 * data/camps) and by the refresh job (lib/camps/refresh.ts: only the providers it re-extracted).
 *
 * - Camps are keyed by camp_key (campKeyFor: provider key + program name). A new camp gets its slug
 *   once and it never changes. The import writes the card and the columns copied from the effective
 *   card; it never writes override, hidden or reviewed_*, and never deletes anything: a camp missing
 *   from its provider's new extraction is reported, not removed.
 * - An extraction older than the one the database already has (the refresh job re-extracted that
 *   provider since the file was written) is skipped, so a file import never undoes a refresh.
 * - Sites are keyed by (provider_key, name), from the effective cards. New, changed and unplaced
 *   sites are geocoded (geocodeSite, cached by the caller, misses included); placed sites without
 *   drive minutes get them on apply. A 'hand' pin is never overwritten. Sites an earlier import
 *   left unplaced or unrouted are retried too, whichever provider they belong to, since the refresh
 *   job imports only the providers it re-extracted. With `placeBy` (the refresh job's time limit),
 *   a lookup that might not finish in time isn't started and its site waits for the next import.
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
import { driveMinutesFromDowntown, geocodeSite, geocodeText, type SiteGeo } from './geo';

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
// The longest one placement call can take: Census then ORS, two 20s attempts each (geo.ts)
const PLACE_CALL_MS = 90_000;

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
   * Epoch ms the import must be done placing sites by. A geocoder lookup or drive-minutes call that
   * might not finish by then isn't started; the rows are still written, the site unplaced or
   * without minutes, and the next import places it.
   */
  placeBy?: number;
}

export interface ImportSummary {
  providers: { new: number; changed: number; unchanged: number };
  camps: { new: number; changed: number; unchanged: number; missing: number; duplicates: number };
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
    const [providerRows, campRows, siteRows] = await Promise.all([
      db.select().from(campProviders),
      db.select().from(camps),
      db.select().from(campSites),
    ]);
    return { providers: providerRows, camps: campRows, sites: siteRows, tablesExist: true };
  } catch (error) {
    // undefined_column: the schema is ahead of the live table
    if (errorCode(error) === '42703')
      throw new Error('A camps table is missing a column: apply drizzle/0026_camps_refresh.sql', {
        cause: error,
      });
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

/** The same rule as the pages: live camps short of high confidence, not confirmed as they stand. */
function inReviewQueue(
  row: Pick<CampRow, 'card' | 'override' | 'reviewedHash' | 'hidden'>,
  providerHidden: boolean
): boolean {
  if (row.hidden || providerHidden) return false;
  const card = effectiveCard(row);
  return needsReview(card) && row.reviewedHash !== cardHash(card);
}

export async function importCamps(options: ImportOptions): Promise<ImportSummary> {
  const { apply, providers: listed, geocodeCache: cache, placeBy } = options;
  const timeToPlace = () => placeBy === undefined || Date.now() + PLACE_CALL_MS <= placeBy;
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
    duplicates: [] as string[],
    missing: [] as CampRow[],
  };
  /** Every camp as it will stand after the import, for sites and the review count. */
  const after = new Map<
    string,
    Pick<CampRow, 'providerKey' | 'card' | 'override' | 'reviewedHash' | 'hidden'>
  >(existing.camps.map((row) => [row.campKey, row]));

  for (const file of files) {
    const provider = providerByKey.get(file.provider.key)!;
    const seen = new Set<string>();
    for (const card of file.extraction.cards) {
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
      };
      after.set(campKey, {
        providerKey: provider.key,
        card,
        override,
        reviewedHash: current?.reviewedHash ?? null,
        hidden: current?.hidden ?? false,
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
      else campPlan.unchanged += 1;
    }
    for (const row of existing.camps) {
      if (row.providerKey === provider.key && !seen.has(row.campKey)) campPlan.missing.push(row);
    }
  }

  // --- Sites: every site an extracted provider's effective cards list
  const existingSite = new Map(
    existing.sites.map((row) => [siteKey(row.providerKey, row.name), row])
  );
  const wanted = new Map<string, Site & { providerKey: string }>();
  for (const camp of after.values()) {
    if (!fileByKey.has(camp.providerKey)) continue;
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
      if (!(text in cache) && !timeToPlace()) {
        outOfTime += 1;
      } else if (!(text in cache)) {
        try {
          lookups += 1;
          cache[text] = await geocodeSite(site);
        } catch (error) {
          // Not cached, so the next run retries it
          geocodeErrors.push(`${text}: ${error instanceof Error ? error.message : String(error)}`);
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
    inReviewQueue(camp, providerHidden.get(camp.providerKey) ?? false)
  ).length;

  // --- Report
  console.log(
    `\nProviders: ${providerPlan.new.length} new, ${providerPlan.changed.length} changed, ${providerPlan.unchanged} unchanged; ${providers.filter((p) => !fileByKey.has(p.key)).length} have no extraction yet`
  );
  for (const file of unlisted)
    console.log(`  ! ${file.provider.key}: has an extraction but is not in the provider list`);

  console.log(
    `\nCamps: ${campPlan.new.length} new, ${campPlan.changed.length} changed, ${campPlan.unchanged} unchanged`
  );
  for (const v of campPlan.new.slice(0, SHOW)) console.log(`  + /camps/${v.slug} (${v.campKey})`);
  if (campPlan.new.length > SHOW) console.log(`  + ... and ${campPlan.new.length - SHOW} more`);
  for (const c of campPlan.changed.slice(0, SHOW))
    console.log(`  ~ ${c.values.campKey}: ${c.fields.join(', ') || 'derived columns'}`);
  if (campPlan.changed.length > SHOW)
    console.log(`  ~ ... and ${campPlan.changed.length - SHOW} more`);
  if (campPlan.missing.length) {
    console.log(
      `  ${campPlan.missing.length} missing from their provider's new extraction (kept, not removed):`
    );
    for (const row of campPlan.missing)
      console.log(`  ? ${row.campKey}${row.hidden ? ' (hidden)' : ''}`);
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
      missing: campPlan.missing.length,
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
  if (toDrive.length && !timeToPlace()) {
    console.log(`  drive minutes left for the next run: out of time`);
  } else if (toDrive.length) {
    try {
      const minutes = await driveMinutesFromDowntown(
        toDrive.map((w) => ({ lat: w.values.lat!, lng: w.values.lng! }))
      );
      toDrive.forEach((w, index) => (w.values.driveMinutes = minutes[index]));
    } catch (error) {
      console.log(
        `  drive minutes failed, left for the next run: ${error instanceof Error ? error.message : String(error)}`
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
      ...new Set([...providerRows, ...campRows, ...siteRows].map((row) => providerKeyOf(row))),
    ];
    const stored = keys.length
      ? await tx
          .select({ key: campProviders.key, extractedAt: campProviders.extractedAt })
          .from(campProviders)
          .where(inArray(campProviders.key, keys))
          .for('update')
      : [];
    const newer = new Set(
      stored
        .filter(
          (row) =>
            row.extractedAt &&
            row.extractedAt.getTime() > (plannedExtractedAt.get(row.key)?.getTime() ?? -Infinity)
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
            updatedAt: sql`now()`,
          },
        });
  });

  summary.wrote = {
    providers: providerRows.length,
    sites: siteRows.length,
    camps: campRows.length,
  };
  return summary;
}
