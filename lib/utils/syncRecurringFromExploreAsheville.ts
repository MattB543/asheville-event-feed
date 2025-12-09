/**
 * Sync recurring event info from Explore Asheville to existing DB events
 *
 * Explore Asheville has `recurringLabel` which tells us if an event is daily/weekly/monthly.
 * Other sources (AVL Today, Eventbrite, etc.) don't have this info.
 *
 * This function:
 * 1. Fetches daily recurring events from Explore Asheville API
 * 2. Fuzzy matches them to existing DB events (similar title + overlapping dates)
 * 3. Updates matching events with recurringType='daily' and recurringEndDate
 */

import { db } from '../db';
import { events } from '../db/schema';
import { isNull, eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const API_URL = 'https://www.exploreasheville.com/api/getListingGridData';
const PAGE_SIZE = 50;
const MAX_PAGES = 15;

interface ExploreAshevilleEvent {
  id: number;
  title: string;
  dates?: string[];
  recurringLabel?: string;
  venueName?: string;
}

// Fetch from Explore Asheville API using curl (to bypass TLS fingerprinting)
async function fetchPage(page: number): Promise<{ results: ExploreAshevilleEvent[], total: number }> {
  const params = new URLSearchParams({
    type: 'event',
    page: page.toString(),
    pageSize: PAGE_SIZE.toString(),
    sortValue: 'next_date',
    sortOrder: 'ASC',
  });

  const url = `${API_URL}?${params}`;
  const curlHeaders = [
    '-H "Accept: */*"',
    '-H "Accept-Language: en-US,en;q=0.5"',
    '-H "Accept-Encoding: gzip, deflate, br"',
    '-H "Referer: https://www.exploreasheville.com/events"',
    '-H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"',
    '-H "Connection: keep-alive"',
    '-H "Sec-Fetch-Dest: empty"',
    '-H "Sec-Fetch-Mode: cors"',
    '-H "Sec-Fetch-Site: same-origin"',
    '--compressed',
  ].join(' ');

  const cmd = `curl -s "${url}" ${curlHeaders}`;

  const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
  const data = JSON.parse(stdout);

  return {
    results: data.results || [],
    total: data.pageInfo?.total || 0
  };
}

// Normalize title for comparison (lowercase, remove common suffixes, trim)
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+by\s+.+$/, '') // Remove "by Author Name"
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if two titles are similar enough (STRICT matching)
function titlesSimilar(title1: string, title2: string): boolean {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  // Exact match after normalization
  if (norm1 === norm2) return true;

  // One contains the other entirely (but must be substantial - at least 15 chars)
  if (norm1.length >= 15 && norm2.length >= 15) {
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  }

  // Get significant words (length > 3, not common words)
  const commonWords = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your']);
  const getSignificantWords = (s: string) =>
    s.split(' ').filter(w => w.length > 3 && !commonWords.has(w));

  const words1 = getSignificantWords(norm1);
  const words2 = getSignificantWords(norm2);

  if (words1.length < 2 || words2.length < 2) return false;

  // Require at least 80% of BOTH sets to overlap
  const set1 = new Set(words1);
  const set2 = new Set(words2);

  const overlap1 = words1.filter(w => set2.has(w)).length / words1.length;
  const overlap2 = words2.filter(w => set1.has(w)).length / words2.length;

  return overlap1 >= 0.8 && overlap2 >= 0.8;
}

// Check if dates overlap
function datesOverlap(dbDate: Date, eaDates: Date[]): boolean {
  const dbDateStr = dbDate.toISOString().split('T')[0];
  return eaDates.some(d => d.toISOString().split('T')[0] === dbDateStr);
}

export interface SyncRecurringResult {
  dailyRecurringFound: number;
  eventsUpdated: number;
  matches: Array<{ dbTitle: string; eaTitle: string; source: string }>;
}

/**
 * Sync recurring info from Explore Asheville to matching DB events
 */
export async function syncRecurringFromExploreAsheville(): Promise<SyncRecurringResult> {
  console.log('[SyncRecurring] Fetching Explore Asheville events...');

  // 1. Fetch all daily recurring events from Explore Asheville
  const dailyRecurringEvents: ExploreAshevilleEvent[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const { results, total } = await fetchPage(page);

      const dailyOnPage = results.filter(e => e.recurringLabel === 'Recurring Daily');
      dailyRecurringEvents.push(...dailyOnPage);

      if (results.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= total) {
        break;
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      console.error(`[SyncRecurring] Error fetching page ${page}:`, error);
      break;
    }
  }

  console.log(`[SyncRecurring] Found ${dailyRecurringEvents.length} daily recurring events on Explore Asheville`);

  // 2. Get all DB events that don't have recurringType set
  const dbEvents = await db
    .select({
      id: events.id,
      title: events.title,
      startDate: events.startDate,
      source: events.source,
    })
    .from(events)
    .where(isNull(events.recurringType));

  // 3. Match and update
  const matches: Array<{ dbTitle: string; eaTitle: string; source: string }> = [];

  for (const eaEvent of dailyRecurringEvents) {
    const eaDates = (eaEvent.dates || []).map(d => new Date(d));
    if (eaDates.length === 0) continue;

    const endDate = eaDates[eaDates.length - 1];

    // Find matching DB events
    for (const dbEvent of dbEvents) {
      if (titlesSimilar(dbEvent.title, eaEvent.title) &&
          datesOverlap(dbEvent.startDate, eaDates)) {

        // Update the DB event
        await db.update(events)
          .set({
            recurringType: 'daily',
            recurringEndDate: endDate,
          })
          .where(eq(events.id, dbEvent.id));

        matches.push({
          dbTitle: dbEvent.title,
          eaTitle: eaEvent.title,
          source: dbEvent.source,
        });
      }
    }
  }

  console.log(`[SyncRecurring] Updated ${matches.length} events with recurringType='daily'`);

  return {
    dailyRecurringFound: dailyRecurringEvents.length,
    eventsUpdated: matches.length,
    matches,
  };
}
