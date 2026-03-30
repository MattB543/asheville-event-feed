/**
 * Check which Mixed Routes events already exist in our database.
 *
 * Parses events from claude/march_and_april_events.md and queries the DB
 * using fuzzy title matching (ILIKE with key words) + date range filtering.
 *
 * Usage: npx tsx scripts/check-mixed-routes-events.ts
 */

import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, and, gte, lte, ne } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

// --- Date helpers ---

// The markdown was captured on 2026-03-28 (today's date per memory context)
const CAPTURE_DATE = new Date('2026-03-28');

/**
 * Parse the date portion of a Mixed Routes event line.
 * Formats observed:
 *   "Sat, Mar 28th - 29th"
 *   "Fri, Mar 6th - Sun, Apr 5th"
 *   "Today • 6 PM"
 *   "Tomorrow • 4 PM"
 *   "Tomorrow"
 *   "Fri, Apr 10th • 7 PM"
 *   "Wed, Jun 24th • 2 PM"
 *   "dom, 29 mar, 2:00 – 5:00 p.m."  (Spanish format)
 *   "mié, 22 abr, 10:30 a.m."         (Spanish format)
 *   "Sun, Mar 15th - Sun, Apr 12th"
 *
 * Returns a { start: Date, end: Date } range to search within.
 */
function parseDateRange(dateStr: string): { start: Date; end: Date } | null {
  const s = dateStr.trim();

  // "Today" => capture date +/- 1 day
  if (s.toLowerCase().startsWith('today')) {
    const d = new Date(CAPTURE_DATE);
    return {
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 23, 59, 59),
    };
  }

  // "Tomorrow" => capture date + 1 +/- 1 day
  if (s.toLowerCase().startsWith('tomorrow')) {
    const d = new Date(CAPTURE_DATE);
    d.setDate(d.getDate() + 1);
    return {
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 23, 59, 59),
    };
  }

  // Try to extract a month + day from English format: "Apr 10th", "Mar 28th"
  const monthMap: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };

  // Spanish month abbreviations
  const spanishMonthMap: Record<string, number> = {
    ene: 0,
    feb: 1,
    mar: 2,
    abr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    ago: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dic: 11,
  };

  // Try Spanish format: "29 mar" or "22 abr"
  const spanishMatch = s.match(/(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i);
  if (spanishMatch) {
    const day = parseInt(spanishMatch[1]);
    const month = spanishMonthMap[spanishMatch[2].toLowerCase()];
    if (month !== undefined) {
      const year = 2026;
      return {
        start: new Date(year, month, day - 1),
        end: new Date(year, month, day + 1, 23, 59, 59),
      };
    }
  }

  // English format: "Mar 28th", "Apr 10th", etc.
  const engMatch = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[.,]?\s+(\d{1,2})/i);
  if (engMatch) {
    const month = monthMap[engMatch[1].toLowerCase()];
    const day = parseInt(engMatch[2]);
    if (month !== undefined) {
      const year = 2026;
      return {
        start: new Date(year, month, day - 1),
        end: new Date(year, month, day + 1, 23, 59, 59),
      };
    }
  }

  return null;
}

interface MixedRoutesEvent {
  title: string;
  location: string;
  dateStr: string;
  dateRange: { start: Date; end: Date } | null;
  category: string;
  url: string;
  rawLine: string;
}

/**
 * Parse markdown file and extract events.
 * Lines look like:
 *   - [Title - Location, City, NC - DateInfo](url)
 */
