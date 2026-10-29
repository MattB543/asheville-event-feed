/**
 * Camps pilot, step 3: verified extractions + the WebTrac catalog -> geocode and drive time ->
 * data/camps/pilot/import.json, rows shaped like the drizzle/0025_camps.sql tables (keyed by
 * camp_key). The rough /camps pages read this file until the migration is approved and applied.
 *
 * Asheville Parks & Rec's cards come from the deterministic WebTrac parser, not the model; the
 * model's cards for the same provider are kept only for the cross-check in the pilot report.
 *
 * Usage:
 *   npx tsx scripts/camps/build-pilot.ts                  # bundle-mode extractions
 *   npx tsx scripts/camps/build-pilot.ts --mode search
 */
import '../../lib/config/env';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORS_ATTRIBUTION,
  checkRadius,
  driveMinutesFromDowntown,
  geocode,
  geocodeText,
  isGeoConfigured,
  plausibleMatch,
  type Geocode,
  type GeocodeQuery,
} from '../../lib/camps/geo';
import {
  buildAvailabilityRow,
  buildCampRow,
  buildMilestoneRows,
  buildSeasonRows,
  tallyCard,
  type AvailabilityRow,
  type CampRow,
  type MilestoneRow,
  type SeasonRow,
} from '../../lib/camps/importRows';
import {
  isPublishable,
  type Evidence,
  type ExtractedCard,
  type Extraction,
} from '../../lib/camps/types';
import { evidenceItems } from '../../lib/camps/types';
import { WEBTRAC_PROVIDER, webTracCards, type WebTracCatalog } from '../../lib/camps/webtrac';
import type { SavedVerification } from './run-pilot';

const PILOT_DIR = join(process.cwd(), 'data', 'camps', 'pilot');
const GEOCODE_CACHE = join(PILOT_DIR, 'geocode.json');

export interface CampGeo {
  query: string;
  /** Where the site came from: the card's own page or the provider's known site. */
  source: 'card' | 'provider_site';
  lat: number;
  lng: number;
  label: string;
  confidence: number;
  /** Pelias layer: 'address' | 'street' | 'venue' are a site; 'locality' etc. only a town centroid. */
  layer: string;
  approximate: boolean;
  driveMinutes: number | null;
  limit: number;
  inRadius: boolean | null;
  nearCutoff: boolean;
}

export interface PilotImport {
  generatedAt: string;
  mode: string;
  attribution: string;
  providers: Array<{
    key: string;
    name: string;
    websiteUrl: string | null;
    notes: string | null;
    excluded: Extraction['excluded'];
    covers: string[];
    source: 'model' | 'webtrac';
  }>;
  camps: CampRow[];
  seasons: SeasonRow[];
  milestones: MilestoneRow[];
  availability: AvailabilityRow[];
  observations: Array<{
    url: string;
    kind: 'fetch';
    ok: boolean;
    fetchMethod: string | null;
    error: string | null;
    observedAt: string;
  }>;
  geo: Record<string, CampGeo | null>;
  quality: Record<string, { total: number; verified: number; review: number; dropped: number }>;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const mode = arg('--mode') ?? 'bundle';
  const verifiedDir = join(PILOT_DIR, 'verified', mode);
  const files = readdirSync(verifiedDir).filter((file) => file.endsWith('.json'));
  const webtrac = existsSync(join(PILOT_DIR, 'webtrac.json'))
    ? (JSON.parse(readFileSync(join(PILOT_DIR, 'webtrac.json'), 'utf8')) as WebTracCatalog)
    : null;

  const out: PilotImport = {
    generatedAt: new Date().toISOString(),
    mode,
    attribution: ORS_ATTRIBUTION,
    providers: [],
    camps: [],
    seasons: [],
    milestones: [],
    availability: [],
    observations: [],
    geo: {},
    quality: {},
  };
  const slugs = new Set<string>();
  const handChecks = existsSync(join(PILOT_DIR, 'hand-checks.json'))
    ? (
        JSON.parse(readFileSync(join(PILOT_DIR, 'hand-checks.json'), 'utf8')) as {
          checks: HandCheck[];
        }
      ).checks
    : [];
  const sites = new Map<string, SiteCandidates>();
  const { providers: providerList } = JSON.parse(
    readFileSync(join(PILOT_DIR, 'providers.json'), 'utf8')
  ) as {
    providers: Array<{ key: string; site?: string }>;
  };
  const providerSites = new Map(providerList.map((p) => [p.key, p.site]));

