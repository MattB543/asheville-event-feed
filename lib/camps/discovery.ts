/**
 * Camp discovery (docs/camps/01-context-and-plan.md §6.1, 04-v2-plan.md §3): every organization
 * running kids' summer programs within the D3 radius, for data/camps/providers.json.
 *
 * Methods (scripts/camps/discover.ts saves each call's raw candidates under data/camps/discovery/):
 *   pilot, seed_sheet                 the 20 pilot providers and the exa sheet; no model calls
 *   macaroni_kid, beyond_school, news828   local guides: our fetcher reads them, Sol lists them (no search)
 *   our_db                            camp-like titles in our events table, read by Sol (no search)
 *   grid, aggregator, gap_fill        Sol + web_search
 *   resolve                           Sol + web_search finds the official page of a name-only provider
 *
 * Merging is code, never the model (Sol never sees the growing list): one provider per site
 * (registrable domain, a platform account, a social page; never a platform's domain alone), then
 * per normalized name in a compatible town. A provider whose first page doesn't load, or doesn't
 * mention a kids' program, is kept with status 'review': a failed fetch can be a block.
 */

import {
  CAMP_CATEGORIES,
  CAMP_TYPES,
  slugPart,
  type CampCategory,
  type CampType,
  type Provider,
} from './contract';
import { FetchPageError, type PageLink, type PageTextFetcher } from './fetchPageText';
import { isSocialUrl, platformOf, platformTenant, registrableDomain } from './platforms';
import { createResponse, type ResponsesResult } from './responses';
import type { SeedRow } from './seedSheet';

export const DISCOVERY_METHODS = [
  'pilot',
  'seed_sheet',
  'macaroni_kid',
  'beyond_school',
  'news828',
  'our_db',
  'grid',
  'aggregator',
  'gap_fill',
  'resolve',
] as const;
export type DiscoveryMethod = (typeof DISCOVERY_METHODS)[number];

export interface Candidate {
  name: string;
  url: string | null;
  town: string | null;
  state: string | null;
  kinds: CampType[];
  categories: CampCategory[];
  note: string | null;
  /** Set by `resolve` when the search found that it runs no kids' summer program. */
  rejected?: string;
}

/** A pilot provider as discovery carries it: the fields extraction reads, untouched. */
export type PilotProvider = Pick<Provider, 'key' | 'name' | 'urls' | 'area' | 'hint' | 'webtrac'>;

/** One saved model call or seed read: data/camps/discovery/<method>/<id>.json. */
export interface DiscoveryRun {
  method: DiscoveryMethod;
  id: string;
  /** The brief Sol was given, or what was read. */
  input: string;
  at: string;
  webSearch: boolean;
  /** Model calls, retries included; 0 for a seed read. */
  calls: number;
  usage: ResponsesResult['usage'] | null;
  searches: string[];
  ms: number;
  candidates: Candidate[];
  pilot?: PilotProvider[];
  /** For resolve runs: what was asked, so a name is never looked up twice. */
  asked?: ResolveItem[];
}

export interface DiscoveryQuery {
  method: DiscoveryMethod;
  id: string;
  input: string;
}

// ---------------------------------------------------------------------------
// The area (D3) and what counts (N8), in one place for every call
// ---------------------------------------------------------------------------

const AREA_TEXT = `Western North Carolina around Asheville: Buncombe County (Asheville, Arden, Black Mountain, Swannanoa, Montreat, Weaverville, Woodfin, Fairview, Candler, Leicester, Barnardsville, Skyland); Henderson County (Hendersonville, Fletcher, Mills River, Flat Rock, Etowah, Horse Shoe, Zirconia); Haywood County (Waynesville, Canton, Clyde, Maggie Valley, Lake Junaluska); Transylvania County (Brevard, Pisgah Forest, Rosman, Cedar Mountain, Lake Toxaway, Sapphire); Madison County (Marshall, Mars Hill, Hot Springs); Yancey and Mitchell counties (Burnsville, Spruce Pine, Bakersville); McDowell County (Marion, Old Fort, Little Switzerland); Polk and Rutherford counties (Saluda, Tryon, Columbus, Lake Lure, Chimney Rock, Rutherfordton, Forest City); Jackson and Swain counties (Sylva, Cullowhee, Cashiers, Cherokee, Bryson City); Burke County (Morganton); northeast Tennessee (Johnson City, Erwin, Jonesborough, Elizabethton, Greeneville, Newport); upstate South Carolina near the state line (Landrum, Travelers Rest, Cleveland, Marietta), plus overnight camps around Greenville, Greer and Spartanburg.`;

export function discoveryInstructions(today: string): string {
  return `You find organizations that run kids' summer programs near Asheville, North Carolina, for AVLGO, a free local directory of summer camps. Today is ${today}. The directory is for summer 2027, so include any organization that ran a program in summer 2025 or 2026 or has announced one for 2027.

WHAT COUNTS (a low bar): any finite, supervised program for kids or teens in the summer: day camps, half-day camps, overnight camps, evening programs, Vacation Bible School, sports or skill clinics (even one day), teen pre-college programs, summer-only childcare. Leave out adult-only programs, year-round classes or childcare with nothing particular to summer, sports leagues and team seasons, and online-only or national virtual camps.

WHERE: campers attend in ${AREA_TEXT} Leave out anything that takes place farther away (Charlotte, Atlanta, Raleigh, Knoxville, Boone, Highlands ...) and day camps in Greenville or Spartanburg themselves. Don't judge drive times: when a place is near the edge of this area, include it and name its town.

ONE ROW PER ORGANIZATION. Name the organization that runs the program (the museum, church, gym, studio, school, town department, nonprofit or company), not a single session or theme. A church's name includes its town ("First Baptist Church of Weaverville"). An organization that runs several programs is one row; mention them in note.

URL: the organization's own page about its summer programs (or VBS), else its home page, else its own account on a registration platform (CampDoc, UltraCamp, Ryzer, Jackrabbit ...). Never a directory, aggregator, news article, review site or search page (Macaroni Kid, KidVoyage, CampSearch, ActivityHero, allevents, Yelp, Explore Asheville, AVL Today, 828newsNOW, Mountain Xpress ...). A church's own Facebook page is fine for its VBS. Null when there is no official page.

kinds: the program types it runs. categories: what campers do. town and state: where campers attend (state as NC, SC or TN). note: one short line on its programs (ages, day or overnight), no marketing language.

Only organizations you actually found, in search results or in the text you are given. Never invent one, and never pad the list with organizations from other places. Return every qualifying organization: up to 40 from a web search, and all of them (no limit) from text you are given.`;
}

const PROVIDER_ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'url', 'town', 'state', 'kinds', 'categories', 'note'],
  properties: {
    name: { type: 'string' },
    url: { type: ['string', 'null'] },
    town: { type: ['string', 'null'] },
    state: { type: ['string', 'null'] },
    kinds: { type: 'array', items: { type: 'string', enum: [...CAMP_TYPES] } },
    categories: { type: 'array', items: { type: 'string', enum: [...CAMP_CATEGORIES] } },
    note: { type: ['string', 'null'] },
  },
};

const PROVIDERS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['providers'],
  properties: { providers: { type: 'array', items: PROVIDER_ROW_SCHEMA } },
};

// ---------------------------------------------------------------------------
// The search plan: grid, aggregator sweeps, gap-filling rounds
// ---------------------------------------------------------------------------

type AreaSize = 'core' | 'medium' | 'small' | 'overnight';

