/**
 * Carolina Public Press - Asheville-based nonprofit investigative newsroom
 * (Newspack, hosted by Automattic; see ./shared/newspack.ts).
 *
 * Statewide in scope. The county categories that could have picked out
 * Buncombe stories stopped being applied in 2021, so we keep only stories that
 * name a Buncombe place anywhere in the title, dek or body - about 8 in 20,
 * roughly two a week: Asheville's own stories plus statewide ones where
 * Buncombe or Mission Hospital figures (hospital beds, Flock, Helene recovery).
 *
 * Stories are published under CC BY-ND 4.0 (the site's "Republish This Story"
 * box), and the WP REST API carries the full body.
 */

import type { NewsSourceModule } from '../types';
import { mentionsBuncombe } from './shared/buncombe';
import { fetchNewspackPosts, newspackToArticle } from './shared/newspack';

const KEY = 'CAROLINA_PUBLIC_PRESS';
const SITE = 'https://carolinapublicpress.org';

/** Under one story a day, so 20 posts reaches back about a month. */
const PER_PAGE = '20';

/** In-body newsletter plug: "[ Subscribe for FREE to Carolina Public Press' ... newsletters. ]" */
const NEWSLETTER_PLUG = /^\[\s*Subscribe\b.*\]$/i;

function stripPlugs(text: string | undefined): string | undefined {
  const kept = text
    ?.split('\n\n')
    .filter((para) => !NEWSLETTER_PLUG.test(para))
    .join('\n\n');
  return kept || undefined;
}

const carolinaPublicPress: NewsSourceModule = {
  key: KEY,
  name: 'Carolina Public Press',
  homepage: SITE,
  kind: 'outlet',
  method: 'wp-json',
  async scrape() {
    const posts = await fetchNewspackPosts(SITE, 'CarolinaPublicPress', { per_page: PER_PAGE });
    return posts
      .map((post) => newspackToArticle(KEY, post, stripPlugs))
      .filter((a) => mentionsBuncombe(a.title, a.summary, a.url, a.contentText));
  },
};

export default carolinaPublicPress;