  for (const file of files) {
    const verification = JSON.parse(
      readFileSync(join(verifiedDir, file), 'utf8')
    ) as SavedVerification;
    const { provider, extraction, report } = verification;
    const useWebTrac = !!(provider as { webtrac?: boolean }).webtrac && webtrac;
    const cards: ExtractedCard[] = useWebTrac ? webTracCards(webtrac) : extraction.cards;

    out.providers.push({
      key: provider.key,
      name: useWebTrac ? WEBTRAC_PROVIDER : extraction.provider_name,
      websiteUrl: extraction.website_url,
      notes: extraction.notes,
      excluded: extraction.excluded,
      covers: (provider as { covers?: string[] }).covers ?? [],
      source: useWebTrac ? 'webtrac' : 'model',
    });
    for (const page of report.pages) {
      out.observations.push({
        url: page.url,
        kind: 'fetch',
        ok: page.ok,
        fetchMethod: page.method ?? null,
        error: page.error ?? null,
        observedAt: verification.verifiedAt,
      });
    }

    const providerExtraction: Extraction = useWebTrac
      ? {
          ...extraction,
          provider_name: WEBTRAC_PROVIDER,
          website_url: 'https://www.ashevillenc.gov/department/parks-recreation/',
        }
      : extraction;
    applyHandChecks(provider.key, cards, handChecks);
    for (const card of cards) {
      const camp = buildCampRow(provider.key, providerExtraction, card, ['pilot'], slugs);
      if (out.camps.some((existing) => existing.campKey === camp.campKey)) {
        camp.campKey = `${camp.campKey}:${camp.slug}`;
      }
      out.camps.push(camp);
      out.seasons.push(...buildSeasonRows(camp.campKey, card));
      out.milestones.push(...buildMilestoneRows(camp.campKey, card));
      const availability = buildAvailabilityRow(camp.campKey, card);
      if (availability) out.availability.push(availability);
      out.quality[camp.campKey] = tallyCard(card);

      const own = card.locations.filter(
        (loc) => isPublishable(loc.check) && (loc.address || loc.town)
      );
      const providerSite = providerSites.get(provider.key);
      sites.set(camp.campKey, {
        overnight: card.type === 'overnight',
        candidates: [
          ...own.map((location) => ({ query: location as GeocodeQuery, source: 'card' as const })),
          ...(providerSite
            ? [
                {
                  query: { name: providerSite, address: null, town: null, state: null },
                  source: 'provider_site' as const,
                },
              ]
            : []),
        ],
      });
    }
  }

  await addGeo(out, sites);
  writeFileSync(join(PILOT_DIR, 'import.json'), JSON.stringify(out, null, 2) + '\n');

  const geos = Object.values(out.geo);
  console.log(
    `${out.providers.length} providers -> ${out.camps.length} camps, ${out.seasons.length} season rows, ` +
      `${out.milestones.length} milestones, ${out.availability.length} availability rows; ` +
      `geocoded ${geos.filter(Boolean).length}/${out.camps.length} ` +
      `(${geos.filter((geo) => geo?.approximate).length} approximate, ` +
      `${geos.filter((geo) => geo?.inRadius === false).length} outside D3, ` +
      `${geos.filter((geo) => geo?.nearCutoff).length} within 5 min of the cutoff)`
  );
}

interface HandCheck {
  provider: string;
  field: string;
  match?: Record<string, unknown>;
  result: 'confirmed';
  checkedAt: string;
  checkedBy: string;
  source?: string;
  note?: string;
}