const AREAS: Array<{ id: string; places: string; size: AreaSize }> = [
  {
    id: 'asheville',
    places:
      'Asheville, NC (every part of the city: downtown, West, North, South and East Asheville)',
    size: 'core',
  },
  {
    id: 'south-buncombe',
    places: 'Arden, Fletcher, Skyland, Fairview and Mills River, NC',
    size: 'medium',
  },
  {
    id: 'east-buncombe',
    places: 'Black Mountain, Swannanoa, Montreat and Old Fort, NC',
    size: 'medium',
  },
  {
    id: 'north-buncombe-madison',
    places:
      'Weaverville, Woodfin, Leicester, Candler, Barnardsville, Marshall, Mars Hill and Hot Springs, NC',
    size: 'medium',
  },
  {
    id: 'henderson',
    places:
      'Hendersonville, Flat Rock, Etowah, Horse Shoe, Laurel Park, Zirconia and Saluda, NC (Henderson County)',
    size: 'medium',
  },
  {
    id: 'transylvania',
    places:
      'Brevard, Pisgah Forest, Rosman, Cedar Mountain, Lake Toxaway and Sapphire, NC (Transylvania County)',
    size: 'medium',
  },
  {
    id: 'haywood',
    places: 'Waynesville, Canton, Clyde, Maggie Valley and Lake Junaluska, NC (Haywood County)',
    size: 'medium',
  },
  {
    id: 'jackson-swain',
    places: 'Sylva, Dillsboro, Cullowhee, Cashiers, Cherokee and Bryson City, NC',
    size: 'small',
  },
  {
    id: 'mcdowell-yancey-mitchell',
    places:
      'Marion, Old Fort, Little Switzerland, Burnsville, Spruce Pine, Bakersville and Morganton, NC',
    size: 'small',
  },
  {
    id: 'polk-rutherford',
    places:
      'Tryon, Columbus, Saluda, Lake Lure, Chimney Rock, Rutherfordton and Forest City, NC, and Landrum, SC',
    size: 'small',
  },
  {
    id: 'ne-tennessee',
    places: 'Johnson City, Erwin, Jonesborough, Elizabethton, Greeneville and Newport, Tennessee',
    size: 'small',
  },
  {
    id: 'upstate-sc',
    places:
      'upstate South Carolina near the NC line (Travelers Rest, Cleveland, Marietta, Landrum, Greer, Greenville and Spartanburg)',
    size: 'overnight',
  },
];

const OVERNIGHT_TOPIC = 'overnight, sleepaway and residential';

const TOPICS: Record<AreaSize, Record<string, string>> = {
  core: {
    arts: 'visual arts, crafts, pottery, sewing and maker',
    music: 'music (instruments, bands, rock camp, choir, strings)',
    theater: 'theater, drama, musical theater, improv and film-making',
    dance: 'dance and ballet',
    stem: 'STEM, science, coding, robotics, engineering, Lego and game design',
    nature: 'nature, outdoor adventure, farm, wilderness, climbing, paddling and fishing',
    'sports-team':
      'team sports (soccer, basketball, baseball, softball, volleyball, football, lacrosse, ultimate)',
    'sports-individual':
      'tennis, golf, swimming, gymnastics, cheer, ninja, parkour, martial arts, skating, skateboarding and biking',
    horses: 'horseback riding and equestrian',
    cooking: 'cooking and baking',
    academic: 'academic, tutoring, reading, writing, language, chess, math and test prep',
    faith: 'church and faith-based day camps (other than Vacation Bible School)',
    general: 'traditional general day camps',
    'special-needs': 'special needs, autism, disability and inclusive',
    'pre-college': 'teen pre-college, leadership, counselor-in-training and career exploration',
    'parks-rec': 'city and county Parks & Recreation and community-center',
    childcare:
      'summer childcare and school-age summer programs (YMCA, Boys & Girls Club, child care centers)',
    overnight: OVERNIGHT_TOPIC,
  },
  medium: {
    arts: 'arts, crafts, music, theater and dance',
    stem: 'STEM, science, coding, academic, cooking and enrichment',
    outdoor: 'nature, outdoor adventure, farm, horseback riding and fishing',
    sports: 'sports (team sports, gymnastics, martial arts, swimming, tennis, golf and others)',
    faith: 'church and faith-based day camps',
    general:
      'general day camps, Parks & Recreation camps, summer childcare, YMCA and Boys & Girls Club',
    overnight: OVERNIGHT_TOPIC,
  },
  small: {
    enrichment: 'arts, music, theater, dance, STEM, academic and cooking',
    'outdoor-sports': 'outdoor adventure, nature, farm, horseback riding and sports',
    general: 'general day camps, church day camps, Parks & Recreation camps and summer childcare',
    overnight: OVERNIGHT_TOPIC,
  },
  overnight: {
    overnight: OVERNIGHT_TOPIC,
    'day-near-nc': 'day (only those in Travelers Rest, Landrum or Cleveland, SC)',
  },
};

/** Wider regions for the search terms beyond "camp" and the VBS years. */
const REGIONS: Record<string, string> = {
  buncombe: 'Asheville and Buncombe County, NC',
  south: 'Henderson, Transylvania and Polk counties, NC (Hendersonville, Brevard, Tryon)',
  west: 'Haywood, Jackson and Swain counties, NC (Waynesville, Canton, Sylva, Cherokee)',
  north:
    'Madison, Yancey, Mitchell and McDowell counties, NC (Marshall, Mars Hill, Burnsville, Marion)',
  tennessee: 'northeast Tennessee near the NC line (Johnson City, Erwin, Greeneville, Newport)',
};

const TERMS: Record<string, string> = {
  'summer-program': `kids' "summer program" offerings (programs that don't call themselves camps)`,
  'summer-childcare': '"summer childcare" and school-age summer care',
  clinic: 'youth sports or skill "clinics" held in the summer',
  enrichment: '"youth enrichment" summer programs',
};

export function gridQueries(): DiscoveryQuery[] {
  const queries: DiscoveryQuery[] = [];
  for (const area of AREAS) {
    for (const [topicId, topic] of Object.entries(TOPICS[area.size])) {
      queries.push({
        method: 'grid',
        id: `${area.id}--${topicId}`,
        input: `Find ${topic} summer camps and summer programs for kids and teens in or near ${area.places}. Search the web thoroughly (several searches with different wording and town names) and list every organization you find.`,
      });
    }
    queries.push({
      method: 'grid',
      id: `${area.id}--vbs-2026`,
      input: `Find churches that held Vacation Bible School (VBS) for kids in summer 2026 in or near ${area.places}. Search "vacation bible school 2026" and "VBS 2026" with each town name, and list every church you find with its town.`,
    });
  }
  for (const [regionId, region] of Object.entries(REGIONS)) {
    for (const [termId, term] of Object.entries(TERMS)) {
      queries.push({
        method: 'grid',
        id: `${regionId}--${termId}`,
        input: `Search the web for ${term} for kids and teens in ${region}. Use that wording in your searches, not just "camp", and list every organization you find.`,
      });
    }
    queries.push(
      {
        method: 'grid',
        id: `${regionId}--vbs-2027`,
        input: `Find churches announcing Vacation Bible School (VBS) for summer 2027 in ${region}. Search "VBS 2027" and "vacation bible school 2027" with town names, and list every church you find with its town.`,
      },
      {
        method: 'grid',
        id: `${regionId}--vbs`,
        input: `Find churches that hold Vacation Bible School (VBS) for kids in ${region}. Search "vacation bible school" and "VBS" with town names (no year), and list every church you find with its town.`,
      }
    );
  }
  return queries;
}

const AGGREGATORS: Record<string, string> = {
  'macaroni-kid-editions':
    'the Macaroni Kid editions near Asheville (Hendersonville, Brevard, Waynesville, Johnson City, Greenville SC and others) and their summer camp guides',
  kidvoyage: 'kidvoyage.com camp listings for Asheville and Western North Carolina',
  campsearch: 'campsearch.com listings of camps near Asheville, NC',
  aca: "the American Camp Association's camp finder (find.acacamps.org) for day and overnight camps near Asheville, NC",
  allevents: 'allevents.in listings of summer camps and kids camps in Asheville and nearby towns',
  'asheville-com': 'asheville.com pages about summer camps',
  'explore-asheville':
    'Explore Asheville (exploreasheville.com) pages and events about summer camps',
  activityhero:
    'ActivityHero and Sawyer (hisawyer.com) listings of summer camps in and near Asheville, NC',
  'wnc-parent': 'WNC Parent and Asheville Citizen-Times summer camp guides (2024-2026)',
  'mountain-xpress': 'Mountain Xpress (mountainx.com) summer camp and kids guides (2024-2026)',
  'hendersonville-guides':
    'Hendersonville and Henderson County summer camp guides and roundups (Hendersonville Lightning, Blue Ridge Now / Times-News, county recreation)',
  'brevard-guides':
    'Transylvania County and Brevard summer camp lists (Transylvania Times, Brevard tourism, local camp associations)',
  'haywood-guides': 'Haywood County summer camp guides (The Mountaineer, Smoky Mountain News)',
  'upstate-overnight':
    'guides to overnight summer camps in upstate South Carolina (Kidding Around Greenville, Greenville Journal, Upstate Parent)',
  'tri-cities':
    'Johnson City and Tri-Cities Tennessee summer camp guides (Johnson City Press and local parent sites)',
  'wnc-overnight':
    'lists of overnight summer camps in Western North Carolina (camp associations, "camps of WNC" roundups, the North Carolina Youth Camp Association)',
  'christian-camps':
    'Christian camp and conference centers in Western North Carolina that run youth summer camps',
  'vbs-roundups':
    'news or community roundups listing Vacation Bible Schools in Asheville and Western North Carolina (2024-2026)',
  'special-needs-directories':
    'directories of special-needs, autism and inclusive summer camps in Western North Carolina',
  'school-summer':
    'school, college and university summer programs for kids and teens in the Asheville area (public and private schools, UNC Asheville, Warren Wilson, Mars Hill, Brevard College, Western Carolina, A-B Tech)',
  'museums-nature-centers':
    'museum, library, nature center, historic site and state park summer camps in Western North Carolina',
};

