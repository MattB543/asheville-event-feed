/**
 * Helpers for CivicPlus (CivicEngage) "News Flash" sites - Buncombe County and
 * the Town of Black Mountain. Lives in a subdirectory so the test runner's
 * `--all` does not load it as a source.
 */

import * as cheerio from 'cheerio';
import { htmlToText } from '../../feeds';
import { parseAsEastern } from '../../../utils/timezone';

const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';

/**
 * CivicPlus stamps every RSS pubDate "-0500" but the clock time is Eastern
 * local (EDT in summer): lastBuildDate reads 23:41 -0500 at 03:41 UTC. Keep
 * the wall clock and apply the real Eastern offset.
 */
export function civicPlusRssDate(value: string): Date | undefined {
  const match = value.match(/(\d{1,2}) (\w{3}) (\d{4}) (\d{2}:\d{2}:\d{2})/);
  const month = match ? MONTHS.indexOf(match[2]) / 3 + 1 : 0;
  if (!match || month < 1) return undefined;
  const date = parseAsEastern(
    `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`,
    match[4]
  );
  return isNaN(date.getTime()) ? undefined : date;
}

/** "Posted on September 24, 2026" (list pages carry no time) -> midnight Eastern. */
export function civicPlusPostedDate(text: string): Date | undefined {
  const match = text.match(/Posted on ([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})/);
  const month = match ? MONTHS.indexOf(match[1]) / 3 + 1 : 0;
  if (!match || month < 1) return undefined;
  const date = parseAsEastern(
    `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`,
    '00:00:00'
  );
  return isNaN(date.getTime()) ? undefined : date;
}

/** Numeric entities (`&#xA0;`, `&#8212;`) that decodeHtmlEntities leaves behind. */
export function decodeNumericEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

/** News Flash article id from `CivicAlerts.aspx?AID=N` or `/m/newsflash/Home/Detail/N`. */
export function civicPlusArticleId(link: string): string | undefined {
  return link.match(/[?&]aid=(\d+)/i)?.[1] ?? link.match(/\/detail\/(\d+)/i)?.[1];
}

export function civicPlusDetailUrl(site: string, id: string): string {
  return `${site}/m/newsflash/home/detail/${id}`;
}

/**
 * Body of a /m/newsflash/home/detail/N page as plain text. Posts that only
 * point at a PDF (newsletters) leave `.article-content` empty and put their
 * text in the header description instead.
 */
export function civicPlusArticleBody(html: string): string | undefined {
  const $ = cheerio.load(html);
  for (const selector of ['.article-content', '.article-header-desc']) {
    const body = $(selector).first().html();
    const text = body ? htmlToText(decodeNumericEntities(body)) : undefined;
    if (text) return text;
  }
  return undefined;
}
