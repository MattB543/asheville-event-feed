/**
 * Debug script to test Facebook scraping with interested/going counts
 *
 * Usage: npx tsx scripts/debug-facebook-data.ts
 */

import 'dotenv/config';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { FB_CONFIG, isFacebookEnabled } from '../lib/config/env';
import {
  buildFacebookCookies,
  randomMouseMovements,
  waitForPageLoad,
  checkForBlocking,
  extractEventIdsFromPage,
  randomDelay,
} from '../lib/scrapers/facebook-stealth';
import type { Page } from 'patchright';

const PROFILE_DIR = path.join(os.tmpdir(), 'fb-scraper-profile');

// Custom fetch that returns raw data for inspection
async function fetchEventDetailsWithRaw(page: Page, eventId: string) {
  return await page.evaluate(async (eventId: string) => {
    // Extract tokens from page
    let fb_dtsg = '', lsd = '', jazoest = '', rev = '', userId = '';

    const scripts = document.querySelectorAll('script');
    const html = document.documentElement.innerHTML;

    for (const script of scripts) {
      const text = script.textContent || '';
      const dtsgMatch = text.match(/\["DTSGInitData",\[\],\{"token":"([^"]+)"/);
      if (dtsgMatch && !fb_dtsg) fb_dtsg = dtsgMatch[1];
      const lsdMatch = text.match(/\["LSD",\[\],\{"token":"([^"]+)"/);
      if (lsdMatch && !lsd) lsd = lsdMatch[1];
      const revMatch = text.match(/"server_revision":(\d+)/);
      if (revMatch && !rev) rev = revMatch[1];
      const userMatch = text.match(/"USER_ID":"(\d+)"/);
      if (userMatch && !userId) userId = userMatch[1];
    }

    const jazoestMatch = html.match(/"jazoest":"(\d+)"/) || html.match(/jazoest=(\d+)/);
    if (jazoestMatch) jazoest = jazoestMatch[1];

    if (!fb_dtsg || !lsd) {
      return { error: 'Could not extract tokens' };
    }

    // Fetch about data
    const aboutParams = new URLSearchParams();
    aboutParams.append('av', userId);
    aboutParams.append('__user', userId);
    aboutParams.append('__a', '1');
    aboutParams.append('__rev', rev);
    aboutParams.append('__comet_req', '15');
    aboutParams.append('fb_dtsg', fb_dtsg);
    aboutParams.append('jazoest', jazoest);
    aboutParams.append('lsd', lsd);
    aboutParams.append('fb_api_caller_class', 'RelayModern');
    aboutParams.append('fb_api_req_friendly_name', 'PublicEventCometAboutRootQuery');
    aboutParams.append('variables', JSON.stringify({ eventID: eventId, isLoggedOut: false, scale: 1 }));
    aboutParams.append('doc_id', '24522924877384967');

    const aboutRes = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-FB-LSD': lsd },
      body: aboutParams.toString(),
      credentials: 'include',
    });

    const aboutText = await aboutRes.text();

    // Parse and look for counts
    const aboutLines = aboutText.split('\n').filter(l => l.trim());
    let foundCounts = false;
    let interestedCount = null;
    let goingCount = null;
    const allDataKeys: string[] = [];

    for (const line of aboutLines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed?.data) {
          allDataKeys.push(...Object.keys(parsed.data));
        }
        // can_view_friends_card is inside data.event, not data directly
        if (parsed?.data?.event?.can_view_friends_card?.event) {
          const fc = parsed.data.event.can_view_friends_card.event;
          foundCounts = true;
          interestedCount = fc.event_connected_users_maybe?.count ?? fc.unified_associates_count ?? null;
          goingCount = fc.event_connected_users_going?.count ?? fc.unified_member_count ?? null;
        }
      } catch {}
    }

    return {
      eventId,
      foundCounts,
      interestedCount,
      goingCount,
      dataKeys: [...new Set(allDataKeys)],
      rawLinesCount: aboutLines.length,
      rawResponse: aboutText.slice(0, 2000), // First 2000 chars for inspection
    };
  }, eventId);
}

async function main() {
  console.log('='.repeat(70));
  console.log('Debug Facebook Response Structure');
  console.log('='.repeat(70));
  console.log();

  if (!isFacebookEnabled()) {
    console.log('❌ Facebook scraping is not enabled.');
    process.exit(1);
  }

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
    const cookies = buildFacebookCookies({
      c_user: FB_CONFIG.cookies.c_user!,
      xs: FB_CONFIG.cookies.xs!,
      fr: FB_CONFIG.cookies.fr!,
      datr: FB_CONFIG.cookies.datr!,
      sb: FB_CONFIG.cookies.sb!,
    });
    await context.addCookies(cookies);

    const page = await context.newPage();

    const eventsUrl = `https://www.facebook.com/events/?discover_tab=CUSTOM&location_id=${FB_CONFIG.locationId}`;
    console.log(`Navigating to: ${eventsUrl}`);
    await page.goto(eventsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForPageLoad(page);

    const blockCheck = await checkForBlocking(page);
    if (blockCheck.blocked) {
      throw new Error(`Blocked: ${blockCheck.reason}`);
    }

    await randomMouseMovements(page, 2);
    await randomDelay(1000, 2000);

    const eventIds = await extractEventIdsFromPage(page);
    if (eventIds.length === 0) {
      throw new Error('No events found');
    }

    console.log(`\nFound ${eventIds.length} events. Testing first 3...\n`);

    for (const eventId of eventIds.slice(0, 3)) {
      console.log('-'.repeat(50));
      console.log(`Event ID: ${eventId}`);

      const result = await fetchEventDetailsWithRaw(page, eventId);

      if ('error' in result) {
        console.log(`  Error: ${result.error}`);
      } else {
        console.log(`  Raw lines: ${result.rawLinesCount}`);
        console.log(`  All data keys found: ${result.dataKeys.join(', ')}`);
        console.log(`  Found counts: ${result.foundCounts}`);
        console.log(`  Interested: ${result.interestedCount}`);
        console.log(`  Going: ${result.goingCount}`);
        console.log(`  Raw response preview:`);
        console.log(result.rawResponse);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n' + '='.repeat(70));
    console.log('Done!');

  } finally {
    await context.close();
  }
}

main().catch(console.error);
