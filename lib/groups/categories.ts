/**
 * Group Directory categories. Stored as the `groups.category` text value; this is the display order.
 * The research pass (data/groups/research/RESEARCH_AGENT.md) assigned exactly one per group.
 */
export const GROUP_CATEGORIES = [
  { value: 'outdoors', label: 'Outdoors & Fitness' },
  { value: 'music_dance', label: 'Music & Dance' },
  { value: 'arts_books', label: 'Arts, Crafts & Books' },
  { value: 'games_hobbies', label: 'Games & Hobbies' },
  { value: 'social', label: 'Social & Community' },
  { value: 'support', label: 'Support & Recovery' },
  { value: 'spirituality', label: 'Spirituality & Wellness' },
  { value: 'learning_career', label: 'Learning, Tech & Career' },
  { value: 'civic', label: 'Civic & Causes' },
] as const;

export type GroupCategory = (typeof GROUP_CATEGORIES)[number]['value'];

const LABELS = new Map<string, string>(GROUP_CATEGORIES.map((c) => [c.value, c.label]));

export function isGroupCategory(value: string): value is GroupCategory {
  return LABELS.has(value);
}

export function groupCategoryLabel(value: string): string {
  return LABELS.get(value) ?? 'Other';
}
