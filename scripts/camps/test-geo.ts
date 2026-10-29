/**
 * Live check of lib/camps/geo.ts on the pilot's sites (2026-10-28):
 *
 * 1. How many sites `geocodeSite` places (Census, then ORS) versus what ORS alone did in the pilot
 *    (its cache, data/camps/pilot/geocode.json). Sites come from the bundle extractions' card
 *    locations, the providers' fallback `site`, and the Parks & Rec community centers. Sites with
 *    only a venue name are never looked up, so their group reads "none": they wait for hand pins.
 * 2. ORS matrix minutes versus the public OSRM demo server for a sample of sites, since ORS's drive
 *    times looked long in the pilot (Camp Greenville ~90 min). One OSRM request, per its usage policy.
 *
 * Network: Census, ORS (OPENROUTE_SERVICE_API_KEY), OSRM. No database.
 *
 * Usage:
 *   npx tsx scripts/camps/test-geo.ts
 */
import '../../lib/config/env';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  PACK_SQUARE,
  driveMinutesFromDowntown,
  geocodeSite,
  geocodeText,
  kmBetween,
  type SiteGeo,
  type SiteQuery,
} from '../../lib/camps/geo';
import { FACILITIES } from '../../lib/scrapers/ashevilleparksrec';

const PILOT_DIR = join(process.cwd(), 'data', 'camps', 'pilot');
const BUNDLE_DIR = join(PILOT_DIR, 'verified', 'bundle');
const OSRM_URL = 'https://router.project-osrm.org/table/v1/driving';

/** What the pilot's Pelias lookup returned, keyed by geocodeText. */
type PilotHit = { lat: number; lng: number; label: string; layer: string } | null;

interface TestSite extends SiteQuery {
  provider: string;
}

/**
 * Street addresses for drive-time sample sites the pilot data has none for, written for this test.
 * The providers file has the Arboretum at 20 Frederick Law Olmsted Way, which Census doesn't know;
 * its address is 100.
 */
const EXTRA_SITES: TestSite[] = [
  {
    provider: 'lutheridge',
    name: 'Lutheridge',
    address: '2511 Hendersonville Rd',
    town: 'Arden',
    state: 'NC',
  },
  {
    provider: 'nc-arboretum',
    name: 'The North Carolina Arboretum',
    address: '100 Frederick Law Olmsted Way',
    town: 'Asheville',
    state: 'NC',
  },
  {
    provider: 'ymca-wnc',
    name: 'Hendersonville Family YMCA',
    address: '810 6th Ave W',
    town: 'Hendersonville',
    state: 'NC',
  },
  {
    provider: 'kanuga-day-camp',
    name: 'Kanuga',
    address: '130 Kanuga Chapel Dr',
    town: 'Hendersonville',
    state: 'NC',
  },
  {
    provider: 'brevard-music-center',
    name: 'Brevard Music Center',
    address: '349 Andante Ln',
    town: 'Brevard',
    state: 'NC',
  },
];

/**
 * Names (or addresses) picked for the drive-time comparison: near, mid and far, every direction.
 * Camp Greenville has no street address, so it uses the pilot's Pelias point (the one that gave
 * 73.9 minutes).
 */
const DRIVE_SAMPLE = [
  'YMCA Camp Greenville',
  'Camp Rockmont',
  'Lutheridge',
  '100 Frederick Law Olmsted Way',
  '1 University Heights',
  'Hendersonville Family YMCA',
  'Kanuga',
  'Brevard Music Center',
  'Grey Eagle Arena',
  "Hahn's Gymnastics",
  'Christ School',
  '174 Bradley Branch Rd',
  'Evergreen Community Charter School',
  'YMCA Youth Services Center at Beaverdam',
  'Ninjaville',
  'Burton Street Community Center',
  'Reynolds Baptist Church',
];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function pilotSites(): TestSite[] {
  const sites = new Map<string, TestSite>();
  const add = (site: TestSite) => {
    const key = geocodeText(site).toLowerCase();
    if (!sites.has(key)) sites.set(key, site);
  };

  for (const file of readdirSync(BUNDLE_DIR)) {
    const bundle = readJson<{
      provider: { key: string };
      extraction?: { cards: Array<{ locations?: SiteQuery[] }> };
    }>(join(BUNDLE_DIR, file));
    for (const card of bundle.extraction?.cards ?? []) {
      for (const { name, address, town, state } of card.locations ?? []) {
        add({ provider: bundle.provider.key, name, address, town, state });
      }
    }
  }

  // A provider's `site` is a street address or a venue name ("Lutheridge, Arden, NC").
  const { providers } = readJson<{
    providers: Array<{ key: string; name: string; site?: string }>;
  }>(join(PILOT_DIR, 'providers.json'));
  for (const provider of providers) {
    if (!provider.site) continue;
    const isAddress = /^\d/.test(provider.site);
    add({
      provider: provider.key,
      name: isAddress ? provider.name : provider.site,
      address: isAddress ? provider.site : null,
      town: null,
      state: null,
    });
  }

  for (const facility of Object.values(FACILITIES)) {
    add({
      provider: 'asheville-parks-rec',
      name: facility.name,
      address: facility.street,
      town: 'Asheville',
      state: 'NC',
    });
  }
  return [...sites.values()];
}

