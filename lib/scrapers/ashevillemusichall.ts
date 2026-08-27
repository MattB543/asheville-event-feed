/**
 * Asheville Music Hall Scraper - rhp-events plugin
 *
 * Covers two rooms in the same downtown block:
 *   - Asheville Music Hall, 31 Patton Ave
 *   - The One Stop, 55 College St (adjoining bar/venue, separate address)
 *
 * NOTE: this is the one rhp-events site that does NOT emit "Month YYYY"
 * separator headings, so the shared parser falls back to inferring each
 * card's year from the listing's chronological order.
 *
 * @see lib/scrapers/rhp.ts for the shared parsing logic and its caveats.
 */

import { type ScrapedEvent } from './types';
import { scrapeRhpVenue, type RhpVenueConfig } from './rhp';

const CONFIG: RhpVenueConfig = {
  source: 'ASHEVILLE_MUSIC_HALL',
  sourceIdPrefix: 'amh-',
  logLabel: 'AMH',
  listingUrl: 'https://ashevillemusichall.com/all-shows/',
  feedUrl: 'https://ashevillemusichall.com/all-shows/feed/',
  defaultVenueName: 'Asheville Music Hall',
  defaultAddress: 'Asheville Music Hall, 31 Patton Ave, Asheville, NC',
  subVenueAddresses: {
    'The One Stop': 'The One Stop, 55 College St, Asheville, NC',
  },
  zip: '28801',
};

export async function scrapeAshevilleMusicHall(): Promise<ScrapedEvent[]> {
  return scrapeRhpVenue(CONFIG);
}
