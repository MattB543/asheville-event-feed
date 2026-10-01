/**
 * The news taxonomy: 12 topics and the Buncombe places, single-sourced for the
 * AI prompts (lib/news/ai/*) and the /news UI. Articles and stories store the
 * topic `slug` and the place string exactly as listed here; anything else the
 * model returns is dropped. Slugs appear in share and filter URLs
 * (`/news?topic=<slug>`), so never rename one.
 */

export interface NewsTopic {
  /** Stable id, stored in news_articles.topics / news_stories.topics. */
  slug: string;
  label: string;
  /** One-word tag for tight spaces. */
  kicker: string;
  /** What belongs in the topic. Fed to the enrichment prompt. */
  guidance: string;
}

export const NEWS_TOPICS = [
  {
    slug: 'government',
    label: 'Government & Politics',
    kicker: 'Civic',
    guidance:
      'City council, county commission, town boards, elections, budgets, taxes, ordinances, utilities and public services',
  },
  {
    slug: 'housing',
    label: 'Housing & Growth',
    kicker: 'Growth',
    guidance: 'Housing, homelessness, zoning, development, real estate',
  },
  {
    slug: 'helene',
    label: 'Helene Recovery',
    kicker: 'Helene',
    guidance:
      'Anything materially about recovery from Hurricane Helene (funding, rebuilding, debris, FEMA). Usually paired with another topic',
  },
  {
    slug: 'environment',
    label: 'Environment & Outdoors',
    kicker: 'Outdoors',
    guidance:
      'Rivers, parks, trails, the Blue Ridge Parkway, wildlife and bears, drought, conservation',
  },
  {
    slug: 'schools',
    label: 'Schools & Kids',
    kicker: 'Schools',
    guidance:
      'Buncombe County Schools, Asheville City Schools, charter schools, childcare, UNC Asheville, A-B Tech, youth programs',
  },
  {
    slug: 'business',
    label: 'Business & Food',
    kicker: 'Business',
    guidance: 'Openings and closings, restaurants, breweries, jobs, the economy, tourism',
  },
  {
    slug: 'arts',
    label: 'Arts & Culture',
    kicker: 'Culture',
    guidance: 'Music, visual and performing arts, festivals, history, local media',
  },
  {
    slug: 'public-safety',
    label: 'Public Safety',
    kicker: 'Safety',
    guidance: 'Crime, courts, police, sheriff, fire, EMS, emergency management',
  },
  {
    slug: 'health',
    label: 'Health',
    kicker: 'Health',
    guidance: 'Mission Hospital/HCA, Novant, AdventHealth, clinics, public health',
  },
  {
    slug: 'getting-around',
    label: 'Getting Around',
    kicker: 'Roads',
    guidance: 'Roads and road work, I-40 and I-26, transit, the airport, greenways, parking',
  },
  {
    slug: 'weather',
    label: 'Weather',
    kicker: 'Weather',
    guidance: 'Severe weather, storms, floods, weather alerts',
  },
  {
    slug: 'sports',
    label: 'Sports',
    kicker: 'Sports',
    guidance: 'UNC Asheville athletics, high school sports, minor league teams, tournaments',
  },
] as const satisfies readonly NewsTopic[];

export type NewsTopicSlug = (typeof NEWS_TOPICS)[number]['slug'];

const TOPIC_BY_SLUG = new Map<string, NewsTopic>(NEWS_TOPICS.map((t) => [t.slug, t]));
const TOPIC_BY_LABEL = new Map<string, NewsTopic>(
  NEWS_TOPICS.map((t) => [t.label.toLowerCase(), t])
);

export function isNewsTopicSlug(value: string): value is NewsTopicSlug {
  return TOPIC_BY_SLUG.has(value);
}

export function newsTopic(slug: string): NewsTopic | undefined {
  return TOPIC_BY_SLUG.get(slug);
}

/** A model's topic (slug or label, any case) as a slug, or undefined if it isn't one of ours. */
export function normalizeNewsTopic(value: unknown): NewsTopicSlug | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase();
  const topic = TOPIC_BY_SLUG.get(key) ?? TOPIC_BY_LABEL.get(key);
  return topic?.slug as NewsTopicSlug | undefined;
}

/**
 * Buncombe County places a story can be filed under. The last two are the
 * catch-alls: "Asheville" is city-wide, "Buncombe County" county-wide.
 * Henderson County towns (Fletcher, Hendersonville, Mills River) are out of
 * scope for news.
 */
export const NEWS_PLACES = [
  'Downtown',
  'West Asheville',
  'North Asheville',
  'East Asheville',
  'South Asheville',
  'Black Mountain',
  'Montreat',
  'Biltmore Forest',
  'Weaverville',
  'Woodfin',
  'Swannanoa',
  'Fairview',
  'Candler',
  'Leicester',
  'Arden',
  'Enka',
  'Barnardsville',
  'Asheville',
  'Buncombe County',
] as const;

export type NewsPlace = (typeof NEWS_PLACES)[number];

/** Neighborhoods and landmarks that file under each area. Fed to the enrichment prompt. */
export const NEWS_PLACE_GUIDANCE: Partial<Record<NewsPlace, string>> = {
  Downtown: 'South Slope, Lexington Ave, Pack Square, Southside, the East End',
  'West Asheville':
    'Haywood Road, River Arts District, Burton Street, Emma, Deaverview, Pisgah View, Malvern Hills',
  'North Asheville': 'Montford, Five Points, Grove Park, Norwood Park, Beaver Lake, Kimberly, UNCA',
  'East Asheville':
    'Kenilworth, Haw Creek, Oakley, Beverly Hills, Tunnel Road, Chunns Cove, Riceville',
  'South Asheville':
    'Biltmore Village, Shiloh, Biltmore Park, Royal Pines, Gerber Village, Long Shoals, Skyland',
  'Black Mountain': 'including Ridgecrest',
  Swannanoa: 'including Bee Tree and North Fork',
  Asheville: 'city-wide, or an Asheville location not in one of the areas above',
  'Buncombe County': 'county-wide, or the county government with no single place',
};

const PLACE_BY_KEY = new Map<string, NewsPlace>(NEWS_PLACES.map((p) => [p.toLowerCase(), p]));

/** A model's place as one of NEWS_PLACES, or undefined if it isn't one. */
export function normalizeNewsPlace(value: unknown): NewsPlace | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/\s*\((city|county)-wide\)$/, '');
  return PLACE_BY_KEY.get(key);
}