/** Mark the facts a person confirmed (data/camps/pilot/hand-checks.json) so they can be published. */
function applyHandChecks(providerKey: string, cards: ExtractedCard[], checks: HandCheck[]): void {
  for (const handCheck of checks.filter((c) => c.provider === providerKey)) {
    for (const card of cards) {
      for (const { field, evidence } of evidenceItems(card)) {
        if (field !== handCheck.field || !evidence.check) continue;
        const record = evidence as Evidence & Record<string, unknown>;
        const matches = Object.entries(handCheck.match ?? {}).every(
          ([key, value]) => record[key] === value
        );
        if (!matches) continue;
        evidence.check.handCheckedAt = handCheck.checkedAt;
        evidence.check.handCheckedBy = handCheck.checkedBy;
        evidence.check.handCheckNote = handCheck.note;
        // Reynolds' dates were confirmed on the church's own Facebook event, not the listing cited.
        if (handCheck.source && handCheck.source !== evidence.url) {
          evidence.check.handCheckSource = handCheck.source;
        }
      }
    }
  }
}

interface SiteCandidates {
  overnight: boolean;
  candidates: Array<{ query: GeocodeQuery; source: CampGeo['source'] }>;
}

/**
 * Geocode each camp's site (cached by query), taking the first candidate whose match is
 * plausible: the card's own site, then the provider's known site (never a sibling card's: Wrestling
 * Camp has no stated site and must not inherit Burton Street's). Then one
 * 1xN driving matrix from Pack Square.
 */
async function addGeo(out: PilotImport, sites: Map<string, SiteCandidates>): Promise<void> {
  for (const camp of out.camps) out.geo[camp.campKey] = null;
  if (!isGeoConfigured()) {
    console.warn('OPENROUTE_SERVICE_API_KEY not set: skipping geocoding and drive times');
    return;
  }

  const cache: Record<string, Geocode | null> = existsSync(GEOCODE_CACHE)
    ? JSON.parse(readFileSync(GEOCODE_CACHE, 'utf8'))
    : {};
  const chosen = new Map<string, { text: string; source: CampGeo['source'] }>();
  const rejected = new Set<string>();

  for (const [campKey, { candidates }] of sites) {
    for (const { query, source } of candidates) {
      const text = geocodeText(query);
      if (!(text in cache)) {
        cache[text] = await geocode(query).catch((error) => {
          console.warn(`Geocode failed for "${text}": ${String(error)}`);
          return null;
        });
      }
      const hit = cache[text];
      if (hit && plausibleMatch(text, hit)) {
        chosen.set(campKey, { text, source });
        break;
      }
      if (hit) rejected.add(`"${text}" -> ${hit.label}`);
    }
  }
  writeFileSync(GEOCODE_CACHE, JSON.stringify(cache, null, 2) + '\n');
  for (const line of rejected) console.warn(`Rejected implausible geocode: ${line}`);

  // Only site-level matches are routed: a town centroid's drive time means nothing.
  const isSite = (text: string) => ['address', 'street', 'venue'].includes(cache[text]!.layer);
  const points = [...new Set([...chosen.values()].map(({ text }) => text))].filter(isSite);
  const minutes = await driveMinutesFromDowntown(points.map((text) => cache[text]!));
  const minutesByQuery = new Map(points.map((text, index) => [text, minutes[index]]));

  for (const [campKey, { text, source }] of chosen) {
    const hit = cache[text]!;
    const drive = minutesByQuery.get(text) ?? null;
    const overnight = sites.get(campKey)!.overnight;
    // A town centroid can't decide D3 inclusion or give a drive time; both stay unknown.
    const radius = drive === null ? null : checkRadius(drive, overnight);
    out.geo[campKey] = {
      query: text,
      source,
      lat: hit.lat,
      lng: hit.lng,
      label: hit.label,
      confidence: hit.confidence,
      layer: hit.layer,
      approximate: hit.approximate || source !== 'card',
      driveMinutes: drive === null ? null : Math.round(drive * 10) / 10,
      limit: radius?.limit ?? (overnight ? 75 : 55),
      inRadius: radius?.inRadius ?? null,
      nearCutoff: radius?.nearCutoff ?? false,
    };
    for (const season of out.seasons) {
      if (season.campKey === campKey && drive !== null)
        season.driveSeconds = Math.round(drive * 60);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
