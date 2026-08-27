/**
 * Shared scraper for venues running the `rhp-events` WordPress plugin
 * (Rock House Partners — the Etix-affiliated venue-site plugin).
 *
 * These venues sell through Etix, but etix.com itself sits behind an AWS WAF
 * bot-detection challenge. The plugin renders the venue's complete upcoming
 * calendar server-side on the venue's own (unprotected) domain, so we read it
 * there instead: one request per venue for the whole listing.
 *
 * Data Sources:
 *   - Event listing: the venue's calendar page (page 1 only — see below)
 *   - Descriptions:  the same page's WordPress RSS feed, joined on event URL
 *
 * Two layout variants exist — `--grid` and `--list`. Field extraction is
 * layout-independent; every selector below is tried in both forms.
 *
 * Gotchas this module exists to encapsulate:
 *   - Some sites render EVERY event twice (desktop + mobile blocks), so cards
 *     are de-duplicated by canonical event URL. Do NOT key on the Etix
 *     performance id: some cards have no Etix link at all.
 *   - Cards print "Wed, Aug 26" with NO year. Most sites emit "August 2026"
 *     separator headings; where they don't, the year is inferred from the
 *     listing's chronological order.
 *   - WordPress archive pagination is a trap: page 2 is ~98% duplicates of
 *     page 1 plus PAST events. Page 1 already holds the full upcoming window.
 *
 * Debug Mode:
 *   Set DEBUG_DIR env var to save raw listing HTML per venue.
 */

import * as cheerio from 'cheerio';
import { type ScrapedEvent, type EventSource } from './types';
import { debugSave, fetchEventData } from './base';
import { decodeHtmlEntities, extractTimeFromText, stripHtml } from '../utils/parsers';
import { getTodayStringEastern, parseAsEastern } from '../utils/timezone';
import { isNonNCEvent } from '../utils/geo';

/** How far ahead a listing may legitimately reach, for year inference. */
const MAX_HORIZON_MONTHS = 18;

/** Fail the whole venue if more than this fraction of cards fail to parse. */
const MAX_MALFORMED_RATIO = 0.25;

/** ...but only once this many cards are actually affected, so one venue typo
 *  can't take out a small listing. */
const MIN_MISMATCHES_TO_FAIL = 5;

export interface RhpVenueConfig {
  source: EventSource;
  /** Prefix for sourceId, e.g. 'amh-' */
  sourceIdPrefix: string;
  /** Short label for log lines, e.g. 'AMH' */
  logLabel: string;
  /** Calendar listing URL. Page 1 only — never paginate. */
  listingUrl: string;
  /** WP RSS feed for descriptions. Omit to skip enrichment entirely. */
  feedUrl?: string;
  /** Venue name used when a card carries no sub-venue link. */
  defaultVenueName: string;
  /** "Venue, Street, City, State" used when no sub-venue override applies. */
  defaultAddress: string;
  /** Partial override — only for sub-venues in a physically different building. */
  subVenueAddresses?: Record<string, string>;
  zip: string;
  /** Sub-venue-specific zips, where they differ from `zip`. */
  subVenueZips?: Record<string, string>;
  /** Cards whose title matches any of these are dropped (parking passes etc.). */
  excludeTitlePatterns?: RegExp[];
}

