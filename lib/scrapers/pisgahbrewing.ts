/**
 * Pisgah Brewing Scraper - rhp-events plugin
 *
 * Venue: Pisgah Brewing Company, 2948 US-70, Black Mountain, NC 28711
 * Two stages (Taproom Stage, Outdoor Stage) share the same address.
 *
 * Black Mountain is ~20 min east of Asheville and is already a recognized
 * city in lib/utils/geo.ts, so these events survive the non-NC filter.
 *
 * @see lib/scrapers/rhp.ts for the shared parsing logic and its caveats.
 */

import { type ScrapedEvent } from './types';
import { scrapeRhpVenue, type RhpVenueConfig } from './rhp';

const CONFIG: RhpVenueConfig = {
  source: 'PISGAH_BREWING',
  sourceIdPrefix: 'pisgah-',
  logLabel: 'Pisgah',
  listingUrl: 'https://pisgahbrewing.com/events/',
  feedUrl: 'https://pisgahbrewing.com/events/feed/',
  defaultVenueName: 'Pisgah Brewing Company',
  defaultAddress: 'Pisgah Brewing Company, 2948 US-70, Black Mountain, NC',
  zip: '28711',
};

export async function scrapePisgahBrewing(): Promise<ScrapedEvent[]> {
  return scrapeRhpVenue(CONFIG);
}
