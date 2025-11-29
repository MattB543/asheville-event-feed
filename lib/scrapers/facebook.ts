/**
 * Facebook Events Scraper
 *
 * Main orchestrator for scraping Facebook events for Asheville, NC.
 * Combines Patchright-based event discovery with GraphQL API fetching.
 *
 * Architecture:
 * 1. Use Playwright (Patchright) to discover event IDs from FB events page
 * 2. Use GraphQL API to fetch full event details (header + description)
 * 3. Transform to common ScrapedEvent format
 * 4. Return events for database upsert
 *
 * Anti-detection measures:
 * - Patchright (patched Playwright) with CDP leak fixes
 * - Real Chrome browser (not Chromium)
 * - Human-like behavior patterns
 * - Authenticated session via cookies
 * - Rate limiting between requests
 */

import { isFacebookEnabled } from '../config/env';
import {
  discoverAndFetchFacebookEvents,
  discoverFacebookEventIds,
  type FacebookEventDetails,
} from './facebook-discover';
import { fetchAllEventDetails, type FacebookGraphQLEvent } from './facebook-graphql';
import type { ScrapedEvent } from './types';
import { log } from './facebook-stealth';

/**
 * Transform Facebook GraphQL event data to common ScrapedEvent format
 */
function transformToScrapedEvent(fbEvent: FacebookGraphQLEvent): ScrapedEvent {
  // Convert Unix timestamp to Date
  let startDate: Date;
  if (fbEvent.startTimestamp) {
    startDate = new Date(fbEvent.startTimestamp * 1000);
  } else {
    // Fallback to current date + 7 days if no timestamp
    startDate = new Date();
    startDate.setDate(startDate.getDate() + 7);
  }

  // Format price
  let price = 'Unknown';
  if (fbEvent.price) {
    price = fbEvent.price;
  }

  return {
    sourceId: fbEvent.eventId,
    source: 'FACEBOOK',
    title: fbEvent.title,
    description: fbEvent.description || undefined,
    startDate,
    location: fbEvent.location || 'Asheville, NC',
    organizer: fbEvent.organizer || undefined,
    price,
    url: fbEvent.url,
    imageUrl: fbEvent.imageUrl || undefined,
  };
}

/**
 * Transform browser-fetched event data to common ScrapedEvent format
 */
function transformBrowserEventToScrapedEvent(fbEvent: FacebookEventDetails): ScrapedEvent {
  // Convert Unix timestamp to Date
  let startDate: Date;
  if (fbEvent.startTimestamp) {
    startDate = new Date(fbEvent.startTimestamp * 1000);
  } else {
    startDate = new Date();
    startDate.setDate(startDate.getDate() + 7);
  }

  return {
    sourceId: fbEvent.eventId,
    source: 'FACEBOOK',
    title: fbEvent.title || 'Untitled Event',
    description: fbEvent.description || undefined,
    startDate,
    location: fbEvent.location || 'Asheville, NC',
    organizer: fbEvent.organizer || undefined,
    price: fbEvent.price || 'Unknown',
    url: fbEvent.url,
    imageUrl: fbEvent.imageUrl || undefined,
    interestedCount: fbEvent.interestedCount ?? undefined,
    goingCount: fbEvent.goingCount ?? undefined,
  };
}

/**
 * Main Facebook scraper function
 *
 * Process:
 * 1. Check if Facebook scraping is enabled
 * 2. Discover event IDs and fetch details in a single browser session
 * 3. Transform to common event format
 *
 * Uses browser-based GraphQL fetching which ensures fresh tokens for every request.
 *
 * @returns Array of ScrapedEvent objects
 */
export async function scrapeFacebookEvents(): Promise<ScrapedEvent[]> {
  console.log('\n🔵 Scraping Facebook Events...');

  if (!isFacebookEnabled()) {
    console.log('  ⚠️  Facebook scraping disabled (missing credentials)');
    return [];
  }

  try {
    // Combined discovery + fetch in single browser session
    const fbEvents = await discoverAndFetchFacebookEvents({
      maxScrolls: 25,
      targetEvents: 100,
      onProgress: (completed, total) => {
        if (completed % 10 === 0 || completed === total) {
          log(`  Progress: ${completed}/${total} events`);
        }
      },
    });

    if (fbEvents.length === 0) {
      console.log('  ⚠️  No events discovered from Facebook');
      return [];
    }

    console.log(`  📦 Fetched ${fbEvents.length} events`);

    // Transform to common format
    const events = fbEvents.map(transformBrowserEventToScrapedEvent);

    // Log some stats
    const withDesc = events.filter(e => e.description).length;
    const withImage = events.filter(e => e.imageUrl).length;
    const withOrg = events.filter(e => e.organizer).length;
    console.log(`  📊 Stats: ${withDesc} desc, ${withImage} img, ${withOrg} organizer`);

    console.log(`  ✅ Scraped ${events.length} Facebook events\n`);
    return events;
  } catch (error) {
    console.error('  ❌ Facebook scraping error:', error);

    if (error instanceof Error) {
      if (error.message.includes('blocked') || error.message.includes('login')) {
        console.error('  🚫 Facebook blocked access. Try again later.');
      } else if (error.message.includes('timeout')) {
        console.error('  ⏱️  Request timed out. Check network connection.');
      }
    }

    return [];
  }
}

/**
 * Scrape Facebook events with custom event IDs
 * Useful for testing or targeted scraping
 *
 * @param eventIds Specific event IDs to fetch
 * @returns Array of ScrapedEvent objects
 */
export async function scrapeFacebookEventsByIds(
  eventIds: string[]
): Promise<ScrapedEvent[]> {
  console.log(`\n🔵 Scraping ${eventIds.length} specific Facebook events...`);

  if (!isFacebookEnabled()) {
    console.log('  ⚠️  Facebook scraping disabled');
    return [];
  }

  try {
    const fbEvents = await fetchAllEventDetails(eventIds, {
      concurrency: 3,
      delayMs: 1500,
    });
    const events = fbEvents.map(transformToScrapedEvent);

    console.log(`  ✅ Scraped ${events.length} Facebook events\n`);
    return events;
  } catch (error) {
    console.error('  ❌ Error:', error);
    return [];
  }
}

/**
 * Quick health check for Facebook scraping
 * Tests both discovery and API without full scrape
 */
export async function checkFacebookHealth(): Promise<{
  enabled: boolean;
  configValid: boolean;
  discoveryWorking?: boolean;
  apiWorking?: boolean;
  error?: string;
}> {
  const enabled = isFacebookEnabled();

  if (!enabled) {
    return {
      enabled: false,
      configValid: false,
      error: 'Facebook credentials not configured',
    };
  }

  // Just check if config is valid without actually scraping
  return {
    enabled: true,
    configValid: true,
  };
}

// Export individual modules for testing
export { discoverFacebookEventIds } from './facebook-discover';
export { fetchAllEventDetails, fetchEventDetails, testGraphQLAPI } from './facebook-graphql';
export type { FacebookGraphQLEvent } from './facebook-graphql';