const MONTHS: Record<string, number> = {
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

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** A card as scraped off the page, before its year is known. */
interface RawCard {
  url: string;
  title: string;
  month: number;
  day: number;
  /** Weekday printed on the card, used only as a checksum. */
  weekday?: number;
  /** Year taken from the nearest preceding "Month YYYY" heading, if any. */
  headingYear?: number;
  timeText?: string;
  costText?: string;
  isFree: boolean;
  venueName?: string;
  imageUrl?: string;
  ageRestriction?: string;
  support?: string;
  etixId?: string;
}

function text(el: cheerio.Cheerio<never>, selector: string): string {
  const found = el.find(selector).first();
  return found.length ? found.text().replace(/\s+/g, ' ').trim() : '';
}

/**
 * Normalize an event URL for use as a de-duplication key and as the stored
 * `url`. Strips tracking params and the trailing slash so the desktop and
 * mobile renders of the same event collapse onto one entry.
 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

/** Slug used for sourceId, derived from the event page URL path. */
function slugFromUrl(url: string): string {
  const parts = normalizeUrl(url)
    .replace(/^https?:\/\/[^/]+/, '')
    .split('/')
    .filter(Boolean);
  // Event URLs look like /event/{slug}/{venue-slug}[/{city}]
  const idx = parts.indexOf('event');
  return (
    idx >= 0 && parts[idx + 1] ? parts[idx + 1] : parts[parts.length - 1] || ''
  ).toLowerCase();
}

/**
 * Parse "Wed, Aug 26" / "Aug 26" into weekday + month + day.
 */
function parseCardDate(raw: string): { month: number; day: number; weekday?: number } | null {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const weekdayMatch = cleaned.match(/^([A-Za-z]{3})[a-z]*,/);
  const monthDay = cleaned.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b/);
  if (!monthDay) return null;

  const month = MONTHS[monthDay[1].slice(0, 3).toLowerCase()];
  const day = parseInt(monthDay[2], 10);
  if (month === undefined || !Number.isFinite(day) || day < 1 || day > 31) return null;

  const weekday = weekdayMatch ? WEEKDAYS[weekdayMatch[1].slice(0, 3).toLowerCase()] : undefined;
  return { month, day, weekday };
}

/**
 * Build a YYYY-MM-DD string, verifying the components round-trip. Guards
 * against Feb 29 in a non-leap year silently becoming Mar 1.
 */
function toDateString(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Resolve each card's calendar date.
 *
 * Preferred signal is the "Month YYYY" heading the plugin emits above each
 * month's block. Where a site omits those (Asheville Music Hall), fall back to
 * the listing's chronological ordering: each card takes the earliest valid
 * date on or after the previous one.
 *
 * The printed weekday is only ever a checksum. A mismatch is logged but the
 * header/monotonic date is kept — trusting the weekday instead would let a
 * single typo push an event a whole year out.
 */
function resolveDates(cards: RawCard[], label: string): Array<RawCard & { dateStr: string }> {
  const today = getTodayStringEastern();
  const [todayYear] = today.split('-').map(Number);
  const horizon = new Date(Date.UTC(todayYear, new Date().getUTCMonth() + MAX_HORIZON_MONTHS, 1));

  const resolved: Array<RawCard & { dateStr: string }> = [];
  let previous = today;
  let weekdayMismatches = 0;

  for (const card of cards) {
    let dateStr: string | null = null;

    if (card.headingYear !== undefined) {
      dateStr = toDateString(card.headingYear, card.month, card.day);
    } else {
      // Monotonic fallback: earliest valid date at or after the previous card.
      for (let bump = 0; bump <= 2; bump++) {
        const candidate = toDateString(Number(previous.slice(0, 4)) + bump, card.month, card.day);
        if (candidate && candidate >= previous) {
          dateStr = candidate;
          break;
        }
      }
    }

    if (!dateStr) {
      console.warn(`[${label}] Skipping "${card.title}": unresolvable date`);
      continue;
    }
    if (dateStr < today) {
      // Past event (the archive occasionally leaks one in) — drop silently.
      continue;
    }
    if (new Date(`${dateStr}T00:00:00Z`) > horizon) {
      console.warn(
        `[${label}] Skipping "${card.title}": ${dateStr} beyond ${MAX_HORIZON_MONTHS}mo horizon`
      );
      continue;
    }

    if (card.weekday !== undefined) {
      const [y, m, d] = dateStr.split('-').map(Number);
      if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== card.weekday) {
        weekdayMismatches++;
        console.warn(`[${label}] Weekday mismatch on "${card.title}" (${dateStr}) — keeping date`);
      }
    }

    previous = dateStr;
    resolved.push({ ...card, dateStr });
  }

  // A structural break shows up as many mismatches at once; a venue typo shows
  // up as one. Require both an absolute floor and a high ratio before failing,
  // so a single bad weekday can't take out a small listing.
  if (
    weekdayMismatches >= MIN_MISMATCHES_TO_FAIL &&
    weekdayMismatches / cards.length > MAX_MALFORMED_RATIO
  ) {
    throw new Error(
      `[${label}] ${weekdayMismatches}/${cards.length} weekday mismatches — listing markup looks wrong`
    );
  }

  return resolved;
}

