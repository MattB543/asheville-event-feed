/**
 * Summer camps: load discovery and extraction output into camp_providers, camps and camp_sites
 * (docs/camps/04-v2-plan.md §3). The work is lib/camps/importCamps.ts, which the refresh job calls
 * too; this script feeds it every provider from the files.
 *
 * - Providers come from data/camps/providers.json (before discovery has run, the pilot's
 *   data/camps/pilot/providers.json), each provider's latest extraction from
 *   data/camps/extractions/<key>.json. A file older than the extraction the database already has
 *   (the refresh job re-extracted that provider) is skipped.
 * - Camps are keyed by camp_key (campKeyFor: provider key + program name). A new camp gets its slug
 *   once and it never changes. The import writes the card and the columns copied from the effective
 *   card; it never writes override, hidden or reviewed_*, and never deletes anything: a camp missing
 *   from its provider's new extraction is reported, not removed.
 * - Sites are keyed by (provider_key, name), from the effective cards. New, changed and unplaced
 *   sites are geocoded (geocodeSite, cached in data/camps/geocode-cache.json, misses included:
 *   delete an entry to retry it); placed sites without drive minutes get them on --apply. A 'hand'
 *   pin is never overwritten.
 *
 * Scripts write outside Next.js and cannot call revalidateTag, so /camps (cache tag 'camps') picks
 * the change up when its cache expires, within the hour.
 *
 * Usage:
 *   npx tsx scripts/camps/import.ts           # dry run: geocodes (into the cache), writes no rows
 *   npx tsx scripts/camps/import.ts --apply
 */
import '../../lib/config/env';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider } from '../../lib/camps/contract';
import type { SavedExtraction } from '../../lib/camps/extract';
import type { SiteGeo } from '../../lib/camps/geo';
import { importCamps } from '../../lib/camps/importCamps';

const DATA = join(process.cwd(), 'data', 'camps');
const PROVIDERS = join(DATA, 'providers.json');
const PILOT_PROVIDERS = join(DATA, 'pilot', 'providers.json');
const EXTRACTIONS = join(DATA, 'extractions');
const GEOCODE_CACHE = join(DATA, 'geocode-cache.json');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function loadProviders(): { providers: Provider[]; from: string } {
  if (existsSync(PROVIDERS)) {
    const json = readJson<Provider[] | { providers: Provider[] }>(PROVIDERS);
    return {
      providers: Array.isArray(json) ? json : json.providers,
      from: 'data/camps/providers.json',
    };
  }
  // The pilot list, for testing before discovery has run
  const pilot = readJson<{
    providers: Array<
      Pick<Provider, 'key' | 'name' | 'urls' | 'hint' | 'webtrac'> & { area?: string }
    >;
  }>(PILOT_PROVIDERS);
  return {
    providers: pilot.providers.map((p) => ({
      key: p.key,
      name: p.name,
      urls: p.urls,
      area: p.area ?? null,
      hint: p.hint,
      webtrac: p.webtrac,
      discovered_by: ['pilot'],
      status: 'ok',
    })),
    from: 'data/camps/pilot/providers.json (no data/camps/providers.json yet)',
  };
}

function loadExtractions(): SavedExtraction[] {
  if (!existsSync(EXTRACTIONS)) return [];
  return readdirSync(EXTRACTIONS)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson<SavedExtraction>(join(EXTRACTIONS, name)));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { providers, from } = loadProviders();
  const extractions = loadExtractions();
  const cache: Record<string, SiteGeo | null> = existsSync(GEOCODE_CACHE)
    ? readJson(GEOCODE_CACHE)
    : {};

  try {
    const summary = await importCamps({
      source: `${providers.length} providers from ${from}; ${extractions.length} extraction files in data/camps/extractions`,
      providers,
      extractions,
      geocodeCache: cache,
      apply,
    });
    if (apply) {
      const { wrote } = summary;
      console.log(
        `\nWrote ${wrote.providers} providers, ${wrote.sites} sites, ${wrote.camps} camps. ` +
          `Cache tag 'camps': scripts can't revalidate it, so /camps shows this within the hour.`
      );
    }
  } finally {
    // Lookups made before a failed write are kept too
    const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(GEOCODE_CACHE, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