/** The pilot's Pelias result, in words. */
function describePilot(hit: PilotHit | undefined): string {
  if (hit === undefined) return 'not tried';
  if (hit === null) return 'none';
  if (hit.layer === 'address') return 'house-level';
  if (hit.layer === 'street') return 'mid-street';
  if (hit.layer === 'venue') return 'venue';
  return 'centroid';
}

/** The pilot's point, when it was precise enough to route from. */
function pilotPoint(hit: PilotHit | undefined): SiteGeo | null {
  if (!hit || !['address', 'street', 'venue'].includes(hit.layer)) return null;
  return { lat: hit.lat, lng: hit.lng, source: 'ors', label: `${hit.label} (pilot point)` };
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([key, count]) => `${key} ${count}`)
    .join(', ');
}

async function osrmMinutes(
  points: Array<{ lat: number; lng: number }>
): Promise<Array<number | null>> {
  const coordinates = [PACK_SQUARE, ...points]
    .map((point) => `${point.lng},${point.lat}`)
    .join(';');
  const response = await fetch(`${OSRM_URL}/${coordinates}?sources=0&annotations=duration`, {
    headers: { 'User-Agent': 'avlgo-camps-geo-test (https://www.avlgo.com)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
  const json = (await response.json()) as { code: string; durations: Array<Array<number | null>> };
  if (json.code !== 'Ok') throw new Error(`OSRM ${json.code}`);
  return json.durations[0].slice(1).map((seconds) => (seconds === null ? null : seconds / 60));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main(): Promise<void> {
  const cachePath = join(PILOT_DIR, 'geocode.json');
  const pilotCache: Record<string, PilotHit> = existsSync(cachePath) ? readJson(cachePath) : {};

  // 1. Placement
  const sites = [...pilotSites(), ...EXTRA_SITES];
  const placed = new Map<TestSite, SiteGeo | null>();
  const groups = new Map<
    string,
    { total: number; now: Record<string, number>; pilot: Record<string, number> }
  >();

  console.log(`\n=== Placement: ${sites.length} distinct sites (now | pilot | query | match) ===`);
  for (const site of sites) {
    const text = geocodeText(site);
    const geo = await geocodeSite(site).catch((error) => {
      console.warn(`geocodeSite failed for "${text}": ${String(error)}`);
      return null;
    });
    placed.set(site, geo);
    const pilot = pilotCache[text];
    const before = describePilot(pilot);
    const after = geo ? geo.source : 'none';

    const name = !site.address
      ? 'Venue name only'
      : pilot === undefined
        ? 'Street address, not in the pilot'
        : 'Street address, tried in the pilot';
    const group = groups.get(name) ?? { total: 0, now: {}, pilot: {} };
    groups.set(name, group);
    group.total++;
    group.now[after] = (group.now[after] ?? 0) + 1;
    if (pilot !== undefined) group.pilot[before] = (group.pilot[before] ?? 0) + 1;

    // How far the new point is from the pilot's, when the pilot had one at all.
    const moved = geo && pilot ? ` (${kmBetween(geo, pilot).toFixed(2)} km from the pilot's)` : '';
    console.log(
      `${after.padEnd(6)} | ${before.padEnd(11)} | ${text.slice(0, 55).padEnd(55)} | ${geo?.label ?? '-'}${moved}`
    );
  }

  console.log('');
  for (const [name, group] of groups) {
    const pilot = Object.keys(group.pilot).length
      ? `; pilot ORS: ${formatCounts(group.pilot)}`
      : '';
    console.log(`${name} (${group.total}): now ${formatCounts(group.now)}${pilot}`);
  }

  // 2. Drive time: ORS vs OSRM on the same points, preferring a Census point when a name repeats.
  const sample = DRIVE_SAMPLE.flatMap((wanted) => {
    const candidates = sites
      .filter((site) => site.name === wanted || site.address?.startsWith(wanted))
      .map((site) => ({ site, geo: placed.get(site) ?? pilotPoint(pilotCache[geocodeText(site)]) }))
      .filter((candidate): candidate is { site: TestSite; geo: SiteGeo } => candidate.geo !== null);
    const pick = candidates.find(({ geo }) => geo.source === 'census') ?? candidates[0];
    if (!pick) console.warn(`Drive sample: "${wanted}" has no point`);
    return pick ? [pick] : [];
  });
  const points = sample.map(({ geo }) => geo);
  const ors = await driveMinutesFromDowntown(points);
  const osrm = await osrmMinutes(points);

  console.log(`\n=== Drive minutes from Pack Square: ORS vs OSRM (${sample.length} sites) ===`);
  const ratios: number[] = [];
  sample.forEach(({ site, geo }, index) => {
    const a = ors[index];
    const b = osrm[index];
    const ratio = a !== null && b !== null && b > 0 ? a / b : null;
    if (ratio !== null) ratios.push(ratio);
    const km = kmBetween(PACK_SQUARE, geo).toFixed(1);
    console.log(
      `${site.name.slice(0, 40).padEnd(40)} ${km.padStart(5)} km  ORS ${a?.toFixed(1).padStart(5) ?? '  -  '}` +
        `  OSRM ${b?.toFixed(1).padStart(5) ?? '  -  '}  ratio ${ratio?.toFixed(2) ?? '-'}  (${geo.source}: ${geo.label})`
    );
  });
  if (ratios.length) {
    const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
    console.log(
      `\nORS/OSRM ratio: median ${median(ratios).toFixed(2)}, mean ${mean.toFixed(2)}, ` +
        `range ${Math.min(...ratios).toFixed(2)}-${Math.max(...ratios).toFixed(2)}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