function parseMarkdown(filePath: string): MixedRoutesEvent[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results: MixedRoutesEvent[] = [];
  let currentCategory = '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, ''); // Strip Windows CR

    // Category headers: "# emoji Category"
    const catMatch = line.match(/^#\s+\S+\s+(.+)$/);
    if (catMatch) {
      currentCategory = catMatch[1].trim();
      continue;
    }

    // Event lines: "- [Text](url)"
    const eventMatch = line.match(/^-\s+\[(.+?)\]\((.+?)\)\s*$/);
    if (!eventMatch) continue;

    const fullText = eventMatch[1];
    const url = eventMatch[2];

    // Split on " - " to get title, location, date
    // The format is: "Title - Location, City, State - DateInfo"
    // But some titles contain " - " too, so we split from the right
    const parts = fullText.split(' - ');

    if (parts.length < 2) {
      // Can't parse, use full text as title
      results.push({
        title: fullText,
        location: '',
        dateStr: '',
        dateRange: null,
        category: currentCategory,
        url,
        rawLine: line,
      });
      continue;
    }

    // The last part is the date, the second-to-last contains the location
    // Everything before is the title
    const dateStr = parts[parts.length - 1].trim();

    // Try to find where the location starts by looking for state abbreviations
    // Location typically contains ", NC" or ", Estados Unidos"
    let title = '';
    let location = '';

    // Walk from the end to find the location part (contains NC/state)
    let locationPartIdx = -1;
    for (let i = parts.length - 2; i >= 0; i--) {
      if (parts[i].match(/\b(NC|Estados Unidos|United States)\b/i)) {
        locationPartIdx = i;
        break;
      }
    }

    if (locationPartIdx > 0) {
      title = parts.slice(0, locationPartIdx).join(' - ').trim();
      location = parts[locationPartIdx].trim();
    } else if (locationPartIdx === 0) {
      // The whole thing before date is location, title is tricky
      title = parts[0].trim();
      location = parts[0].trim();
    } else {
      // No state found, assume first part is title, middle is location
      title = parts[0].trim();
      location = parts.length > 2 ? parts[parts.length - 2].trim() : '';
    }

    const dateRange = parseDateRange(dateStr);

    results.push({
      title,
      location,
      dateStr,
      dateRange,
      category: currentCategory,
      url,
      rawLine: line,
    });
  }

  return results;
}

/**
 * Extract meaningful search keywords from a title.
 * Strips short/common words, returns significant terms for ILIKE search.
 */
function extractSearchTerms(title: string): string[] {
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'at',
    'in',
    'on',
    'for',
    'of',
    'and',
    'or',
    'with',
    'to',
    'from',
    'by',
    'is',
    'it',
    'its',
    'this',
    'that',
    'as',
    'be',
    'are',
    'was',
    'were',
    'been',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'can',
    'shall',
    'has',
    'have',
    'had',
    'not',
    'no',
    'but',
    'if',
    'then',
    'than',
    'so',
    'up',
    'out',
    'off',
    'all',
    'our',
    'we',
    'us',
    'you',
    'your',
    'they',
    'their',
    'my',
    'me',
    'he',
    'she',
    'him',
    'her',
    'his',
    // Event-specific noise
    'event',
    'night',
    'live',
    'music',
    'show',
    'apr',
    'mar',
    'fri',
    'sat',
    'sun',
    'mon',
    'tue',
    'wed',
    'thu',
  ]);

  // Clean up the title
  const cleaned = title
    .replace(/['']/g, "'")
    .replace(/[^\w\s'-]/g, ' ') // Remove special chars except apostrophe/hyphen
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ');
  const terms: string[] = [];

  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < 3) continue;
    if (stopWords.has(lower)) continue;
    terms.push(word);
  }

  return terms;
}

interface MatchResult {
  event: MixedRoutesEvent;
  status: 'found' | 'not_found' | 'uncertain';
  matches: Array<{
    id: string;
    title: string;
    startDate: Date;
    location: string | null;
    source: string;
    url: string;
  }>;
}

async function checkEvent(event: MixedRoutesEvent): Promise<MatchResult> {
  const terms = extractSearchTerms(event.title);

  if (terms.length === 0) {
    return { event, status: 'not_found', matches: [] };
  }

  // Build ILIKE conditions for the most distinctive terms
  // Use the longest/most unique terms (up to 3)
  const searchTerms = terms
    .sort((a, b) => b.length - a.length) // Longest first
    .slice(0, 3);

  // Build WHERE clause: title ILIKE '%term1%' AND title ILIKE '%term2%' ...
  const conditions = searchTerms.map((term) => sql`${events.title} ILIKE ${'%' + term + '%'}`);

  // Add date range if we have one
  if (event.dateRange) {
    conditions.push(gte(events.startDate, event.dateRange.start));
    conditions.push(lte(events.startDate, event.dateRange.end));
  }

  // Also exclude hidden events
  conditions.push(ne(events.hidden, true));

  const matches = await db
    .select({
      id: events.id,
      title: events.title,
      startDate: events.startDate,
      location: events.location,
      source: events.source,
      url: events.url,
    })
    .from(events)
    .where(and(...conditions))
    .limit(5);

  if (matches.length > 0) {
    return { event, status: 'found', matches };
  }

  // If no results with date filter, try without date (in case dates differ)
  if (event.dateRange && searchTerms.length >= 2) {
    const looseConditions = searchTerms.map(
      (term) => sql`${events.title} ILIKE ${'%' + term + '%'}`
    );
    looseConditions.push(ne(events.hidden, true));

    // Only look at future events (after 2026-03-01) to avoid ancient matches
    looseConditions.push(gte(events.startDate, new Date('2026-03-01')));

    const looseMatches = await db
      .select({
        id: events.id,
        title: events.title,
        startDate: events.startDate,
        location: events.location,
        source: events.source,
        url: events.url,
      })
      .from(events)
      .where(and(...looseConditions))
      .limit(5);

    if (looseMatches.length > 0) {
      return { event, status: 'uncertain', matches: looseMatches };
    }
  }

  return { event, status: 'not_found', matches: [] };
}