export function aggregatorQueries(): DiscoveryQuery[] {
  return Object.entries(AGGREGATORS).map(([id, source]) => ({
    method: 'aggregator',
    id,
    input: `Use ${source} to find organizations running summer camps and summer programs for kids and teens. For each organization listed, give the organization's own official URL (search for it), never the listing page.`,
  }));
}

/**
 * Gap-filling rounds (plan §6.1, stop rule). Round 1 sweeps niches the grid lumps together;
 * round 2 asks for the small and new programs the bigger searches rank below the well-known camps.
 * Round 3 goes town by town for Vacation Bible Schools, the kind the first two left thinnest
 * (hundreds of churches, each posting its VBS on its own page or Facebook).
 */
const GAP_ROUNDS: Record<number, Record<string, string>> = {
  1: {
    'lacrosse-field-hockey': 'lacrosse and field hockey camps and clinics',
    'tennis-pickleball': 'tennis and pickleball camps',
    golf: 'junior golf camps and clinics',
    'swim-dive': 'swimming, diving and water-safety camps',
    'gymnastics-cheer': 'gymnastics, cheer, tumbling, trampoline and ninja camps',
    'martial-arts': 'martial arts, karate, taekwondo, jiu-jitsu and fencing camps',
    'climbing-bike-skate': 'rock climbing, mountain biking, BMX and skateboarding camps for kids',
    'water-sports':
      'whitewater, kayaking, paddleboard, sailing, fishing and fly-fishing camps for kids',
    'basketball-volleyball':
      'basketball and volleyball camps (including college coaches and high school camps)',
    'soccer-baseball':
      'soccer, baseball and softball camps and clinics (clubs, academies, college camps)',
    'football-wrestling-track': 'football, wrestling, track and cross-country camps for youth',
    'circus-film-photo': 'circus, aerial, film, animation and photography camps for kids',
    'writing-language':
      'creative writing, journalism, foreign language and immersion camps for kids',
    'craft-trades':
      'woodworking, blacksmithing, glass, fiber arts, clay and maker camps for kids and teens',
    'chess-games-tech': 'chess, Minecraft, game design, coding and robotics camps',
    'science-nature':
      'wildlife, birding, astronomy, aviation, environmental education and naturalist camps',
    scouts: 'Boy Scouts / Scouting America and Girl Scouts summer camps and day camps',
    '4h-extension': '4-H and Cooperative Extension summer camps and day camps (each county)',
    'clubs-community':
      'Boys & Girls Clubs, YWCA, community centers and recreation centers with summer camps',
    'jewish-faith':
      'JCC, synagogue and other non-church faith communities with summer camps for kids',
    'private-schools':
      'private, Montessori, Waldorf and charter school summer camps open to the public',
    'childcare-centers': 'child care centers and preschools that run school-age summer camps',
    farms: 'farm camps, animal camps and homestead camps for kids',
    therapy: 'therapeutic, speech, occupational therapy and social-skills summer camps for kids',
  },
  2: {
    'new-2027': 'summer camps that have already announced 2027 dates',
    'small-studios':
      'small art studios, dance studios, music teachers and gyms that run a few weeks of summer camp',
    'half-day': 'half-day and morning-only summer camps for young kids (ages 3-6)',
    teens: 'summer programs and camps specifically for teens and middle schoolers',
    'church-day-camps':
      'churches that run weekly summer day camps (not just Vacation Bible School)',
    'evening-programs': 'evening and weekend summer programs for kids and teens',
    'college-camps':
      'summer camps held at colleges and universities (athletics, academics, arts) open to kids',
    'one-week-specialty':
      'one-week specialty camps (science, history, nature, arts) run by nonprofits',
  },
  3: {
    vbs: 'churches holding Vacation Bible School (VBS) in 2025 or 2026 (search "VBS 2026", "VBS 2025" and "vacation bible school" with each town name; small and rural churches too)',
  },
};

/** Round 3's towns: small enough that a VBS search reaches past the big churches. */
const VBS_TOWNS: Record<string, string> = {
  'asheville-west-north': 'West Asheville, North Asheville, Candler, Leicester and Woodfin, NC',
  'asheville-east-south': 'East Asheville, South Asheville, Arden, Fairview and Skyland, NC',
  'black-mountain': 'Black Mountain, Swannanoa, Montreat and Old Fort, NC',
  weaverville: 'Weaverville, Barnardsville, Marshall, Mars Hill and Hot Springs, NC',
  hendersonville: 'Hendersonville, Flat Rock, Fletcher, Mills River and Etowah, NC',
  brevard: 'Brevard, Pisgah Forest, Rosman and Lake Toxaway, NC',
  waynesville: 'Waynesville, Canton, Clyde and Maggie Valley, NC',
  sylva: 'Sylva, Cullowhee, Bryson City and Cherokee, NC',
  marion: 'Marion, Nebo and Morganton, NC',
  burnsville: 'Burnsville, Spruce Pine and Bakersville, NC',
  'polk-rutherford': 'Tryon, Columbus, Saluda, Rutherfordton and Forest City, NC, and Landrum, SC',
  'johnson-city': 'Johnson City, Jonesborough, Erwin and Elizabethton, TN',
};

/** Where gap-filling searches run: the whole radius, split so each search stays local. */
const GAP_REGIONS: Record<string, string> = {
  asheville: 'Asheville and Buncombe County, NC',
  'south-west':
    'Henderson, Transylvania, Polk, Haywood and Jackson counties, NC (Hendersonville, Brevard, Tryon, Waynesville, Sylva)',
  'north-east-tn':
    'Madison, Yancey, Mitchell, McDowell and Rutherford counties, NC, and Johnson City, TN',
};

export function gapQueries(round: number): DiscoveryQuery[] {
  const topics = GAP_ROUNDS[round];
  if (!topics) throw new Error(`No gap-filling round ${round}`);
  const regions =
    round === 1
      ? { all: 'the Asheville area of Western North Carolina (within about an hour of Asheville)' }
      : round === 3
        ? VBS_TOWNS
        : GAP_REGIONS;
  const queries: DiscoveryQuery[] = [];
  for (const [topicId, topic] of Object.entries(topics)) {
    for (const [regionId, region] of Object.entries(regions)) {
      queries.push({
        method: 'gap_fill',
        id: `r${round}-${topicId}--${regionId}`,
        input: `Find ${topic} for kids and teens in ${region}. Look past the big, well-known camps: search with varied wording and town names and list every organization you find.`,
      });
    }
  }
  return queries;
}

// ---------------------------------------------------------------------------
// Calling Sol
// ---------------------------------------------------------------------------

