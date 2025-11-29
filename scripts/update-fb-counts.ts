/**
 * Update Facebook events that are missing interested/going counts
 *
 * Usage: npx tsx scripts/update-fb-counts.ts
 */

import 'dotenv/config';
import * as path from 'path';
import * as os from 'os';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, isNull, and } from 'drizzle-orm';
import { FB_CONFIG, isFacebookEnabled } from '../lib/config/env';
import {
  buildFacebookCookies,
  randomMouseMovements,
  waitForPageLoad,
  checkForBlocking,
  randomDelay,
} from '../lib/scrapers/facebook-stealth';
import { fetchEventDetailsInBrowser } from '../lib/scrapers/facebook-browser-graphql';
import type { BrowserContext, Page } from 'patchright';

const PROFILE_DIR = path.join(os.tmpdir(), 'fb-scraper-profile');

async function main() {
  console.log('='.repeat(70));
  console.log('Update Facebook Events with Interested/Going Counts');
  console.log('='.repeat(70));
  console.log();

  if (!isFacebookEnabled()) {
    console.log('❌ Facebook scraping is not enabled.');
    process.exit(1);
  }

  // Get FB events missing counts
  const eventsToUpdate = await db.select({
    id: events.id,
    url: events.url,
    title: events.title,
  }).from(events).where(
    and(
      eq(events.source, 'FACEBOOK'),
      isNull(events.interestedCount)
    )
  );

  console.log(`Found ${eventsToUpdate.length} Facebook events missing counts`);

  if (eventsToUpdate.length === 0) {
    console.log('Nothing to update!');
    return;
  }

  // Extract event IDs from URLs
  const eventData = eventsToUpdate.map(e => {
    const match = e.url.match(/events\/(\d+)/);
    return {
      dbId: e.id,
      eventId: match ? match[1] : null,
      title: e.title,
    };
  }).filter(e => e.eventId !== null);

  console.log(`Extracted ${eventData.length} event IDs to fetch`);
  console.log();

  // Launch browser
  const { chromium } = await import('patchright');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
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

  try {
    // Inject cookies
    const cookies = buildFacebookCookies({
      c_user: FB_CONFIG.cookies.c_user!,
      xs: FB_CONFIG.cookies.xs!,
      fr: FB_CONFIG.cookies.fr!,
      datr: FB_CONFIG.cookies.datr!,
      sb: FB_CONFIG.cookies.sb!,
    });
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Navigate to events page to establish session
    const eventsUrl = `https://www.facebook.com/events/?discover_tab=CUSTOM&location_id=${FB_CONFIG.locationId}`;
    console.log('Establishing Facebook session...');
    await page.goto(eventsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForPageLoad(page);

    const blockCheck = await checkForBlocking(page);
    if (blockCheck.blocked) {
      throw new Error(`Blocked: ${blockCheck.reason}`);
    }

    await randomMouseMovements(page, 2);
    await randomDelay(1000, 2000);

    console.log('Session established. Fetching counts...\n');

    // Fetch counts for each event
    let updatedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < eventData.length; i++) {
      const { dbId, eventId, title } = eventData[i];

      try {
        const details = await fetchEventDetailsInBrowser(page, eventId!);

        if (details && (details.interestedCount !== null || details.goingCount !== null)) {
          await db.update(events)
            .set({
              interestedCount: details.interestedCount,
              goingCount: details.goingCount,
            })
            .where(eq(events.id, dbId));

          console.log(`[${i + 1}/${eventData.length}] ✅ ${title}`);
          console.log(`    ⭐ ${details.interestedCount ?? 0} interested, ✅ ${details.goingCount ?? 0} going`);
          updatedCount++;
        } else {
          console.log(`[${i + 1}/${eventData.length}] ⚠️  No counts found: ${title}`);
        }
      } catch (err) {
        console.log(`[${i + 1}/${eventData.length}] ❌ Error: ${title}`);
        errorCount++;
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
    }

    console.log();
    console.log('='.repeat(70));
    console.log('RESULTS');
    console.log('='.repeat(70));
    console.log(`  Updated: ${updatedCount}`);
    console.log(`  Errors: ${errorCount}`);

  } finally {
    await context.close();
  }

  console.log('\nDone!');
}

main().catch(console.error);
