/**
 * Tag categories matching the AI tagging guidelines
 * Used for grouping tags in the filter UI
 */

export interface TagCategory {
  readonly name: string;
  readonly tags: readonly string[];
}

export const TAG_CATEGORIES = [
  {
    name: 'Entertainment',
    tags: ['Live Music', 'Comedy', 'Theater & Film', 'Dance', 'Trivia', 'Open Mic', 'Karaoke'],
  },
  {
    name: 'Food & Drink',
    tags: ['Dining', 'Beer', 'Wine & Spirits'],
  },
  {
    name: 'Activities',
    tags: [
      'Art',
      'Crafts',
      'Fitness',
      'Sports',
      'Wellness',
      'Spiritual',
      'Meditation',
      'Outdoors',
      'Tours',
      'Gaming',
      'Education',
      'Tech',
      'Book Club',
      'Museum Exhibition',
    ],
  },
  {
    name: 'Audience/Social',
    tags: [
      'Family',
      'Dating',
      'Networking',
      'Nightlife',
      'LGBTQ+',
      'Pets',
      'Community',
      'Volunteering',
      'Support Groups',
    ],
  },
  {
    name: 'Seasonal',
    tags: ['Holiday', 'Markets'],
  },
] as const satisfies readonly TagCategory[];

type OfficialTag = (typeof TAG_CATEGORIES)[number]['tags'][number];

/**
 * Per-tag guidance shown to the tagging model.
 *
 * The AI system prompt is generated from TAG_CATEGORIES + this map so the tag
 * list can't drift between the UI filters and what the model is allowed to
 * emit. Every tag in TAG_CATEGORIES must have an entry here.
 */
export const TAG_GUIDANCE = {
  // Entertainment
  'Live Music': 'concerts, bands, live performances',
  Comedy: 'stand-up, improv, showcases',
  'Theater & Film': 'plays, performances, movie nights',
  Dance: 'lessons, parties, social dance nights',
  Trivia: 'pub trivia, game nights',
  'Open Mic': 'open mic nights, poetry slams, showcases',
  Karaoke: 'karaoke nights, sing-along events',
  // Food & Drink
  Dining: 'special dinners, brunches, prix fixe meals',
  Beer: 'brewery events, tastings',
  'Wine & Spirits': 'wine tastings, cocktail events',
  // Activities
  Art: 'galleries, visual art events, art classes',
  Crafts: 'pottery, jewelry, DIY workshops',
  Fitness: 'yoga, exercise, climbing, general fitness',
  Sports: 'team sports, athletic events, competitions',
  Wellness: 'sound healing, holistic health, self-care',
  Spiritual: 'ceremonies, religious gatherings, dharma talks',
  Meditation: 'meditation sits, mindfulness, guided meditation',
  Outdoors: 'hiking, nature, parks',
  Tours: 'walking tours, ghost tours, historical',
  Gaming: 'board games, D&D, video games',
  Education: 'classes, workshops, lectures, learning events',
  Tech: 'technology meetups, coding, maker events',
  'Book Club': 'book discussions, reading groups, literary meetups',
  'Museum Exhibition': 'museum exhibits, gallery shows, curated displays',
  // Audience/Social
  Family: 'kid-friendly, all-ages',
  Dating: 'singles events, speed dating',
  Networking: 'business, professional meetups',
  Nightlife: '21+, bar events, late-night',
  'LGBTQ+': 'pride, queer-specific events',
  Pets: 'dog-friendly, goat yoga, cat lounges',
  Community: 'neighborhood events, local meetups',
  Volunteering: 'volunteer opportunities, community service, charity work',
  'Support Groups': 'recovery, grief, mental health support meetings',
  // Seasonal
  Holiday: 'seasonal celebrations, Christmas, Halloween, etc.',
  Markets: 'pop-ups, vendors, shopping, craft fairs',
} satisfies Record<OfficialTag, string>;

// Flat list of all known tags
export const ALL_KNOWN_TAGS: string[] = TAG_CATEGORIES.flatMap((cat) => [...cat.tags]);

// Set of official tags for O(1) lookup (used by frontend to filter displayed tags)
export const OFFICIAL_TAGS_SET: ReadonlySet<string> = new Set(ALL_KNOWN_TAGS);

// Get category for a tag
export function getTagCategory(tag: string): string | null {
  for (const category of TAG_CATEGORIES) {
    if ((category.tags as readonly string[]).includes(tag)) {
      return category.name;
    }
  }
  return null;
}