export async function askForProviders(
  query: DiscoveryQuery,
  today: string,
  options: { webSearch: boolean }
): Promise<DiscoveryRun> {
  const started = Date.now();
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  const searches: string[] = [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await createResponse({
      instructions: discoveryInstructions(today),
      input: query.input,
      webSearch: options.webSearch,
      effort: 'low',
      jsonSchema: { name: 'camp_providers', schema: PROVIDERS_SCHEMA },
      maxOutputTokens: 30000,
    });
    addUsage(usage, result.usage);
    searches.push(...result.searches);
    try {
      if (result.status !== 'completed') throw new Error(`response status ${result.status}`);
      const parsed = JSON.parse(result.text) as { providers: Candidate[] };
      return {
        ...query,
        at: new Date().toISOString(),
        webSearch: options.webSearch,
        calls: attempt,
        usage,
        searches,
        ms: Date.now() - started,
        candidates: parsed.providers.map(cleanCandidate).filter((c) => c.name),
      };
    } catch (error) {
      lastError = new Error(
        `Unparseable discovery response (${result.status}, ${result.text.length} chars): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  throw lastError;
}

function addUsage(total: ResponsesResult['usage'], add: ResponsesResult['usage']): void {
  total.inputTokens += add.inputTokens;
  total.cachedInputTokens += add.cachedInputTokens;
  total.outputTokens += add.outputTokens;
  total.reasoningTokens += add.reasoningTokens;
}

// The model decorates strings even under a strict schema (see extract.ts).
const CITATION_MARKDOWN = /\s*\(\[[^\]]*\]\([^)]*\)\)/g;
const BARE_MARKDOWN_LINK = /\[([^\]]*)\]\((https?:[^)]*)\)/g;

function cleanText(value: string | null): string | null {
  if (!value) return null;
  const text = value
    .replace(CITATION_MARKDOWN, '')
    .replace(BARE_MARKDOWN_LINK, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** Drop tracking parameters (web search appends utm_source=openai) and fragments. */
export function cleanUrl(url: string | null): string | null {
  const text = cleanText(url);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    for (const param of [...parsed.searchParams.keys()]) {
      if (/^utm_|^fbclid$/i.test(param)) parsed.searchParams.delete(param);
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

const STATE_NAMES: Record<string, string> = {
  'north carolina': 'NC',
  'south carolina': 'SC',
  tennessee: 'TN',
  georgia: 'GA',
  virginia: 'VA',
};

function cleanState(state: string | null): string | null {
  const text = cleanText(state);
  if (!text) return null;
  return STATE_NAMES[text.toLowerCase()] ?? text.toUpperCase().slice(0, 2);
}

function cleanCandidate(candidate: Candidate): Candidate {
  return {
    name: cleanText(candidate.name) ?? '',
    url: cleanUrl(candidate.url),
    town: cleanText(candidate.town),
    state: cleanState(candidate.state),
    kinds: [...new Set(candidate.kinds)],
    categories: [...new Set(candidate.categories)],
    note: cleanText(candidate.note),
  };
}

// ---------------------------------------------------------------------------
// Seeds without the model: the pilot providers and the exa sheet
// ---------------------------------------------------------------------------

interface PilotFileProvider {
  key: string;
  name: string;
  urls: string[];
  area?: string;
  hint?: string;
  webtrac?: boolean;
  /** Pilot-only fields, dropped here. */
  site?: string;
  covers?: string[];
  /** The provider's own domains a person confirmed (pilot); kept as a page in `urls`. */
  domains?: string[];
}

/** The page on each reviewed domain the pilot read (Lutheridge moved to novusway.org). */
const REVIEWED_DOMAIN_PAGES: Record<string, string> = {
  'novusway.org': 'https://novusway.org/lutheridge/',
};

export function pilotProviders(file: { providers: PilotFileProvider[] }): PilotProvider[] {
  return file.providers.map((pilot) => {
    const reviewed = (pilot.domains ?? [])
      .map((domain) => REVIEWED_DOMAIN_PAGES[domain] ?? `https://${domain}/`)
      .filter(
        (url) => !pilot.urls.some((own) => registrableDomain(own) === registrableDomain(url))
      );
    return {
      key: pilot.key,
      name: pilot.name,
      urls: [...pilot.urls, ...reviewed],
      area: pilot.area ?? null,
      ...(pilot.hint ? { hint: pilot.hint } : {}),
      ...(pilot.webtrac ? { webtrac: true } : {}),
    };
  });
}

export function pilotCandidate(pilot: PilotProvider): Candidate {
  const { town, state } = parsePlace(pilot.area ?? '');
  return {
    name: pilot.name,
    url: pilot.urls[0] ?? null,
    town,
    state,
    kinds: [],
    categories: [],
    note: null,
  };
}

/**
 * The exa sheet's rows are programs ("Lakewood Church “Kingdom Quest” VBS") with venue names in
 * Location, so Sol turns them into organizations, without search, like the guides.
 */
export function sheetBrief(rows: SeedRow[]): string {
  const lines = rows.map(
    (row, index) =>
      `${index + 1}. ${row.name} | ages: ${row.ages || '?'} | location: ${row.location || '?'} | sources: ${
        row.sources.join(' ') || '?'
      }`
  );
  return `Below is a spreadsheet of kids' summer programs (summer 2026) that an earlier web search found near Asheville, one row per program; several rows can belong to one organization. Do not search the web. Return one row per organization, covering every organization in the list: drop a row only when it is clearly not a kids' summer program or clearly outside the area. Name the organization, not the program or the VBS theme. url: one of the row's sources when it is the organization's own page (prefer its camp page), never a directory, news article or event listing; otherwise null. town: the town where campers attend; a venue name is not a town (give the venue's town when you know it, else null).\n\n${lines.join('\n')}`;
}

/** "174 Bradley Branch Rd, Arden, NC 28704" -> Arden, NC. Free text without a state -> its first part. */
export function parsePlace(text: string): { town: string | null; state: string | null } {
  const parts = text
    .replace(/\([^)]*\)/g, '')
    .split(/[,;]/)
    .map((part) => part.trim());
  const stateIndex = parts.findIndex((part) =>
    /^(?:NC|SC|TN|North Carolina|South Carolina|Tennessee)\b/i.test(part)
  );
  if (stateIndex > 0) {
    const town = parts[stateIndex - 1];
    return {
      town: town && !/\d/.test(town) ? town : null,
      state: cleanState(parts[stateIndex].match(/^[A-Za-z ]+?(?=\s*\d|$)/)?.[0] ?? null),
    };
  }
  const first = parts[0] ?? '';
  return { town: first && !/\d/.test(first) ? first : null, state: null };
}

// ---------------------------------------------------------------------------
// Guides and our own events: text we read, structured by Sol without search
// ---------------------------------------------------------------------------

export interface GuidePage {
  url: string;
  text: string;
  links: PageLink[];
}

const GUIDE_CHUNK_CHARS = 40000;

/** The guide's pages as briefs of at most ~40k characters, each page with its outbound links. */
export function guideBriefs(guideName: string, pages: GuidePage[]): string[] {
  const preface = `Below is ${guideName}, a local guide to kids' programs, as our own crawler read it. Do not search the web. List every organization in it that runs a kids' summer program (day or overnight camp, VBS, clinic, summer program); skip programs that run only during the school year. Take each organization's URL only from the LINKS lines, and only when the link is the organization's own website or registration page; otherwise null. Take the town from its address when one is given.`;
  const blocks = pages.map((page) => {
    const guideDomain = registrableDomain(page.url);
    const links = page.links
      .filter((link) => registrableDomain(link.href) !== guideDomain)
      .map((link) => `${link.text || '(no text)'} -> ${link.href}`);
    return `----- PAGE ${page.url}\n${page.text}\nLINKS (text -> url):\n${links.join('\n')}`;
  });

  const briefs: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const block of blocks) {
    const text = block.slice(0, GUIDE_CHUNK_CHARS);
    if (current.length > 0 && size + text.length > GUIDE_CHUNK_CHARS) {
      briefs.push([preface, ...current].join('\n\n'));
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length > 0) briefs.push([preface, ...current].join('\n\n'));
  return briefs;
}

export interface EventListing {
  source: string;
  organizer: string | null;
  title: string;
  location: string | null;
  url: string;
  count: number;
}

