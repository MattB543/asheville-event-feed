/**
 * 185 King Street Scraper - rhp-events plugin
 *
 * Venue: 185 King Street, Brevard, NC 28712
 *
 * Brevard is ~35 min south-west of Asheville — outside the city proper but
 * within the WNC catchment. Kept as its own EventSource specifically so the
 * whole venue can be dropped from the feed with a one-line filter if it ever
 * reads as off-brand.
 *
 * This site emits no `a.venueLink` (single-venue site), so every event falls
 * back to the configured default venue name and address.
 *
 * @see lib/scrapers/rhp.ts for the shared parsing logic and its caveats.
 */

import { type ScrapedEvent } from './types';
import { scrapeRhpVenue, type RhpVenueConfig } from './rhp';

const CONFIG: RhpVenueConfig = {
  source: 'KING_STREET',
  sourceIdPrefix: 'ks-',
  logLabel: '185 King',
  listingUrl: 'https://185kingst.com/events/',
  feedUrl: 'https://185kingst.com/events/feed/',
  defaultVenueName: '185 King Street',
  defaultAddress: '185 King Street, Brevard, NC',
  zip: '28712',
};

export async function scrapeKingStreet(): Promise<ScrapedEvent[]> {
  return scrapeRhpVenue(CONFIG);
}
