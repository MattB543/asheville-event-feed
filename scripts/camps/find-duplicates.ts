/**
 * Summer camps: find camps listed twice, for review. Discovery deduped providers (by domain and
 * name), but nothing dedupes camps: "Mars Hill Junior Cycling Camp" is a card under both the
 * cycling camp and Mars Hill University, which hosts it.
 *
 * Every pair of live, in-radius camps (queryCamps), across providers and within one, is scored on
 * cheap signals: the same camp page or registration link (a registration platform's shared root
 * says nothing, lib/camps/platforms.ts), shared source pages or domains, name similarity weighted by
 * how rare the shared words are (so two churches' "Vacation Bible School" is not a match by name
 * alone), the same session dates, sites within 2 km or in one town, the same type, and overlapping
 * ages. A pair needs a name match or a shared link to count at all, or every two camps at one
 * college campus would. Pairs at or above the threshold go to data/camps/duplicate-candidates.json
 * with the signals that fired and both cards side by side.
 *
 * A reviewer (an Opus agent, or Matt) decides each pair and writes the decision to
 * data/camps/duplicates.json: `duplicates` drop one camp_key in favour of another (queryCamps
 * excludes every dropped key, so the directory, camp pages, sitemap, exports and feed events
 * follow), `distinct` records pairs judged not to be duplicates, so a later run marks them decided.
 * A dropped camp no longer appears here, so a re-run shows only pairs still to decide.
 *
 * Reads the database, writes only the candidates file.
 *
 * Usage:
 *   npx tsx scripts/camps/find-duplicates.ts [--min=<score>]
 */
import '../../lib/config/env';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryCamps, type CampListing } from '../../lib/db/queries/camps';
import { kmBetween } from '../../lib/camps/geo';
import {
  isSocialUrl,
  platformOf,
  platformTenant,
  registrableDomain,
} from '../../lib/camps/platforms';

const CANDIDATES_FILE = join(process.cwd(), 'data', 'camps', 'duplicate-candidates.json');
const DECISIONS_FILE = join(process.cwd(), 'data', 'camps', 'duplicates.json');

/**
 * Generous: a reviewer reads every pair, so a miss costs more than a pair to wave through. The
 * weakest real duplicates in the first review (2026-10-29) scored 4 to 4.5; below 4 were generic
 * names ("Counselor in Training", "Vacation Bible School" in one town) and camps sharing a host.
 */
const DEFAULT_MIN_SCORE = 4;

/** Sites this close are one place; within NEAR_KM, one campus or block; past FAR_KM, unrelated. */
const SAME_SITE_KM = 0.3;
const NEAR_KM = 2;
const FAR_KM = 20;

/** Words every camp name uses; they say nothing about which camp it is. */
const NAME_STOPWORDS = new Set([
  'camp',
  'camps',
  'summer',
  'the',
  'and',
  'of',
  'for',
  'at',
  'a',
  'an',
  'in',
  'with',
  'program',
  'programs',
  'session',
  'sessions',
  'week',
  'weeks',
]);

/**
 * A shared name word counts for its rarity (inverse document frequency over live camp names) above
 * COMMON_IDF, so "vacation bible school", in ~1 name in 17, adds little; a match counts in full
 * once the shared words' rarity sums to FULL_RARITY.
 */
const COMMON_IDF = 2;
const FULL_RARITY = 6;

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

function nameTokens(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !NAME_STOPWORDS.has(word) && !/^(?:19|20)\d\d$/.test(word))
    // "Camps" and "Camp", "Kids" and "Kid": a crude plural is enough here
    .map((word) =>
      word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
    );
  return [...new Set(words)];
}

/**
 * A URL's identity: host without www plus path, no query, fragment or trailing slash. A
 * registration platform's URL is the camp's only with the account in it (platformTenant); a bare
 * platform link is null, since one host serves many unrelated camps.
 */
function urlKey(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const page = `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
  if (!platformOf(url)) return page;
  const tenant = platformTenant(url);
  return tenant ? `${page}#${tenant}` : null;
}

/** The camp's own domains: its page, registration and sources, minus platforms and social hosts. */
function ownDomains(card: CampListing['card']): Set<string> {
  const domains = new Set<string>();
  for (const url of [card.camp_page_url, card.registration_url, ...card.sources]) {
    if (!url || platformOf(url) || isSocialUrl(url)) continue;
    const domain = registrableDomain(url);
    if (domain) domains.add(domain);
  }
  return domains;
}

interface Profile {
  camp: CampListing;
  tokens: string[];
  page: string | null;
  registration: string | null;
  sources: Set<string>;
  domains: Set<string>;
  sessionStarts: Set<string>;
  towns: Set<string>;
}

function profile(camp: CampListing): Profile {
  const { card } = camp;
  return {
    camp,
    tokens: nameTokens(card.name),
    page: urlKey(card.camp_page_url),
    registration: urlKey(card.registration_url),
    sources: new Set(card.sources.map(urlKey).filter((key): key is string => key !== null)),
    domains: ownDomains(card),
    sessionStarts: new Set(card.sessions.map((session) => session.start)),
    towns: new Set(
      camp.sites
        .filter((site) => site.town?.trim())
        .map(
          (site) => `${site.town!.trim().toLowerCase()}, ${(site.state ?? '').trim().toUpperCase()}`
        )
    ),
  };
}