export function ourDbBrief(listings: EventListing[]): string {
  const lines = listings.map(
    (listing) =>
      `- "${listing.title}" | organizer: ${listing.organizer ?? '?'} | where: ${
        listing.location ?? '?'
      } | source: ${listing.source} | url: ${listing.url} | ${listing.count} listing(s)`
  );
  return `Below are event listings from AVLGO's own event feed (summers 2025-2026) whose titles look camp-like. Do not search the web. Many are noise (a brewery taproom named "Forestry Camp", adult boot camps, vaccine or plant clinics, bands with "camp" in their name, adult-only events). Return one row per organization that runs a kids' or teens' summer program by the rule above. url: the listing's URL only when it is on the organization's own website, or for a church's VBS its Facebook event; never an AVL Today, Explore Asheville, Mountain Xpress or Eventbrite listing (use null). Take the town from "where".\n\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Resolve: official pages for providers we know only by name
// ---------------------------------------------------------------------------

export interface ResolveItem {
  name: string;
  town: string | null;
  state: string | null;
  note: string | null;
}

const RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'url', 'town', 'state', 'runs_kids_summer_program', 'note'],
        properties: {
          index: { type: 'integer' },
          url: { type: ['string', 'null'] },
          town: { type: ['string', 'null'] },
          state: { type: ['string', 'null'] },
          runs_kids_summer_program: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
};

function resolveInstructions(today: string): string {
  return `You look up official websites for AVLGO's free directory of kids' summer camps near Asheville, NC. Today is ${today}.

For each numbered organization, search the web and return one result with its index:
- url: the organization's own page about its kids' summer programs (camp, VBS, clinic, summer program), else its home page, else its own account on a registration platform; for a church whose VBS is posted only on Facebook, its Facebook page. Never a directory, aggregator, news article or review site. Make sure it is this organization in the town given, not a namesake elsewhere. Null when you can't find one.
- runs_kids_summer_program: "yes" when you find it ran or announced a kids' summer program in 2025, 2026 or 2027 (a low bar: day, half-day, overnight or evening camps, VBS, clinics, pre-college, summer childcare); "no" when its own pages show it doesn't (adult-only, school-year classes only, closed); otherwise "unknown".
- town and state (NC, SC or TN) where campers attend.
- note: one short line on what you found.`;
}

export async function resolveBatch(
  id: string,
  items: ResolveItem[],
  today: string
): Promise<DiscoveryRun> {
  const input = items
    .map(
      (item, index) =>
        `${index + 1}. ${item.name} | town: ${item.town ?? '?'}${item.state ? `, ${item.state}` : ''}${
          item.note ? ` | ${item.note}` : ''
        }`
    )
    .join('\n');
  const started = Date.now();
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  const searches: string[] = [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await createResponse({
      instructions: resolveInstructions(today),
      input,
      webSearch: true,
      effort: 'low',
      jsonSchema: { name: 'official_pages', schema: RESOLVE_SCHEMA },
      maxOutputTokens: 20000,
    });
    addUsage(usage, result.usage);
    searches.push(...result.searches);
    try {
      if (result.status !== 'completed') throw new Error(`response status ${result.status}`);
      const parsed = JSON.parse(result.text) as {
        results: Array<{
          index: number;
          url: string | null;
          town: string | null;
          state: string | null;
          runs_kids_summer_program: 'yes' | 'no' | 'unknown';
          note: string | null;
        }>;
      };
      const candidates: Candidate[] = [];
      for (const found of parsed.results) {
        const item = items[found.index - 1];
        if (!item) continue;
        const note = cleanText(found.note);
        candidates.push({
          // The name (and town, when we had one) we asked about, so the merge joins it to its provider.
          name: item.name,
          url: cleanUrl(found.url),
          town: item.town ?? cleanText(found.town),
          state: item.state ?? cleanState(found.state),
          kinds: [],
          categories: [],
          note,
          ...(found.runs_kids_summer_program === 'no'
            ? { rejected: note ?? 'no kids summer program found' }
            : {}),
        });
      }
      return {
        method: 'resolve',
        id,
        input,
        at: new Date().toISOString(),
        webSearch: true,
        calls: attempt,
        usage,
        searches,
        ms: Date.now() - started,
        candidates,
        asked: items,
      };
    } catch (error) {
      lastError = new Error(
        `Unparseable resolve response (${result.status}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Merge: providers by site, then by name in a compatible town
// ---------------------------------------------------------------------------

/** Directories, aggregators and news: where we learn of a camp, never its own page. */
const AGGREGATOR_HOSTS =
  /(?:^|\.)(?:macaronikid\.com|kidvoyage\.com|campsearch\.com|allevents\.in|asheville\.com|exploreasheville\.com|6amcity\.com|avltoday\.com|avlgo\.com|828newsnow\.com|mountainx\.com|citizen-times\.com|wncparent\.com|blueridgenow\.com|hendersonvillelightning\.com|themountaineer\.com|smokymountainnews\.com|transylvaniatimes\.com|johnsoncitypress\.com|greenvillejournal\.com|kidding-around\.com|kiddingaroundgreenville\.com|upstateparent\.com|yelp\.com|tripadvisor\.com|activityhero\.com|acacamps\.org|campnavigator\.com|mysummercamps\.com|summercamps\.com|kidsoutandabout\.com|patch\.com|wlos\.com|bpr\.org|wyff4\.com|care\.com|winnie\.com|nextdoor\.com|groupon\.com|cityspark\.com|bing\.com|mapquest\.com|campresource\.com|campchannel\.com|ymcacampfinder\.com|campamerica\.co\.uk|happeningnext\.com|riverartsdistrict\.com|evvnt\.com)$|^beyondschool\.ashevillecityschools\.net$/;

export function isAggregatorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (/(?:^|\.)google\.[a-z.]+$/.test(host) && /^\/(?:maps|search)/.test(parsed.pathname)) {
      return true;
    }
    return AGGREGATOR_HOSTS.test(host);
  } catch {
    return true;
  }
}

const VIDEO_AND_LINK_HOSTS =
  /(?:^|\.)(?:youtube\.com|youtu\.be|x\.com|twitter\.com|tiktok\.com|linktr\.ee)$/;