async function main() {
  const mdPath = path.resolve(__dirname, '..', 'claude', 'march_and_april_events.md');

  if (!fs.existsSync(mdPath)) {
    console.error(`File not found: ${mdPath}`);
    process.exit(1);
  }

  console.log('Parsing Mixed Routes events...\n');
  const mixedEvents = parseMarkdown(mdPath);
  console.log(`Found ${mixedEvents.length} events in markdown file.\n`);

  // Filter out food truck events - not a good fit for the DB
  const foodTruckPattern = /food\s*truck/i;
  const skipped: MixedRoutesEvent[] = [];
  const filteredEvents: MixedRoutesEvent[] = [];

  for (const event of mixedEvents) {
    if (foodTruckPattern.test(event.title) || foodTruckPattern.test(event.location)) {
      skipped.push(event);
    } else {
      filteredEvents.push(event);
    }
  }

  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} food truck events:`);
    for (const e of skipped) {
      console.log(`  - "${e.title}"`);
    }
    console.log();
  }

  const found: MatchResult[] = [];
  const notFound: MatchResult[] = [];
  const uncertain: MatchResult[] = [];

  for (const event of filteredEvents) {
    const result = await checkEvent(event);
    if (result.status === 'found') found.push(result);
    else if (result.status === 'uncertain') uncertain.push(result);
    else notFound.push(result);
  }

  // --- Print results ---

  console.log('='.repeat(80));
  console.log(`FOUND IN DATABASE: ${found.length} events`);
  console.log('='.repeat(80));
  for (const r of found) {
    console.log(`\n  [MR] "${r.event.title}"`);
    console.log(`       Date: ${r.event.dateStr} | Category: ${r.event.category}`);
    for (const m of r.matches) {
      console.log(`  [DB] "${m.title}"`);
      console.log(
        `       Date: ${m.startDate.toISOString().slice(0, 10)} | Source: ${m.source} | Location: ${m.location || 'N/A'}`
      );
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`UNCERTAIN (title match but date mismatch): ${uncertain.length} events`);
  console.log('='.repeat(80));
  for (const r of uncertain) {
    console.log(`\n  [MR] "${r.event.title}"`);
    console.log(`       Date: ${r.event.dateStr} | Category: ${r.event.category}`);
    for (const m of r.matches) {
      console.log(`  [DB] "${m.title}"`);
      console.log(
        `       Date: ${m.startDate.toISOString().slice(0, 10)} | Source: ${m.source} | Location: ${m.location || 'N/A'}`
      );
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`NOT FOUND: ${notFound.length} events`);
  console.log('='.repeat(80));
  for (const r of notFound) {
    console.log(`\n  [MR] "${r.event.title}"`);
    console.log(
      `       Date: ${r.event.dateStr} | Location: ${r.event.location} | Category: ${r.event.category}`
    );
  }

  // --- Summary ---
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Total Mixed Routes events:  ${mixedEvents.length}`);
  console.log(`  Skipped (food trucks):      ${skipped.length}`);
  console.log(`  Checked:                    ${filteredEvents.length}`);
  console.log(`  Found in DB:                ${found.length}`);
  console.log(`  Uncertain (date mismatch):  ${uncertain.length}`);
  console.log(`  Not found:                  ${notFound.length}`);
  const coverage = (((found.length + uncertain.length) / filteredEvents.length) * 100).toFixed(1);
  console.log(`  Coverage (found+uncertain): ${coverage}%`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
