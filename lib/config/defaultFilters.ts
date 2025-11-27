/**
 * Default filter keywords to hide low-quality or spam events.
 * These are applied when the user hasn't customized their own filters.
 */

export const DEFAULT_BLOCKED_KEYWORDS = [
  // Certification/Training Spam
  "certification training",
  "six sigma",
  "lean six sigma",
  "PMP certification",
  "CAPM certification",
  "agile certification",
  "scrum certification",
  "tableau certification",
  "salesforce certification",
  "SAFe",
  "CBAP",
  "bootcamp training",
  "classroom training",
  "PMI",
  "IIBA",
  "data analytics certification",
  "project management techniques",
  "Walking Tour",

  // App-Based/Self-Guided (Always Available, Not Real Events)
  "self-guided",
  "walking tour app",
  "driving tour",
  "GPS app",
  "smartphone guided",
  "Let's Roam",
  "Wacky Walks",
  "Zombie Scavengers",
  "scavenger hunt",

  // Generic Online Events Marketed as Local
  "Online for Asheville",
  "Online talk for Asheville",
  "Online event for Asheville",

  // Miscellaneous Low-Signal
  "vendors needed",
  "spirit rock",
  "Highly rated on Apple",
  "Highly rated on Google Play",
  "DocuSign",
  "Botox",
  "Dermal Filler",
  "Dinner with Strangers Asheville: Duos Edition",
  "history tour",
  "at Regina’s",
  "Embassy Suites",
  "Tanger Outlets",
  "Training Course",
  "CANCELLED",
  "real estate investment",
  "prospective homebuyers",
];

/**
 * Check if text contains any of the blocked keywords (case insensitive)
 */
export function matchesDefaultFilter(text: string): boolean {
  const lowerText = text.toLowerCase();
  return DEFAULT_BLOCKED_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase())
  );
}