/** Facebook, Instagram, a video or a link page: never the page a camp's details live on. */
export function isSocialPage(url: string): boolean {
  if (isSocialUrl(url)) return true;
  try {
    return VIDEO_AND_LINK_HOSTS.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Public-suffix-like hosts where the organization is one more label in ("buncombe.ces.ncsu.edu"). */
const MULTI_TENANT_SUFFIX = /\.(?:[a-z]{2}\.us|ces\.ncsu\.edu)$/;
/**
 * Booking, form and church-management services platforms.ts doesn't list, where the account is
 * the subdomain ("torched.as.me", "morgantonnc.adventistchurch.org"), and school districts whose
 * schools each have a subdomain ("acrhs.buncombeschools.org", "bes.haywood.k12.nc.us"): the whole
 * host is the identity, never the shared domain.
 */
const SUBDOMAIN_TENANT_HOSTS =
  /\.(?:k12\.[a-z]{2}\.us|buncombeschools\.org|hcpsnc\.org|ashevillecityschools\.net|adventistchurch\.org|adventistchurchconnect\.org|as\.me|leagueapps\.com|teamsnap\.com|jumbula\.com|regfox\.com|ticketleap\.com|ticketspice\.com|simplybook\.me|setmore\.com|punchpass\.com|breezechms\.com|ccbchurch\.com|flocknote\.com|thinkific\.com|mykajabi\.com|bandzoogle\.com|campwise\.com|activityreg\.com|ezfacility\.com|corsizio\.com|bookwhen\.com|checkfront\.com|fareharbor\.com|wufoo\.com|formstack\.com|typeform\.com|cognitoforms\.com|blogspot\.com|business\.site|carrd\.co|webflow\.io|netlify\.app|vercel\.app|github\.io|jimdosite\.com|mystrikingly\.com|myportfolio\.com|editorx\.io|wixstudio\.io)$/;
/**
 * Hosts where the account is in the path or query: "sites.google.com/view/x",
 * "vbspro.events/p/events/abc", "kideventpro.lifeway.com/myEvent/?id=73808", and a school
 * district whose schools are path sections ("hendersoncountypublicschoolsnc.org/hhs/").
 */
const PATH_TENANT_HOSTS =
  /^(?:sites\.google\.com|linktr\.ee|youtube\.com|x\.com|twitter\.com|tiktok\.com|meetup\.com|vbspro\.events|vbsmate\.com|myvbs\.org|signupgenius\.com|(?:app\.)?acuityscheduling\.com|givebutter\.com|zeffy\.com|gofan\.co|(?:clients\.)?mindbodyonline\.com|form\.jotform\.com|app\.hisawyer\.com|campscui\.active\.com|[\w-]+\.lifeway\.com|hendersoncountypublicschoolsnc\.org)$/;
/** Path segments that name a kind of page, not an account: the account is a later segment. */
const GENERIC_SEGMENT =
  /^(?:events?|groups|pages|people|p|go|e|view|site|a|channel|c|catalog|forms?|register|registration|schedule|camps?|programs?|venue|myevent|o|watch|shorts)$/;
const TENANT_QUERY_PARAMS = ['id', 'studioid', 'owner', 'orgid'];
/** Short links say nothing about whose page it is. */
const SHORT_LINK_HOSTS = /^(?:bit\.ly|tinyurl\.com|forms\.gle|goo\.gl|t\.co|ow\.ly)$/;
/** A franchise's location page ("codeninjas.com/nc-asheville") is its own business. */
const TOWN_SLUG =
  /^(?:(?:nc|sc|tn|north-carolina|south-carolina|tennessee)[-_]?)?(?:asheville|hendersonville|brevard|waynesville|greenville|spartanburg|johnson-?city|black-?mountain|weaverville|arden|fletcher|marion|morganton|canton|sylva|candler)(?:[-_]?(?:nc|sc|tn))?$/;

/**
 * What identifies the organization behind a URL: its registrable domain, its account on a
 * registration platform or social site, or null (a platform's shared domain alone, a short link).
 */
export function siteKey(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (SHORT_LINK_HOSTS.test(host)) return null;
  if (platformOf(url)) return platformTenant(url);

  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (isSocialUrl(url) || PATH_TENANT_HOSTS.test(host)) {
    // "profile.php?id=1", "myEvent/?id=73808", "main_enroll.asp?studioid=2": the query is the account.
    const id = TENANT_QUERY_PARAMS.map((param) => parsed.searchParams.get(param)).find(Boolean);
    if (id) return `${host}/${segments.join('/')}?${id}`;
    if (/\.(?:php|aspx?|cfm)$/.test(segments.at(-1) ?? '')) return null;
    // Skip page-kind segments and Google Workspace domains ("sites.google.com/bcsemail.org/x").
    const account = segments.findIndex((s) => !GENERIC_SEGMENT.test(s) && !s.includes('.'));
    return account >= 0 ? `${host}/${segments.slice(0, account + 1).join('/')}` : null;
  }

  const domain = SUBDOMAIN_TENANT_HOSTS.test(host)
    ? host
    : MULTI_TENANT_SUFFIX.test(host)
      ? host.split('.').slice(-4).join('.')
      : registrableDomain(url);
  if (!domain) return null;
  const location = segments.slice(0, 3).findIndex((segment) => TOWN_SLUG.test(segment));
  return location >= 0 ? `${domain}/${segments.slice(0, location + 1).join('/')}` : domain;
}

const NAME_STOPWORDS = new Set(
  'the a an of at inc llc co camp camps summer program programs vbs nc sc tn'.split(' ')
);

/** "Camp Rockmont (overnight)" and "Rockmont" -> "rockmont". */
export function nameKey(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/vacation bible school/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      // A repeated word is the town said twice ("Clyde Free Will Baptist Church of Clyde").
      .filter(
        (word, index, words) => word && !NAME_STOPWORDS.has(word) && words.indexOf(word) === index
      )
      .join(' ')
  );
}

const BUNCOMBE_TOWNS = new Set(
  'asheville,arden,black mountain,swannanoa,montreat,weaverville,woodfin,fairview,candler,leicester,barnardsville,skyland,enka,biltmore forest,alexander'.split(
    ','
  )
);

/** Towns that can only be the same place for a namesake check (Buncombe's towns count as one). */
export function townKey(town: string | null): string | null {
  if (!town) return null;
  const key = town
    .toLowerCase()
    .split(/[,;/(]|\bor\b|\band\b/)[0]
    .replace(/^(?:north|south|east|west|downtown|greater)\s+/, '')
    .trim();
  if (!key || /various|multiple|online/.test(key)) return null;
  return BUNCOMBE_TOWNS.has(key) ? 'buncombe' : key;
}

const CLEARLY_OUT_TOWNS =
  /\b(?:charlotte|atlanta|raleigh|durham|chapel hill|cary|greensboro|winston[- ]salem|high point|knoxville|chattanooga|nashville|columbia|charleston|myrtle beach|boone|blowing rock|highlands|murphy|gatlinburg|pigeon forge|sevierville|bristol|anderson|clemson|rock hill|gastonia|wilmington|augusta|roanoke)\b/i;
const GREENVILLE_METRO =
  /\b(?:greenville|greer|simpsonville|mauldin|easley|taylors|spartanburg|boiling springs|duncan|fountain inn|piedmont|powdersville)\b/i;

/** Clearly outside D3 (plan §3): far towns, other states, day programs in Greenville / Spartanburg. */
export function outOfAreaReason(candidate: Candidate): string | null {
  if (candidate.state && !['NC', 'SC', 'TN'].includes(candidate.state)) {
    return `state ${candidate.state}`;
  }
  const town = candidate.town ?? '';
  if (CLEARLY_OUT_TOWNS.test(town)) return `town ${town}`;
  if (
    candidate.state === 'SC' &&
    GREENVILLE_METRO.test(town) &&
    candidate.kinds.length > 0 &&
    !candidate.kinds.includes('overnight')
  ) {
    return `day program in ${town}, SC`;
  }
  return null;
}

interface MergeNode {
  run: string;
  method: DiscoveryMethod;
  candidate: Candidate;
  urls: string[];
  pilot?: PilotProvider;
}

interface Component {
  pilot: string | null;
  sites: Set<string>;
  towns: Set<string>;
  /** `nameKey`s of its candidates. */
  names: Set<string>;
}

const CHURCH_NAME =
  /\b(?:church|baptist|methodist|presbyterian|lutheran|episcopal|catholic|adventist|chapel|fellowship|parish|umc|congregation|tabernacle)\b/;
const CHURCH_WORDS = new Set(
  'church baptist methodist united presbyterian lutheran episcopal catholic adventist seventh chapel fellowship first community christian missionary memorial ministries'.split(
    ' '
  )
);

/**
 * Churches share VBS registration services we don't know as platforms ("vbsmate.com/events/x"),
 * so two differently named churches join on a site only when both names show up in it
 * ("reynoldsbaptistchurch.org"), or one name contains the other.
 */
function churchSiteAllowed(site: string, x: Component, y: Component): boolean {
  const isChurch = (c: Component) => [...c.names].some((name) => CHURCH_NAME.test(name));
  if (!isChurch(x) || !isChurch(y)) return true;
  const related = [...x.names].some((a) =>
    [...y.names].some((b) => a === b || a.includes(b) || b.includes(a))
  );
  if (related) return true;
  const squashed = site.replace(/[^a-z0-9]/g, '');
  const onSite = (c: Component) =>
    [...c.names].some((name) =>
      name.split(' ').some((w) => w.length >= 4 && !CHURCH_WORDS.has(w) && squashed.includes(w))
    );
  return onSite(x) && onSite(y);
}

/** A provider before its page check, with everything discovery saw about it. */
export interface MergedProvider {
  provider: Omit<Provider, 'status' | 'status_reason'>;
  names: string[];
  towns: string[];
  kinds: CampType[];
  categories: CampCategory[];
  runs: string[];
  allUrls: string[];
  /** Why `resolve` thought it runs no kids' summer program. */
  rejected: string[];
}

export interface MergeResult {
  providers: MergedProvider[];
  outOfArea: Array<{
    name: string;
    town: string | null;
    state: string | null;
    run: string;
    reason: string;
  }>;
  /** Left out by an `exclude` override. */
  excluded: Array<{ names: string[]; reason: string }>;
  /** Separate providers whose names overlap in one town: check by hand. */
  possibleDuplicates: string[][];
}

/**
 * Hand decisions, by site key (as `siteKey` prints it, e.g. "worxproject.org") or provider name:
 * `join` merges two providers the code kept apart; `exclude` drops one that isn't a kids'
 * summer program provider in the radius; `rename` fixes a name.
 */
export interface DiscoveryOverrides {
  join?: Array<[string, string]>;
  exclude?: Array<{ match: string; reason: string }>;
  /** The name to use when every source got it wrong (a pilot keeps its own; a key never changes). */
  rename?: Array<{ match: string; name: string }>;
}

const METHOD_RANK = new Map(DISCOVERY_METHODS.map((method, index) => [method, index]));

export function mergeCandidates(
  runs: DiscoveryRun[],
  prior: Provider[] = [],
  overrides: DiscoveryOverrides = {}
): MergeResult {
  const nodes: MergeNode[] = [];
  const outOfArea: MergeResult['outOfArea'] = [];
  const sortedRuns = [...runs].sort(
    (a, b) =>
      (METHOD_RANK.get(a.method) ?? 99) - (METHOD_RANK.get(b.method) ?? 99) ||
      a.id.localeCompare(b.id)
  );
  for (const run of sortedRuns) {
    const runId = `${run.method}/${run.id}`;
    if (run.pilot) {
      for (const pilot of run.pilot) {
        nodes.push({
          run: runId,
          method: run.method,
          candidate: pilotCandidate(pilot),
          urls: pilot.urls,
          pilot,
        });
      }
      continue;
    }
    for (const candidate of run.candidates) {
      const reason = outOfAreaReason(candidate);
      if (reason) {
        outOfArea.push({
          name: candidate.name,
          town: candidate.town,
          state: candidate.state,
          run: runId,
          reason,
        });
        continue;
      }
      const url = candidate.url && !isAggregatorUrl(candidate.url) ? candidate.url : null;
      nodes.push({ run: runId, method: run.method, candidate, urls: url ? [url] : [] });
    }
  }

  // Union-find over nodes, with each root carrying what the joining rules check.
  const parent = nodes.map((_, index) => index);
  const components = nodes.map(
    (node): Component => ({
      pilot: node.pilot?.key ?? null,
      sites: new Set(node.urls.map(siteKey).filter((key): key is string => !!key)),
      towns: new Set([node.candidate.town].map(townKey).filter((key): key is string => !!key)),
      names: new Set([nameKey(node.candidate.name)].filter(Boolean)),
    })
  );
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number, allowed: (x: Component, y: Component) => boolean) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const x = components[rootA];
    const y = components[rootB];
    if (x.pilot && y.pilot && x.pilot !== y.pilot) return;
    if (!allowed(x, y)) return;
    parent[rootB] = rootA;
    components[rootA] = {
      pilot: x.pilot ?? y.pilot,
      sites: new Set([...x.sites, ...y.sites]),
      towns: new Set([...x.towns, ...y.towns]),
      names: new Set([...x.names, ...y.names]),
    };
  };
  // Every earlier node, not just the first, so one refused join doesn't strand the rest.
  const unionAll = (
    lists: Iterable<[string, number[]]>,
    allowed: (key: string, x: Component, y: Component) => boolean
  ) => {
    for (const [key, indexes] of lists) {
      for (let i = 1; i < indexes.length; i++) {
        for (let j = 0; j < i; j++) union(indexes[j], indexes[i], (x, y) => allowed(key, x, y));
      }
    }
  };

  // 1. Same site.
  const bySite = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    for (const key of new Set(node.urls.map(siteKey))) {
      if (key) bySite.set(key, [...(bySite.get(key) ?? []), index]);
    }
  });
  unionAll(bySite, churchSiteAllowed);

  // 2. Same name in a compatible town. Two components that both have their own sites must name
  // the same town: "First Baptist Church" in two towns are two churches.
  const byName = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const key = nameKey(node.candidate.name);
    if (!key) return;
    byName.set(key, [...(byName.get(key) ?? []), index]);
  });
  unionAll(byName, (_name, x, y) => {
    const sharedTown = [...x.towns].some((town) => y.towns.has(town));
    if (x.towns.size > 0 && y.towns.size > 0 && !sharedTown) return false;
    if (x.sites.size > 0 && y.sites.size > 0 && ![...x.sites].some((s) => y.sites.has(s))) {
      return sharedTown;
    }
    return true;
  });

  // 3. Hand decisions (data/camps/discovery/overrides.json), by site key or name.
  const matches = (node: MergeNode, ref: string) =>
    node.urls.some((url) => siteKey(url) === ref) || nameKey(node.candidate.name) === nameKey(ref);
  for (const pair of overrides.join ?? []) {
    // Every node either side names, so a join by name takes all of that name's providers.
    const joined = nodes.flatMap((node, index) =>
      pair.some((ref) => matches(node, ref)) ? [index] : []
    );
    for (const index of joined.slice(1)) union(joined[0], index, () => true);
  }

  const groups = new Map<number, MergeNode[]>();
  const excluded: MergeResult['excluded'] = [];
  nodes.forEach((node, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), node]);
  });
  for (const [root, group] of groups) {
    const rule = (overrides.exclude ?? []).find((r) =>
      group.some((node) => matches(node, r.match))
    );
    // A lookup that no longer joins the provider it was made for discovered nothing itself.
    const reason =
      rule?.reason ??
      (group.every((node) => node.method === 'resolve') ? 'only a resolve lookup' : null);
    if (reason) {
      excluded.push({
        names: unique(
          group.map((n) => n.candidate.name),
          (n) => n
        ),
        reason,
      });
      groups.delete(root);
    }
  }

  // Prior keys stay with their provider: by site, then by name. Every prior provider of a name is
  // kept, since two churches can share one ("First Baptist Church").
  const priorBySite = new Map<string, Provider>();
  const priorByName = new Map<string, Provider[]>();
  for (const provider of prior) {
    for (const url of provider.urls) {
      const key = siteKey(url);
      if (key && !priorBySite.has(key)) priorBySite.set(key, provider);
    }
    const name = nameKey(provider.name);
    priorByName.set(name, [...(priorByName.get(name) ?? []), provider]);
  }

  // A new slug never takes a pilot's or an earlier run's key, even one no longer found.
  const keys: ProviderKeys = { reserved: new Set(prior.map((p) => p.key)), claimed: new Set() };
  for (const group of groups.values()) {
    const pilot = group.find((node) => node.pilot)?.pilot;
    if (pilot) keys.reserved.add(pilot.key);
  }

  const providers: MergedProvider[] = [];
  const orderedGroups = [...groups.values()].sort(
    (a, b) => (METHOD_RANK.get(a[0].method) ?? 99) - (METHOD_RANK.get(b[0].method) ?? 99)
  );
  for (const group of orderedGroups) {
    const rename = overrides.rename?.find((r) => group.some((node) => matches(node, r.match)));
    const merged = buildProvider(group, priorBySite, priorByName, keys, rename?.name);
    keys.claimed.add(merged.provider.key);
    providers.push(merged);
  }

  return { providers, outOfArea, excluded, possibleDuplicates: possibleDuplicates(providers) };
}

