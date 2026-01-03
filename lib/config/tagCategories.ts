/**
 * Tag categories matching the AI tagging guidelines
 * Used for grouping tags in the filter UI
 */

export interface TagCategory {
  name: string;
  tags: string[];
}

export const TAG_CATEGORIES: TagCategory[] = [
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
];

// Flat list of all known tags
export const ALL_KNOWN_TAGS = TAG_CATEGORIES.flatMap((cat) => cat.tags);

// Set of official tags for O(1) lookup (used by frontend to filter displayed tags)
export const OFFICIAL_TAGS_SET = new Set(ALL_KNOWN_TAGS);

// Get category for a tag
export function getTagCategory(tag: string): string | null {
  for (const category of TAG_CATEGORIES) {
    if (category.tags.includes(tag)) {
      return category.name;
    }
  }
  return null;
}
