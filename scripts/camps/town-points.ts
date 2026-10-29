/**
 * Summer camps: build data/camps/town-points.json, the town centroids and drive minutes that
 * queryCamps (lib/db/queries/camps.ts) uses for a site with no point, and for a camp that lists no
 * sites (its provider's area town). Run it after an import, since new sites bring new towns.
 *
 * Towns: every "Town, ST" a site without a point names (its camp_sites row, or a camp card's own
 * wording of it), and every provider's area (townFromArea). Each is looked up once (geocodeTown:
 * ORS locality layer, its own name in that state) and routed from Pack Square (ORS matrix); misses
 * are kept as null so they aren't asked again. Delete an entry to look it up again.
 *
 * Reads the database, writes only the file.
 *
 * Usage:
 *   npx tsx scripts/camps/town-points.ts
 */
import '../../lib/config/env';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { campProviders, camps, campSites } from '../../lib/db/schema';
import { effectiveCard } from '../../lib/db/queries/camps';
import {
  driveMinutesFromDowntown,
  geocodeTown,
  townFromArea,
  townKey,
  type TownPoint,
} from '../../lib/camps/geo';

const FILE = join(process.cwd(), 'data', 'camps', 'town-points.json');
// ORS's free plan allows 100 geocodes a minute
const LOOKUP_GAP_MS = 700;

async function main() {
  const points: Record<string, TownPoint | null> = existsSync(FILE)
    ? JSON.parse(readFileSync(FILE, 'utf8'))
    : {};

  const [siteRows, campRows, providerRows] = await Promise.all([
    db
      .select({
        providerKey: campSites.providerKey,
        name: campSites.name,
        town: campSites.town,
        state: campSites.state,
        lat: campSites.lat,
      })
      .from(campSites),
    db
      .select({ providerKey: camps.providerKey, card: camps.card, override: camps.override })
      .from(camps)
      .innerJoin(campProviders, eq(camps.providerKey, campProviders.key)),
    db.select({ area: campProviders.area }).from(campProviders),
  ]);

  const towns = new Map<string, { town: string; state: string }>();
  const want = (town: string | null, state: string | null) => {
    if (town?.trim() && state?.trim()) towns.set(townKey(town, state), { town, state });
  };
  const placed = new Set(
    siteRows.filter((site) => site.lat !== null).map((site) => `${site.providerKey}\n${site.name}`)
  );
  for (const site of siteRows) if (site.lat === null) want(site.town, site.state);
  for (const row of campRows) {
    for (const site of effectiveCard(row).sites) {
      if (!placed.has(`${row.providerKey}\n${site.name}`)) want(site.town, site.state);
    }
  }
  for (const { area } of providerRows) {
    const town = townFromArea(area);
    if (town) want(town.town, town.state);
  }

  const missing = [...towns].filter(([key]) => !(key in points));
  console.log(`${towns.size} towns; ${missing.length} not in town-points.json yet`);
  const found: string[] = [];
  for (const [index, [key, { town, state }]] of missing.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, LOOKUP_GAP_MS));
    const point = await geocodeTown(town, state);
    points[key] = point && { ...point, minutes: null };
    if (point) found.push(key);
    else console.log(`  - ${key}: no town of that name in ORS`);
  }

  // New points, and any an earlier run couldn't route
  const toRoute = Object.entries(points).filter(
    (entry): entry is [string, TownPoint] => entry[1] !== null && entry[1].minutes === null
  );
  if (toRoute.length) {
    const minutes = await driveMinutesFromDowntown(toRoute.map(([, point]) => point));
    toRoute.forEach(([key, point], index) => {
      point.minutes = minutes[index];
      if (minutes[index] === null) console.log(`  ! ${key}: ORS found no route`);
    });
  }
  for (const key of found) {
    const minutes = points[key]?.minutes;
    console.log(`  + ${key}: ${minutes == null ? 'no route' : `${Math.round(minutes)} min`}`);
  }

  const sorted = Object.fromEntries(Object.entries(points).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  const known = Object.values(points).filter((point) => point?.minutes != null).length;
  console.log(
    `\nWrote ${Object.keys(points).length} towns (${known} with drive minutes) to data/camps/town-points.json`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
