/**
 * Facebook Stealth Utilities
 *
 * Human-like behavior patterns and anti-detection utilities
 * for browser automation. These help avoid bot detection.
 *
 * Based on research from:
 * - https://scrapeops.io/playwright-web-scraping-playbook/nodejs-playwright-make-playwright-undetectable/
 * - https://brightdata.com/blog/how-tos/avoid-bot-detection-with-playwright-stealth
 * - https://roundproxies.com/blog/patchright/
 */

import type { Page } from 'patchright';

/**
 * Random delay between min and max milliseconds
 * Simulates human thinking/reaction time
 */
export const randomDelay = (min: number = 500, max: number = 2000): Promise<void> => {
  const delay = Math.random() * (max - min) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
};

/**
 * Short delay for quick actions (100-400ms)
 */
export const shortDelay = (): Promise<void> => randomDelay(100, 400);

/**
 * Medium delay for page loads/transitions (1-3s)
 */
export const mediumDelay = (): Promise<void> => randomDelay(1000, 3000);

/**
 * Long delay for rate limiting (3-6s)
 */
export const longDelay = (): Promise<void> => randomDelay(3000, 6000);

/**
 * Simulate random mouse movements across the page
 * Makes automation less detectable
 */
export async function randomMouseMovements(page: Page, count: number = 3): Promise<void> {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * 800) + 100;
    const y = Math.floor(Math.random() * 600) + 100;
    await page.mouse.move(x, y);
    await shortDelay();
  }
}

/**
 * Simulate natural scrolling behavior
 * Scrolls in random increments with pauses
 */
export async function naturalScroll(page: Page, times: number = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    const scrollAmount = Math.floor(Math.random() * 500) + 200;
    await page.evaluate((amount) => {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount);
    await randomDelay(800, 1500);
  }
}

/**
 * Scroll to bottom of page with human-like pauses
 */
export async function scrollToBottom(page: Page): Promise<void> {
  let previousHeight = 0;
  let currentHeight = await page.evaluate(() => document.body.scrollHeight);

  while (previousHeight < currentHeight) {
    previousHeight = currentHeight;

    // Scroll down in chunks
    await naturalScroll(page, 2);

    // Wait for potential content loading
    await mediumDelay();

    // Check new height
    currentHeight = await page.evaluate(() => document.body.scrollHeight);
  }
}

/**
 * Type text with random delays between keystrokes
 * Simulates human typing speed
 */
export async function typeWithDelay(
  page: Page,
  selector: string,
  text: string
): Promise<void> {
  await page.click(selector);
  await shortDelay();

  for (const char of text) {
    await page.keyboard.type(char);
    // Random delay between 50-200ms per character
    await new Promise((r) => setTimeout(r, Math.random() * 150 + 50));
  }
}

/**
 * Facebook cookie structure for authentication
 */
export interface FacebookCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Build Facebook cookies array for browser context
 */
export function buildFacebookCookies(config: {
  c_user: string;
  xs: string;
  fr: string;
  datr: string;
  sb: string;
}): FacebookCookie[] {
  return [
    {
      name: 'c_user',
      value: config.c_user,
      domain: '.facebook.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'None',
    },
    {
      name: 'xs',
      value: config.xs,
      domain: '.facebook.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
    {
      name: 'fr',
      value: config.fr,
      domain: '.facebook.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
    {
      name: 'datr',
      value: config.datr,
      domain: '.facebook.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
    {
      name: 'sb',
      value: config.sb,
      domain: '.facebook.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None',
    },
  ];
}

/**
 * Wait for page to be fully loaded with network idle
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {
    // If networkidle times out, just wait for domcontentloaded
    await page.waitForLoadState('domcontentloaded');
  }
  // Additional delay for JavaScript rendering
  await mediumDelay();
}

/**
 * Check if we hit a login wall or CAPTCHA
 */
export async function checkForBlocking(page: Page): Promise<{
  blocked: boolean;
  reason?: string;
}> {
  const url = page.url();

  // Check for login redirect
  if (url.includes('/login') || url.includes('checkpoint')) {
    return { blocked: true, reason: 'Redirected to login page' };
  }

  // Check for actual CAPTCHA elements (not just text in JS)
  const hasCaptchaElement = await page.evaluate(() => {
    // Look for actual CAPTCHA iframe or container elements
    const captchaIframe = document.querySelector('iframe[src*="captcha"]');
    const captchaDiv = document.querySelector('[data-testid="captcha"]');
    const recaptcha = document.querySelector('.g-recaptcha, #recaptcha');
    return !!(captchaIframe || captchaDiv || recaptcha);
  });

  if (hasCaptchaElement) {
    return { blocked: true, reason: 'CAPTCHA detected' };
  }

  // Check for login form when we shouldn't have one
  const hasLoginForm = await page.evaluate(() => {
    const loginForm = document.querySelector('form[action*="login"]');
    const loginButton = document.querySelector('[data-testid="royal_login_button"]');
    return !!(loginForm || loginButton);
  });

  if (hasLoginForm) {
    return { blocked: true, reason: 'Login wall detected' };
  }

  return { blocked: false };
}

/**
 * Extract event IDs from page DOM
 * Looks for links containing /events/{numeric_id}
 */
export async function extractEventIdsFromPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ids = new Set<string>();

    // Find all anchor tags with event URLs
    const links = document.querySelectorAll('a[href*="/events/"]');

    links.forEach((link) => {
      const href = (link as HTMLAnchorElement).href;
      // Match pattern: /events/{numeric_id}
      // Exclude: /events/discover, /events/search, etc.
      const match = href.match(/\/events\/(\d{10,})/);
      if (match && match[1]) {
        ids.add(match[1]);
      }
    });

    return Array.from(ids);
  });
}

