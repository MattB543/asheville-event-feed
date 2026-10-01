/**
 * Asheville Watchdog - nonprofit investigative newsroom covering Asheville and
 * Buncombe County (Newspack, hosted by Automattic).
 *
 * The WP REST API carries the full body, which the Watchdog gives away: its
 * republishing policy lets anyone run a story free with credit, so there is no
 * paywall to respect. The RSS feed has the body too but no image, so we use the
 * API (see ./shared/newspack.ts for the byline quirk).
 *
 * Every story ends with the same two paragraphs - an invitation to comment on
 * social media and the nonprofit tagline - which we drop from contentText.
 *
 * No geography filter: nearly everything is Asheville/Buncombe, and the rest is
 * opinion on the district's congressman and statewide races.
 */

import type { NewsSourceModule } from '../types';
import { fetchNewspackPosts, newspackToArticle } from './shared/newspack';

const KEY = 'ASHEVILLE_WATCHDOG';
const SITE = 'https://avlwatchdog.org';

/** About 1.5 stories a day, so 20 posts reaches back roughly two weeks. */
const PER_PAGE = '20';

const BOILERPLATE = [
  /^Asheville Watchdog welcomes thoughtful reader comments/i,
  /^Asheville Watchdog is a nonprofit news team/i,
];

function stripBoilerplate(text: string | undefined): string | undefined {
  const kept = text
    ?.split('\n\n')
    .filter((para) => !BOILERPLATE.some((re) => re.test(para)))
    .join('\n\n');
  return kept || undefined;
}

const avlWatchdog: NewsSourceModule = {
  key: KEY,
  name: 'Asheville Watchdog',
  homepage: SITE,
  kind: 'outlet',
  method: 'wp-json',
  async scrape() {
    const posts = await fetchNewspackPosts(SITE, 'AvlWatchdog', { per_page: PER_PAGE });
    return posts.map((post) => newspackToArticle(KEY, post, stripBoilerplate));
  },
};

export default avlWatchdog;