type Range = { min: number | null; max: number | null } | null;

/** Null when either range is unknown; a missing bound is open. */
function rangesOverlap(a: Range, b: Range): boolean | null {
  if (!a || !b || (a.min === null && a.max === null) || (b.min === null && b.max === null)) {
    return null;
  }
  return (a.max ?? Infinity) >= (b.min ?? -Infinity) && (b.max ?? Infinity) >= (a.min ?? -Infinity);
}

function closestKm(a: CampListing, b: CampListing): number {
  let best = Infinity;
  for (const p of a.sites) {
    for (const q of b.sites) {
      if (p.lat === null || p.lng === null || q.lat === null || q.lng === null) continue;
      best = Math.min(best, kmBetween({ lat: p.lat, lng: p.lng }, { lat: q.lat, lng: q.lng }));
    }
  }
  return best;
}

function intersect<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((item) => b.has(item));
}

interface Scored {
  score: number;
  signals: string[];
  /**
   * Something says these could be one camp: a name match or a shared link. Without one, two camps
   * at one host (a college campus, a church camp) score on place, domain and type alone.
   */
  linked: boolean;
}

function scorePair(a: Profile, b: Profile, idf: Map<string, number>): Scored {
  const sameProvider = a.camp.providerKey === b.camp.providerKey;
  const signals: string[] = [];
  let score = 0;
  let linked = false;
  const add = (points: number, signal: string) => {
    score += points;
    signals.push(`${signal} (${points > 0 ? '+' : ''}${Math.round(points * 10) / 10})`);
  };

  // Name: rarity-weighted overlap, scaled down when the shared words are common ones
  const weight = (tokens: string[]) =>
    tokens.reduce((sum, token) => sum + (idf.get(token) ?? 0), 0);
  const shared = a.tokens.filter((token) => b.tokens.includes(token));
  if (shared.length) {
    const sharedWeight = weight(shared);
    const similarity = Math.max(
      sharedWeight / weight([...new Set([...a.tokens, ...b.tokens])]),
      0.8 * (sharedWeight / Math.min(weight(a.tokens), weight(b.tokens)))
    );
    const rarity = shared.reduce(
      (sum, token) => sum + Math.max(0, (idf.get(token) ?? 0) - COMMON_IDF),
      0
    );
    const points = 5 * similarity * Math.min(1, rarity / FULL_RARITY);
    if (points >= 0.5) add(points, `name: ${shared.join(' ')}`);
    linked = points >= 1;
  }

  // Links: across providers they point at one organization. Within one they are expected.
  if (!sameProvider) {
    if (a.page && a.page === b.page) add(a.page.includes('/') ? 4 : 2, 'same camp page');
    if (a.registration && a.registration === b.registration) add(3, 'same registration link');
    const sources = intersect(a.sources, b.sources);
    // One shared page is often a host's list of every camp it hosts; two are the same reading
    if (sources.length) add(sources.length > 1 ? 3 : 2, `${sources.length} shared sources`);
    if ((a.page && a.page === b.page) || (a.registration && a.registration === b.registration)) {
      linked = true;
    }
    if (sources.length) linked = true;
    const domains = intersect(a.domains, b.domains);
    if (domains.length) add(1.5, `same domain: ${domains.join(', ')}`);
  }

  // When: every camp's weeks start on the same Mondays, so only mostly-shared dates count
  const starts = intersect(a.sessionStarts, b.sessionStarts);
  const union = new Set([...a.sessionStarts, ...b.sessionStarts]).size;
  const sa = a.camp.card.season;
  const sb = b.camp.card.season;
  if (starts.length && starts.length / union >= 0.5) {
    add(1, `${starts.length} of ${union} session starts shared`);
  } else if (sa.start && sa.end && sa.start === sb.start && sa.end === sb.end) {
    add(1, 'same season dates');
  }

  // Where: one provider's camps share its sites, so place only counts across providers
  if (!sameProvider) {
    const km = closestKm(a.camp, b.camp);
    const towns = intersect(a.towns, b.towns);
    if (km <= SAME_SITE_KM) add(2, `sites ${km.toFixed(1)} km apart`);
    else if (km <= NEAR_KM) add(1, `sites ${km.toFixed(1)} km apart`);
    else if (towns.length) add(0.5, `same town: ${towns[0]}`);
    else if (km > FAR_KM && km !== Infinity) add(-2, `sites ${Math.round(km)} km apart`);
  }

  // One card per program and camp type, so within a provider a different type is a different
  // card. Across providers only overnight vs not is a sure difference: two readers can call one
  // camp a day camp and a clinic.
  const { type } = a.camp.card;
  const otherType = b.camp.card.type;
  if (type === otherType) add(0.5, `both ${type}`);
  else if (sameProvider || (type === 'overnight') !== (otherType === 'overnight')) {
    add(-1, `${type} vs ${otherType}`);
  }
  const kids =
    rangesOverlap(a.camp.card.ages, b.camp.card.ages) ??
    rangesOverlap(a.camp.card.grades, b.camp.card.grades);
  if (kids === true) add(0.5, 'ages overlap');
  if (kids === false) add(-2, 'ages do not overlap');

  return { score: Math.round(score * 10) / 10, signals, linked };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatRange(range: Range, unit: string): string | null {
  if (!range || (range.min === null && range.max === null)) return null;
  return `${unit} ${range.min ?? '?'}-${range.max ?? '?'}`;
}

/** The facts a reviewer compares, compactly. */
function side(camp: CampListing) {
  const { card } = camp;
  const starts = card.sessions.map((session) => session.start).sort();
  return {
    campKey: camp.campKey,
    slug: camp.slug,
    provider: camp.providerName,
    name: card.name,
    type: card.type,
    campPage: card.camp_page_url,
    registration: card.registration_url,
    sources: card.sources.slice(0, 4),
    season: [card.season.year, card.season.start, card.season.end].filter(Boolean).join(' '),
    who:
      [formatRange(card.ages, 'ages'), formatRange(card.grades, `grades (${card.grades?.basis})`)]
        .filter(Boolean)
        .join(', ') || null,
    sites: camp.sites.map((site) =>
      [site.name, site.address, site.town].filter(Boolean).join(', ')
    ),
    sessions: starts.length
      ? `${starts.length}: ${starts[0]}${starts.length > 1 ? ` .. ${starts[starts.length - 1]}` : ''}`
      : null,
    prices: card.prices
      .slice(0, 4)
      .map((tier) => `$${tier.amount}/${tier.unit}${tier.label ? ` (${tier.label})` : ''}`),
    description: card.description,
  };
}

interface Decisions {
  duplicates?: Array<{ drop: string; keep: string }>;
  distinct?: Array<{ a: string; b: string }>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

async function main() {
  const minArg = process.argv.find((arg) => arg.startsWith('--min='));
  const minScore = minArg ? Number(minArg.slice('--min='.length)) : DEFAULT_MIN_SCORE;
  if (!Number.isFinite(minScore)) throw new Error(`Not a score: ${minArg}`);

  const camps = await queryCamps();
  const profiles = camps.map(profile);

  // Rarity of each name word across live camps (inverse document frequency)
  const counts = new Map<string, number>();
  for (const { tokens } of profiles) {
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const idf = new Map(
    [...counts].map(([token, count]) => [token, Math.log(profiles.length / count)])
  );

  const decisions: Decisions = JSON.parse(readFileSync(DECISIONS_FILE, 'utf8'));
  const decided = new Map<string, string>();
  for (const { drop, keep } of decisions.duplicates ?? []) {
    decided.set(pairKey(drop, keep), `duplicate: drop ${drop}`);
  }
  for (const { a, b } of decisions.distinct ?? []) decided.set(pairKey(a, b), 'distinct');

  const candidates = [];
  const histogram = new Map<number, number>();
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const { score, signals, linked } = scorePair(profiles[i], profiles[j], idf);
      if (!linked) continue;
      if (score >= 3) histogram.set(Math.floor(score), (histogram.get(Math.floor(score)) ?? 0) + 1);
      if (score < minScore) continue;
      const [a, b] = [profiles[i].camp, profiles[j].camp];
      candidates.push({
        score,
        sameProvider: a.providerKey === b.providerKey,
        decision: decided.get(pairKey(a.campKey, b.campKey)) ?? null,
        signals,
        a: side(a),
        b: side(b),
      });
    }
  }
  candidates.sort((x, y) => y.score - x.score || x.a.campKey.localeCompare(y.a.campKey));

  writeFileSync(
    CANDIDATES_FILE,
    `${JSON.stringify(
      {
        about:
          'Possible duplicate camps (scripts/camps/find-duplicates.ts), highest score first. Decide each in data/camps/duplicates.json. Regenerated on every run; a dropped camp no longer appears.',
        generatedAt: new Date().toISOString(),
        minScore,
        camps: camps.length,
        pairs: candidates.length,
        candidates,
      },
      null,
      2
    )}\n`
  );

  console.log(`${camps.length} live camps; ${candidates.length} pairs scored ${minScore} or more`);
  console.log(
    `  across providers: ${candidates.filter((c) => !c.sameProvider).length}, within one: ${candidates.filter((c) => c.sameProvider).length}`
  );
  console.log(`  undecided: ${candidates.filter((c) => c.decision === null).length}`);
  console.log('Pairs by score (3 and up):');
  for (const [bucket, count] of [...histogram].sort(([a], [b]) => b - a)) {
    console.log(`  ${bucket}+: ${count}`);
  }

  // A decision whose kept camp is gone leaves the program with no card at all
  const live = new Set(camps.map((camp) => camp.campKey));
  for (const { drop, keep } of decisions.duplicates ?? []) {
    if (!live.has(keep)) console.log(`  ! ${drop} is dropped for ${keep}, which is not live`);
  }
  console.log('Wrote data/camps/duplicate-candidates.json');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