/**
 * Event data extracted from DOM during discovery
 */
export interface DiscoveredEventData {
  eventId: string;
  title: string;
  dateText: string | null; // Raw date string like "TUE, NOV 26 AT 6:00 PM"
  venue: string | null;
  imageUrl: string | null;
}

/**
 * Extract full event data from page DOM
 * Gets title, date, venue, and image from event cards
 */
export async function extractEventsFromPage(page: Page): Promise<DiscoveredEventData[]> {
  return page.evaluate(() => {
    const events: Array<{
      eventId: string;
      title: string;
      dateText: string | null;
      venue: string | null;
      imageUrl: string | null;
    }> = [];
    const seenIds = new Set<string>();

    // Find all event card links
    const eventLinks = document.querySelectorAll('a[href*="/events/"]');

    eventLinks.forEach((link) => {
      const href = (link as HTMLAnchorElement).href;
      const match = href.match(/\/events\/(\d{10,})/);
      if (!match || !match[1]) return;

      const eventId = match[1];
      if (seenIds.has(eventId)) return;
      seenIds.add(eventId);

      // Try to find the event card container (walk up the DOM)
      let container: Element | null = link;
      for (let i = 0; i < 10; i++) {
        container = container?.parentElement || null;
        if (!container) break;
        // Look for container with multiple text elements (title, date, venue)
        const textContent = container.textContent || '';
        if (textContent.length > 50 && textContent.length < 500) {
          break;
        }
      }

      // Extract title - usually the first prominent text or link text
      let title = '';
      const headingEl = container?.querySelector('span[dir="auto"], h2, h3, [role="heading"]');
      if (headingEl) {
        title = headingEl.textContent?.trim() || '';
      }
      if (!title) {
        // Fallback to link text
        title = link.textContent?.trim() || '';
      }

      // Extract date - look for date patterns
      let dateText: string | null = null;
      const allText = container?.textContent || '';
      // Match patterns like "TUE, NOV 26" or "NOV 26 AT 6:00 PM" or "Tomorrow at 7 PM"
      const dateMatch = allText.match(
        /((?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*,?\s*)?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2}(?:\s+AT\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM))?/i
      ) || allText.match(
        /(?:Today|Tomorrow|This\s+\w+)\s*(?:at\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM))?/i
      );
      if (dateMatch) {
        dateText = dateMatch[0].trim();
      }

      // Extract venue - usually after date, contains location keywords or is the last line
      let venue: string | null = null;
      // Look for spans that might contain venue info
      const spans = container?.querySelectorAll('span');
      spans?.forEach((span) => {
        const text = span.textContent?.trim() || '';
        // Venue is typically a short string that's not the title and not the date
        if (
          text.length > 3 &&
          text.length < 100 &&
          text !== title &&
          !text.match(/^(MON|TUE|WED|THU|FRI|SAT|SUN|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|Today|Tomorrow)/i) &&
          !text.match(/^\d+\s*(interested|going)/i)
        ) {
          // Could be venue
          if (!venue || text.includes('Asheville') || text.includes(',')) {
            venue = text;
          }
        }
      });

      // Extract image URL
      let imageUrl: string | null = null;
      const img = container?.querySelector('img[src*="fbcdn"]');
      if (img) {
        imageUrl = (img as HTMLImageElement).src;
      }

      if (title && title.length > 0) {
        events.push({
          eventId,
          title: title.substring(0, 200), // Limit title length
          dateText,
          venue,
          imageUrl,
        });
      }
    });

    return events;
  });
}

/**
 * Log with timestamp for debugging
 */
export function log(message: string): void {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  console.log(`[${timestamp}] ${message}`);
}