/**
 * Providers the merge kept apart that may be one organization: one's names contain another's,
 * with no town between them that disagrees. For a person to settle in overrides.json.
 */
function possibleDuplicates(providers: MergedProvider[]): string[][] {
  const entries = providers.map((merged) => ({
    key: merged.provider.key,
    names: unique(
      merged.names.map(nameKey).filter((name) => name.length >= 5),
      (n) => n
    ),
    towns: new Set(merged.towns.map(townKey).filter(Boolean)),
  }));
  const pairs: string[][] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const sameTown =
        a.towns.size === 0 || b.towns.size === 0 || [...a.towns].some((t) => b.towns.has(t));
      const related = a.names.some((x) =>
        b.names.some((y) => x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `))
      );
      if (sameTown && related) pairs.push([a.key, b.key]);
    }
  }
  return pairs;
}

const CAMPISH_PATH =
  /camp|summer|vbs|vacation-bible|bible-school|youth|kids|children|program|clinic|pre-?college|academy|enrichment/i;

interface ProviderKeys {
  /** Pilot keys and every key an earlier run wrote. */
  reserved: Set<string>;
  /** Keys given out in this merge. */
  claimed: Set<string>;
}

function buildProvider(
  group: MergeNode[],
  priorBySite: Map<string, Provider>,
  priorByName: Map<string, Provider[]>,
  keys: ProviderKeys,
  rename?: string
): MergedProvider {
  const pilot = group.find((node) => node.pilot)?.pilot;
  const allUrls = unique(
    group.flatMap((node) => node.urls),
    normalizedUrl
  );
  const sites = group
    .flatMap((node) => node.urls.map(siteKey))
    .filter((key): key is string => !!key);
  const townKeys = new Set(group.map((node) => townKey(node.candidate.town)).filter(Boolean));
  // A name alone isn't the same provider: its site or its town has to match too.
  const samePlace = (p: Provider) =>
    p.urls.some((url) => sites.includes(siteKey(url) ?? '')) || townKeys.has(townKey(p.area));

  let prior: Provider | undefined;
  if (!pilot) {
    prior =
      sites.map((site) => priorBySite.get(site)).find((p) => p && !keys.claimed.has(p.key)) ??
      group
        .flatMap((node) => priorByName.get(nameKey(node.candidate.name)) ?? [])
        .find((p) => !keys.claimed.has(p.key) && samePlace(p));
  }

  const name = pilot?.name ?? rename ?? prior?.name ?? bestName(group);
  // "N.C. Cooperative Extension (Buncombe)" -> "nc-cooperative-extension".
  let key =
    pilot?.key ??
    prior?.key ??
    (slugPart(name.replace(/\([^)]*\)/g, '').replace(/\./g, '')) || 'provider');
  if (!pilot && !prior) {
    const taken = (candidate: string) =>
      keys.reserved.has(candidate) || keys.claimed.has(candidate);
    if (taken(key)) {
      let suffix = 2;
      while (taken(`${key}-${suffix}`)) suffix++;
      key = `${key}-${suffix}`;
    }
  }

  const towns = group
    .map((node) => node.candidate)
    .filter((candidate) => candidate.town)
    .map((candidate) =>
      candidate.state ? `${candidate.town}, ${candidate.state}` : (candidate.town as string)
    );
  const urls = pilot && pilot.urls.length > 0 ? pilot.urls : rankUrls(group, allUrls).slice(0, 6);
  const methods = unique(
    group.map((node) => node.method).filter((method) => method !== 'resolve'),
    (method) => method
  ).sort((a, b) => (METHOD_RANK.get(a) ?? 99) - (METHOD_RANK.get(b) ?? 99));

  const hint =
    pilot?.hint ??
    (urls.length > 0 && urls.every(isSocialPage)
      ? 'Found only on social media (Facebook / Instagram); look for its own website too.'
      : undefined);

  return {
    provider: {
      key,
      name,
      urls,
      area: pilot?.area ?? mostCommon(towns) ?? null,
      ...(hint ? { hint } : {}),
      ...(pilot?.webtrac ? { webtrac: true } : {}),
      discovered_by: methods,
    },
    names: unique(
      group.map((node) => node.candidate.name),
      (text) => text
    ),
    towns: unique(towns, (text) => text.toLowerCase()),
    kinds: unique(
      group.flatMap((node) => node.candidate.kinds),
      (kind) => kind
    ),
    categories: unique(
      group.flatMap((node) => node.candidate.categories),
      (category) => category
    ),
    runs: unique(
      group.map((node) => node.run),
      (run) => run
    ),
    allUrls,
    rejected: group.flatMap((node) => (node.candidate.rejected ? [node.candidate.rejected] : [])),
  };
}

/** The organization name most sources agree on; the exa sheet's program-level names last. */
function bestName(group: MergeNode[]): string {
  const named = group.filter((node) => node.method !== 'seed_sheet' && node.method !== 'resolve');
  const pool = named.length > 0 ? named : group;
  const counts = new Map<string, number>();
  for (const node of pool) {
    const key = nameKey(node.candidate.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (
    pool.find((node) => nameKey(node.candidate.name) === top)?.candidate.name ??
    pool[0].candidate.name
  );
}

/** Official camp pages first: the main site's camp-looking pages, then its other pages, platforms, social. */
function rankUrls(group: MergeNode[], urls: string[]): string[] {
  const counts = new Map<string, number>();
  for (const node of group) {
    for (const url of node.urls) {
      const key = siteKey(url);
      if (key && !platformOf(url) && !isSocialPage(url))
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const mainSite = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const urlCounts = new Map<string, number>();
  for (const node of group) {
    for (const url of node.urls) {
      urlCounts.set(normalizedUrl(url), (urlCounts.get(normalizedUrl(url)) ?? 0) + 1);
    }
  }
  const score = (url: string): number => {
    if (isSocialPage(url)) return 4;
    if (platformOf(url)) return 3;
    const own = siteKey(url) === mainSite;
    const campish = CAMPISH_PATH.test(new URL(url).pathname);
    return own ? (campish ? 0 : 1) : campish ? 1.5 : 2;
  };
  return [...urls].sort(
    (a, b) =>
      score(a) - score(b) ||
      (urlCounts.get(normalizedUrl(b)) ?? 0) - (urlCounts.get(normalizedUrl(a)) ?? 0) ||
      a.length - b.length
  );
}

function normalizedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return url;
  }
}

function unique<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mostCommon(items: string[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Hallucination guard: the first page must load, mention a kids' program and name the provider
// ---------------------------------------------------------------------------

export interface PageCheck {
  url: string;
  name: string;
  ok: boolean;
  reason?: string;
  method?: string;
  finalUrl?: string;
  title?: string;
  checkedAt: string;
}

/**
 * Camp pages are often thin (a Squarespace title and a flyer image), so a camp, summer, VBS or
 * clinic mention is enough: requiring "kids" or "ages" too sent real camp pages to review.
 */
const PROGRAM_WORDS =
  /\bcamps?\b|\bcampers?\b|\bsummer\b|vacation bible school|\bvbs\b|\bclinics?\b|pre-?college|youth program/i;
const GENERIC_NAME_WORDS = new Set(
  'asheville north south east west western carolina county church baptist methodist united presbyterian episcopal lutheran catholic first christian community center centre school schools academy kids youth children club sports arts studio studios music dance theatre theater adventure adventures outdoor nature science learning education mountain mountains blue ridge valley river recreation parks department city town with from formerly day and'.split(
    ' '
  )
);

export async function checkProviderPage(
  name: string,
  url: string | undefined,
  fetcher: PageTextFetcher
): Promise<PageCheck> {
  const checkedAt = new Date().toISOString();
  if (!url) return { url: '', name, ok: false, reason: 'no official page found', checkedAt };
  if (isSocialPage(url)) {
    return {
      url,
      name,
      ok: false,
      reason: "first page is a social media page or video, which our fetcher can't read",
      checkedAt,
    };
  }
  try {
    const page = await fetcher.get(url);
    const base = {
      url,
      name,
      method: page.method,
      finalUrl: page.finalUrl,
      title: page.title,
      checkedAt,
    };
    if (!PROGRAM_WORDS.test(page.text)) {
      return {
        ...base,
        ok: false,
        reason: "page doesn't mention a kids' camp, summer program or VBS",
      };
    }
    const haystack = `${page.title}\n${page.text}\n${page.finalUrl}`
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '');
    const squashed = haystack.replace(/[^a-z0-9]/g, '');
    const words = nameKey(name)
      .split(' ')
      .filter((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word));
    if (
      words.length > 0 &&
      !words.some((word) => haystack.includes(word) || squashed.includes(word))
    ) {
      return {
        ...base,
        ok: false,
        reason: `page doesn't name the provider (looked for: ${words.join(', ')})`,
      };
    }
    return { ...base, ok: true };
  } catch (error) {
    const detail =
      error instanceof FetchPageError
        ? error.attempts.join('; ')
        : error instanceof Error
          ? error.message
          : String(error);
    // Playwright appends an ANSI-coloured call log to every error.
    const brief = detail
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\s*Call log:[^;]*/g, '')
      .replace(/\s+/g, ' ');
    return { url, name, ok: false, reason: `page didn't load: ${brief.slice(0, 300)}`, checkedAt };
  }
}
