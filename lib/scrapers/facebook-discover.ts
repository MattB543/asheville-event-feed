/**
 * Facebook Event Discovery Module
 *
 * Uses Patchright (patched Playwright) with anti-detection measures
 * to discover Facebook event IDs from the events discovery page.
 *
 * Key anti-detection features:
 * - Uses real Chrome (not Chromium)
 * - Persistent browser context
 * - Human-like behavior patterns
 * - Authenticated session via cookies
 *
 * NOTE: Patchright is dynamically imported to prevent bundling issues with Next.js/Turbopack.
 * The module contains native dependencies that can't be bundled.
 */

// Types only - these are erased at compile time and don't cause bundling issues
import type { BrowserContext, Page } from 'patchright';
import { FB_CONFIG, isFacebookEnabled } from '../config/env';
import {
  buildFacebookCookies,
  randomMouseMovements,
  naturalScroll,
  scrollToBottom,
  waitForPageLoad,
  checkForBlocking,
  extractEventIdsFromPage,
  randomDelay,
  mediumDelay,
  longDelay,
  log,
} from './facebook-stealth';
import {
  fetchAllEventDetailsInBrowser,
  type FacebookEventDetails,
} from './facebook-browser-graphql';
import * as path from 'path';
import * as os from 'os';

// Persistent profile directory for browser state
const PROFILE_DIR = path.join(os.tmpdir(), 'fb-scraper-profile');

// Facebook events URL with Asheville location
const getEventsUrl = () =>
  `https://www.facebook.com/events/?discover_tab=CUSTOM&location_id=${FB_CONFIG.locationId}`;

/**
 * Discover Facebook event IDs using Patchright browser automation
 *
 * Process:
 * 1. Launch persistent browser context with Chrome
 * 2. Inject Facebook authentication cookies
 * 3. Navigate to events discovery page
 * 4. Scroll to load more events
 * 5. Extract event IDs from DOM
 *
 * @returns Array of discovered event IDs
 */
export async function discoverFacebookEventIds(): Promise<string[]> {
  log('🔍 Starting Facebook event discovery...');

  if (!isFacebookEnabled()) {
    log('⚠️  Facebook scraping is disabled or not configured');
    return [];
  }

  let context: BrowserContext | null = null;

  try {
    // Launch persistent browser context with Chrome
    // Patchright handles most anti-detection automatically
    // Dynamic import to prevent bundling issues with Next.js/Turbopack
    log('  Launching browser with Patchright...');
    const { chromium } = await import('patchright');
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome', // CRITICAL: Use real Chrome, not Chromium
      headless: false, // Better for Facebook - they detect headless well
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: [], // Deny all permissions (notifications, etc.)
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-notifications', // Disable notification prompts
      ],
    });

    // Inject Facebook authentication cookies
    log('  Injecting authentication cookies...');
    const cookies = buildFacebookCookies({
      c_user: FB_CONFIG.cookies.c_user!,
      xs: FB_CONFIG.cookies.xs!,
      fr: FB_CONFIG.cookies.fr!,
      datr: FB_CONFIG.cookies.datr!,
      sb: FB_CONFIG.cookies.sb!,
    });
    await context.addCookies(cookies);

    // Create new page
    const page = await context.newPage();

    // Dismiss any dialogs (notifications, alerts, etc.)
    page.on('dialog', async (dialog) => {
      log(`  Dismissing dialog: ${dialog.type()}`);
      await dialog.dismiss();
    });

    // Navigate to events page
    const eventsUrl = getEventsUrl();
    log(`  Navigating to: ${eventsUrl}`);
    await page.goto(eventsUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for page to fully load
    await waitForPageLoad(page);

    // Check if we hit a login wall
    const blockCheck = await checkForBlocking(page);
    if (blockCheck.blocked) {
      log(`  ❌ Blocked: ${blockCheck.reason}`);
      throw new Error(`Facebook blocked access: ${blockCheck.reason}`);
    }

    // Simulate human behavior - random mouse movements
    log('  Simulating human behavior...');
    await randomMouseMovements(page, 2);
    await randomDelay(1000, 2000);

    // Extract initial event IDs
    let eventIds = await extractEventIdsFromPage(page);
    log(`  Found ${eventIds.length} events initially`);

    // Scroll to load more events (Facebook uses infinite scroll)
    log('  Scrolling to load more events...');
    for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
      await naturalScroll(page, 2);
      await mediumDelay();

      // Extract event IDs again
      const newIds = await extractEventIdsFromPage(page);
      const newCount = newIds.length - eventIds.length;

      if (newCount > 0) {
        log(`  Scroll ${scrollAttempt + 1}: Found ${newCount} new events`);
        eventIds = newIds;
      } else {
        log(`  Scroll ${scrollAttempt + 1}: No new events found`);
        // If no new events after 2 consecutive scrolls, stop
        if (scrollAttempt > 0) break;
      }

      // Rate limiting
      await longDelay();
    }

    log(`  ✅ Discovered ${eventIds.length} unique event IDs`);
    return eventIds;
  } catch (error) {
    log(`  ❌ Error during discovery: ${error}`);

    if (error instanceof Error) {
      // Check for specific error types
      if (error.message.includes('blocked') || error.message.includes('login')) {
        log('  🔑 Authentication may have expired. Please refresh tokens.');
      }
    }

    throw error;
  } finally {
    // Clean up browser context
    if (context) {
      log('  Closing browser...');
      await context.close();
    }
  }
}

