/**
 * Town of Black Mountain - the town's CivicPlus "News Flash".
 *
 * Council meeting recaps, press releases (grants, staffing, Helene recovery,
 * public safety), the monthly newsletter and utility notices; about one post
 * a week. The town's RSS feeds are nearly empty (1-2 items, 0 in the police
 * category), so we read the mobile News Flash list for the main "Black
 * Mountain News Flash!" category, which shows ~40 posts back about a year.
 * It is ~540KB of HTML but a single request, and plain fetch works (unlike
 * buncombenc.gov on the same platform).
 *
 * List entries give the date only ("Posted on September 24, 2026"), so
 * publishedAt is midnight Eastern that day. Some entries link straight to a
 * PDF in the Document Center (police press releases, some newsletters); those
 * keep the PDF as their URL, take the list preview (which often holds the
 * whole release) as their text, and fetchFullText returns nothing for them.
 */

import * as cheerio from 'cheerio';
import type { NewsSourceModule, ScrapedArticle } from '../types';
import { canonicalizeUrl, fetchNewsText, htmlToText } from '../feeds';
import {
  civicPlusArticleBody,
  civicPlusArticleId,
  civicPlusDetailUrl,
  civicPlusPostedDate,
} from './shared/civicplus';
import { stripHtml } from '../../utils/parsers';

const SITE = 'https://www.townofblackmountain.org';
const MAIN_CATEGORY = '1';
const LIST_URL = `${SITE}/m/newsflash?cat=${MAIN_CATEGORY}`;
const LABEL = 'BlackMountainTown';
const SOURCE = 'TOWN_OF_BLACK_MOUNTAIN';
const MAX_ITEMS = 25;
const SUMMARY_CHARS = 400;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max)}...`;
}

function parseNewsList(html: string): ScrapedArticle[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const articles: ScrapedArticle[] = [];
  for (const el of $(`li[id^="list-articles-category-${MAIN_CATEGORY}-"]`).toArray()) {
    const $el = $(el);
    const id = $el.attr('id')?.match(/-(\d+)$/)?.[1];
    const link = $el.find('a.article-title-link').first();
    const href = link.attr('href');
    const publishedAt = civicPlusPostedDate($el.text());
    if (!id || !href || !publishedAt || seen.has(id)) continue;
    seen.add(id);

    const isDetailPage = civicPlusArticleId(href) === id;
    const title = stripHtml(link.text()).trim();
    const previewHtml = $el.find('.article-preview').first().html() ?? undefined;
    const fullPreview = htmlToText(previewHtml)?.replace(/\n+/g, ' ') ?? '';
    // Most previews open by repeating the headline.
    const preview = fullPreview.startsWith(title)
      ? fullPreview.slice(title.length).trim()
      : fullPreview;
    articles.push({
      source: SOURCE,
      sourceId: id,
      url: isDetailPage
        ? `${SITE}/CivicAlerts.aspx?AID=${id}`
        : canonicalizeUrl(new URL(href, SITE).toString()),
      title,
      publishedAt,
      summary: preview ? truncate(preview, SUMMARY_CHARS) : undefined,
      // A PDF-linked entry has no page for fetchFullText; the list preview is all the text there is.
      contentText: !isDetailPage && preview.length > SUMMARY_CHARS ? preview : undefined,
      imageUrl: (() => {
        const src = $el.find('.article-preview-image img').first().attr('src');
        return src ? new URL(src, SITE).toString() : undefined;
      })(),
      categories: ['Black Mountain News Flash'],
    });
    if (articles.length >= MAX_ITEMS) break;
  }
  return articles;
}

const blackMountainTown: NewsSourceModule = {
  key: SOURCE,
  name: 'Town of Black Mountain',
  homepage: `${SITE}/CivicAlerts.aspx`,
  kind: 'government',
  method: 'html',
  async scrape() {
    return parseNewsList(await fetchNewsText(LIST_URL, LABEL));
  },
  async fetchFullText(url) {
    // Only News Flash pages have a body; Document Center PDFs are left alone.
    if (!/CivicAlerts\.aspx|\/newsflash\//i.test(url)) return undefined;
    const id = civicPlusArticleId(url);
    return id
      ? civicPlusArticleBody(await fetchNewsText(civicPlusDetailUrl(SITE, id), LABEL))
      : undefined;
  },
};

export default blackMountainTown;
