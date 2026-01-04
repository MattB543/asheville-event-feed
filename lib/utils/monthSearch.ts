/**
 * Month search detection and date range conversion utilities.
 * Extracts month names from search queries and converts them to date filters.
 */

interface MonthSearchResult {
  month: number; // 0-11 (JavaScript month index)
  year: number;
  remainingText: string; // Search text with month removed
}

interface DateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

// Month name mappings - full names and 3-letter abbreviations (0-indexed)
const MONTH_PATTERNS: Array<{ pattern: RegExp; month: number }> = [
  // Full names (must come before abbreviations to match longer strings first)
  { pattern: /\bjanuary\b/i, month: 0 },
  { pattern: /\bfebruary\b/i, month: 1 },
  { pattern: /\bmarch\b/i, month: 2 },
  { pattern: /\bapril\b/i, month: 3 },
  { pattern: /\bmay\b/i, month: 4 },
  { pattern: /\bjune\b/i, month: 5 },
  { pattern: /\bjuly\b/i, month: 6 },
  { pattern: /\baugust\b/i, month: 7 },
  { pattern: /\bseptember\b/i, month: 8 },
  { pattern: /\boctober\b/i, month: 9 },
  { pattern: /\bnovember\b/i, month: 10 },
  { pattern: /\bdecember\b/i, month: 11 },
  // 3-letter abbreviations (with word boundaries to avoid matching "mar" in "marching")
  { pattern: /\bjan\b/i, month: 0 },
  { pattern: /\bfeb\b/i, month: 1 },
  { pattern: /\bmar\b/i, month: 2 },
  { pattern: /\bapr\b/i, month: 3 },
  // 'may' is already covered by full name above
  { pattern: /\bjun\b/i, month: 5 },
  { pattern: /\bjul\b/i, month: 6 },
  { pattern: /\baug\b/i, month: 7 },
  { pattern: /\bsep\b/i, month: 8 },
  { pattern: /\bsept\b/i, month: 8 },
  { pattern: /\boct\b/i, month: 9 },
  { pattern: /\bnov\b/i, month: 10 },
  { pattern: /\bdec\b/i, month: 11 },
];

/**
 * Extracts a month from a search string.
 * Uses word boundaries to avoid false positives (e.g., "marching" won't match "march").
 *
 * @param searchTerm - The user's search input
 * @returns MonthSearchResult if month found, null otherwise
 *
 * @example
 * extractMonthFromSearch("March") // { month: 2, year: 2026, remainingText: "" }
 * extractMonthFromSearch("concerts in March") // { month: 2, year: 2026, remainingText: "concerts in" }
 * extractMonthFromSearch("March events") // { month: 2, year: 2026, remainingText: "events" }
 * extractMonthFromSearch("hello world") // null
 */
export function extractMonthFromSearch(searchTerm: string): MonthSearchResult | null {
  const trimmed = searchTerm.trim();
  if (!trimmed) return null;

  // Try each month pattern
  for (const { pattern, month } of MONTH_PATTERNS) {
    if (pattern.test(trimmed)) {
      // Remove the month from the search text
      const remainingText = trimmed
        .replace(pattern, '')
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .trim();

      // Determine the appropriate year
      const year = getTargetYear(month);

      return { month, year, remainingText };
    }
  }

  return null;
}

/**
 * Determines which year to use for a given month.
 * If the month has already passed this year, use next year.
 * Uses Eastern timezone since the app is for Asheville, NC.
 */
function getTargetYear(month: number): number {
  // Get current date in Eastern timezone
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const currentYear = eastern.getFullYear();
  const currentMonth = eastern.getMonth();
  const currentDay = eastern.getDate();

  // If the target month is in the past, use next year
  if (month < currentMonth) {
    return currentYear + 1;
  }

  // If we're in the target month, check if there are still days left
  if (month === currentMonth) {
    const lastDayOfMonth = new Date(currentYear, month + 1, 0).getDate();
    // If today is the last day of the month, use next year
    if (currentDay >= lastDayOfMonth) {
      return currentYear + 1;
    }
  }

  return currentYear;
}

/**
 * Converts a month and year to a date range.
 *
 * @param month - Month index (0-11)
 * @param year - Full year (e.g., 2026)
 * @returns DateRange with start and end in YYYY-MM-DD format
 *
 * @example
 * getMonthDateRange(2, 2026) // { start: "2026-03-01", end: "2026-03-31" }
 * getMonthDateRange(1, 2024) // { start: "2024-02-01", end: "2024-02-29" } (leap year)
 */
export function getMonthDateRange(month: number, year: number): DateRange {
  // First day of the month
  const startDate = new Date(year, month, 1);

  // Last day of the month (day 0 of next month = last day of this month)
  const endDate = new Date(year, month + 1, 0);

  return {
    start: formatDateString(startDate),
    end: formatDateString(endDate),
  };
}

/**
 * Formats a Date object to YYYY-MM-DD string.
 */
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