/**
 * Test discovery with a quick run (fewer scrolls)
 * Useful for testing without full scrape
 */
export async function testDiscovery(): Promise<{
  success: boolean;
  eventIds: string[];
  error?: string;
}> {
  try {
    const eventIds = await discoverFacebookEventIds();
    return {
      success: true,
      eventIds,
    };
  } catch (error) {
    return {
      success: false,
      eventIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover and fetch Facebook events in a single browser session
 *
 * This combines discovery and GraphQL fetching in one browser session,
 * which ensures fresh tokens are used for all API calls.
 *
 * @param options Configuration options
 * @returns Array of Facebook event details
 */
export async function discoverAndFetchFacebookEvents(options: {
  maxScrolls?: number;
  targetEvents?: number;
  onProgress?: (completed: number, total: number) => void;
} = {}): Promise<FacebookEventDetails[]> {
  const { maxScrolls = 10, targetEvents = 30, onProgress } = options;

  log('🔍 Starting Facebook event discovery and fetch...');

  if (!isFacebookEnabled()) {
    log('⚠️  Facebook scraping is disabled or not configured');
    return [];
  }

  let context: BrowserContext | null = null;

  try {
    // Dynamic import to prevent bundling issues with Next.js/Turbopack
    log('  Launching browser with Patchright...');
    const { chromium } = await import('patchright');
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: [],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--no-first-run',
        '--disable-default-apps',
        '--disable-notifications',
      ],
    });

    log('  Injecting authentication cookies...');
    const cookies = buildFacebookCookies({
      c_user: FB_CONFIG.cookies.c_user!,
      xs: FB_CONFIG.cookies.xs!,
      fr: FB_CONFIG.cookies.fr!,
      datr: FB_CONFIG.cookies.datr!,
      sb: FB_CONFIG.cookies.sb!,
    });
    await context.addCookies(cookies);

    const page = await context.newPage();

    page.on('dialog', async (dialog) => {
      log(`  Dismissing dialog: ${dialog.type()}`);
      await dialog.dismiss();
    });

    const eventsUrl = getEventsUrl();
    log(`  Navigating to: ${eventsUrl}`);
    await page.goto(eventsUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await waitForPageLoad(page);

    const blockCheck = await checkForBlocking(page);
    if (blockCheck.blocked) {
      log(`  ❌ Blocked: ${blockCheck.reason}`);
      throw new Error(`Facebook blocked access: ${blockCheck.reason}`);
    }

    log('  Simulating human behavior...');
    await randomMouseMovements(page, 2);
    await randomDelay(1000, 2000);

    // Step 1: Discover event IDs
    let eventIds = await extractEventIdsFromPage(page);
    log(`  Found ${eventIds.length} events initially`);

    // Scroll to load more events
    log(`  Scrolling to discover ${targetEvents}+ events...`);
    let noNewEventsCount = 0;

    for (let scrollAttempt = 0; scrollAttempt < maxScrolls && eventIds.length < targetEvents && noNewEventsCount < 3; scrollAttempt++) {
      await naturalScroll(page, 2);
      await mediumDelay();

      const newIds = await extractEventIdsFromPage(page);
      const newCount = newIds.length - eventIds.length;

      if (newCount > 0) {
        log(`  Scroll ${scrollAttempt + 1}: Found ${newCount} new events (total: ${newIds.length})`);
        eventIds = newIds;
        noNewEventsCount = 0;
      } else {
        noNewEventsCount++;
      }

      await longDelay();
    }

    log(`  ✅ Discovered ${eventIds.length} unique event IDs`);

    if (eventIds.length === 0) {
      return [];
    }

    // Step 2: Fetch event details using browser-based GraphQL
    log('  Fetching event details via browser GraphQL...');
    const events = await fetchAllEventDetailsInBrowser(page, eventIds, {
      concurrency: 3,
      delayMs: 300,
      onProgress,
    });

    log(`  ✅ Fetched ${events.length} events with full details`);
    return events;
  } catch (error) {
    log(`  ❌ Error: ${error}`);
    throw error;
  } finally {
    if (context) {
      log('  Closing browser...');
      await context.close();
    }
  }
}

// Re-export types
export type { FacebookEventDetails } from './facebook-browser-graphql';