/**
 * Normalize a displayed cost string into the repo's price convention.
 * The plugin prints values like "$19.95" or "$14.05 to $16.11".
 *
 * NOTE: deliberately does not use formatPrice() — that helper parseFloat()s
 * its input and returns "Unknown" for a "$"-prefixed string.
 */
function normalizePrice(costText: string | undefined, isFree: boolean): string {
  const cost = (costText || '').replace(/\s+/g, ' ').trim();
  if (cost) {
    if (/^(free|no cover|donation)/i.test(cost)) return 'Free';
    const normalized = cost.replace(/\s+to\s+/i, ' - ');
    if (/\d/.test(normalized)) return normalized;
  }
  return isFree ? 'Free' : 'Unknown';
}

/** Extract the "Doors: 7 pm"-only case that extractTimeFromText doesn't cover. */
function extractDoorsOnlyTime(timeText: string): { hour: number; minute: number } | null {
  const m = timeText.match(/doors[:\s]+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (hour === 12) hour = /^p/i.test(m[3]) ? 12 : 0;
  else if (/^p/i.test(m[3])) hour += 12;
  return { hour, minute };
}

/** Pull the RSS feed and map normalized event URL -> plain-text description. */
async function fetchDescriptions(feedUrl: string, label: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetchEventData(feedUrl, { cache: 'no-store' }, { maxRetries: 2 }, label);
    const xml = await res.text();

    for (const item of xml.split('<item>').slice(1)) {
      const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim();
      const desc = item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '';
      if (!link) continue;
      // stripHtml() already decodes entities internally.
      const clean = stripHtml(desc.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')).trim();
      if (clean.length > 20) map.set(normalizeUrl(link), clean);
    }
    console.log(`[${label}] RSS: ${map.size} descriptions`);
  } catch (error) {
    // Enrichment only — never fail the scrape over a missing feed.
    console.warn(
      `[${label}] RSS enrichment unavailable:`,
      error instanceof Error ? error.message : error
    );
  }
  return map;
}

/** Parse every event card out of a listing page. */
function parseCards(html: string): RawCard[] {
  const $ = cheerio.load(html);
  const cards: RawCard[] = [];

  // "August 2026" separator headings carry the year. Walk the document in
  // order so each card can adopt the most recent heading seen before it.
  const monthHeadingRe = /^\s*([A-Za-z]+)\s+(20\d{2})\s*$/;
  let currentYear: number | undefined;

  // Single ordered walk over month headings and cards, so each card can adopt
  // the most recent heading that appeared before it.
  const ordered = $('*').filter((_, el) => {
    const $el = $(el);
    if ($el.hasClass('rhpSingleEvent')) return true;
    if ($el.children().length > 0) return false;
    const m = $el.text().match(monthHeadingRe);
    return !!m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined;
  });

  ordered.each((_, el) => {
    const $el = $(el);

    if (!$el.hasClass('rhpSingleEvent')) {
      const m = $el.text().trim().match(monthHeadingRe);
      if (m) currentYear = parseInt(m[2], 10);
      return;
    }

    const card = $el as unknown as cheerio.Cheerio<never>;

    const href =
      card.find('a#eventTitle[href], a.url[href]').first().attr('href') ||
      card.find('a[rel="bookmark"][href]').first().attr('href');
    if (!href) return;

    const title = decodeHtmlEntities(
      text(card, 'h2[class*="rhp-event__title"], h2, #eventTitle') || ''
    );
    if (!title) return;

    const dateRaw = text(card, '#eventDate, [id="eventDate"], [class*="eventMonth"]');
    const parsedDate = parseCardDate(dateRaw);
    if (!parsedDate) return;

    const etixHref = card.find('a[href*="etix.com/ticket/p/"]').first().attr('href') || '';
    const ctaClasses = card.find('[class*="rhp-event-cta"]').attr('class') || '';

    cards.push({
      url: normalizeUrl(href),
      title,
      month: parsedDate.month,
      day: parsedDate.day,
      weekday: parsedDate.weekday,
      headingYear: currentYear,
      timeText: text(card, '[class*="eventDoorStartDate"]'),
      costText: text(card, '[class*="rhp-event__cost-text"]'),
      isFree: /\bfree\b/i.test(ctaClasses),
      venueName: decodeHtmlEntities(text(card, 'a.venueLink, [class*="rhpVenueContent"]')),
      imageUrl: card.find('[class*="rhp-events-event-image"] img[src]').first().attr('src'),
      ageRestriction: text(card, '[class*="eventAgeRestriction"]'),
      support: decodeHtmlEntities(text(card, '#evSubHead, [class*="eventSubHeader"]')),
      etixId: etixHref.match(/etix\.com\/ticket\/p\/(\d+)/)?.[1],
    });
  });

  return cards;
}

/**
 * Scrape one rhp-events venue.
 *
 * Throws (rather than returning []) on fetch failure or a structurally
 * unparseable page, so the cron records a genuine failure instead of a
 * silent zero.
 */
export async function scrapeRhpVenue(cfg: RhpVenueConfig): Promise<ScrapedEvent[]> {
  const label = cfg.logLabel;
  console.log(`[${label}] Fetching ${cfg.listingUrl}...`);

  const response = await fetchEventData(
    cfg.listingUrl,
    { cache: 'no-store' },
    { maxRetries: 3, baseDelay: 1000 },
    label
  );
  const html = await response.text();
  await debugSave(`${cfg.source.toLowerCase()}-listing.html`, html, { label });

  const rawCards = parseCards(html);
  if (rawCards.length === 0) {
    throw new Error(`[${label}] No event cards found — listing markup may have changed`);
  }

  // Collapse the duplicate desktop/mobile renders some sites emit.
  const byUrl = new Map<string, RawCard>();
  for (const card of rawCards) {
    const existing = byUrl.get(card.url);
    // Prefer whichever copy carries the most detail.
    if (
      !existing ||
      (!existing.costText && card.costText) ||
      (!existing.venueName && card.venueName)
    ) {
      byUrl.set(card.url, { ...existing, ...card });
    }
  }
  const unique = [...byUrl.values()];
  console.log(`[${label}] ${rawCards.length} cards -> ${unique.length} unique events`);

  const dated = resolveDates(unique, label);
  const descriptions = cfg.feedUrl ? await fetchDescriptions(cfg.feedUrl, label) : new Map();

  const results: ScrapedEvent[] = [];
  for (const card of dated) {
    if (cfg.excludeTitlePatterns?.some((re) => re.test(card.title))) continue;

    // Time: reuse the shared extractor (it already prefers "Show:" over
    // "Doors:"), then fall back to a doors-only reading.
    let timeStr = '19:00:00';
    let timeUnknown = true;
    const extracted = card.timeText ? extractTimeFromText(card.timeText) : null;
    const doorsOnly = !extracted && card.timeText ? extractDoorsOnlyTime(card.timeText) : null;
    const time = extracted ?? doorsOnly;
    if (time) {
      timeStr = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}:00`;
      timeUnknown = false;
    }

    const startDate = parseAsEastern(card.dateStr, timeStr);
    if (isNaN(startDate.getTime())) {
      console.warn(`[${label}] Skipping "${card.title}": invalid date ${card.dateStr} ${timeStr}`);
      continue;
    }

    const venueName = card.venueName || cfg.defaultVenueName;
    const location = cfg.subVenueAddresses?.[venueName] || cfg.defaultAddress;
    const zip = cfg.subVenueZips?.[venueName] || cfg.zip;

    const descriptionParts = [
      descriptions.get(card.url),
      card.support ? `With ${card.support}.` : '',
      card.ageRestriction,
    ].filter(Boolean);

    results.push({
      sourceId: `${cfg.sourceIdPrefix}${slugFromUrl(card.url)}`,
      source: cfg.source,
      title: card.title,
      description: descriptionParts.length ? descriptionParts.join(' ').trim() : undefined,
      startDate,
      location,
      zip,
      organizer: venueName,
      price: normalizePrice(card.costText, card.isFree),
      url: card.url,
      imageUrl: card.imageUrl,
      timeUnknown,
    });
  }

  const ncEvents = results.filter((ev) => !isNonNCEvent(ev.title, ev.location));
  console.log(
    `[${label}] ${ncEvents.length} events (${ncEvents.filter((e) => e.description).length} w/ description, ` +
      `${ncEvents.filter((e) => e.price !== 'Unknown').length} w/ price)`
  );

  return ncEvents;
}
