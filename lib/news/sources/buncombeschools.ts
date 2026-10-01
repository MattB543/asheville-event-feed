/**
 * Buncombe County Schools district news (buncombeschools.org, an Apptegy /
 * Thrillshare site).
 *
 * The news page renders from Thrillshare's CMS API, which returns 20 articles a
 * page as JSON with the full HTML body, cover image, author and filter tags.
 * That is one ~200KB request instead of the 1.7MB server-rendered page. The
 * section id below is the district's "News" section; if Apptegy renumbers it,
 * the new one appears in buncombeschools.org/o/bcs/news as
 * `thrillshare-cmsv2.services.thrillshare.com/api/v2/s/<id>/articles`.
 *
 * ~7 posts a week, mostly school features (field trips, arts week, sports);
 * the district decisions (superintendent hires, calendar changes) are the
 * minority the AI pass has to find. "Week in Review" posts are a video embed
 * with a one-line caption.
 */

import type { NewsSourceModule, ScrapedArticle } from '../types';
import { canonicalizeUrl, fetchNewsText, htmlToText } from '../feeds';
import { stripHtml } from '../../utils/parsers';

const ARTICLES_API = 'https://thrillshare-cmsv2.services.thrillshare.com/api/v2/s/191491/articles';
const LABEL = 'BuncombeSchools';
const SOURCE = 'BUNCOMBE_SCHOOLS';

interface ThrillshareArticle {
  id: number;
  title: string;
  content: string;
  snippet?: string;
  cover_image?: string;
  published_at: string;
  link: string;
  author?: string;
  filter_name?: string[];
}

function toArticle(item: ThrillshareArticle): ScrapedArticle {
  const snippet = item.snippet ? stripHtml(item.snippet).trim() : '';
  return {
    source: SOURCE,
    sourceId: String(item.id),
    url: canonicalizeUrl(item.link),
    title: stripHtml(item.title).trim(),
    publishedAt: new Date(item.published_at),
    author: item.author?.trim() || undefined,
    summary: snippet || undefined,
    contentText: htmlToText(item.content),
    imageUrl: item.cover_image || undefined,
    categories: item.filter_name?.length ? item.filter_name : undefined,
  };
}

const buncombeSchools: NewsSourceModule = {
  key: SOURCE,
  name: 'Buncombe County Schools',
  homepage: 'https://www.buncombeschools.org/o/bcs/news',
  kind: 'institution',
  method: 'api',
  async scrape() {
    const body = await fetchNewsText(`${ARTICLES_API}?page_no=1`, LABEL, {
      Accept: 'application/json',
    });
    const { articles } = JSON.parse(body) as { articles: ThrillshareArticle[] };
    return articles.map(toArticle);
  },
};

export default buncombeSchools;
