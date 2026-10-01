/**
 * Mission Health (HCA Healthcare's WNC division) newsroom.
 *
 * missionhealth.org is a Sitecore + Next.js site. The newsroom page ships its
 * first page of results (10 items, newest first) inside __NEXT_DATA__ as the
 * `NewsListingSection` component's `defaultResponse`, and each article page
 * carries the full body as `pageBody` on the Sitecore route. Plain fetch works.
 *
 * About one release a week. These are corporate press releases - awards and
 * hiring drives as often as capital investments or service changes - so they
 * need the AI pass to separate news from PR. Coverage of HCA's ownership of
 * Mission (the Dogwood Health Trust monitor, lawsuits) comes from newsrooms.
 *
 * Mission Health spans six hospitals across WNC, and the feed covers only
 * Asheville and Buncombe County. Releases whose title or dek name a facility
 * or town outside Buncombe (Mission Hospital McDowell, Blue Ridge Regional,
 * CarePartners Macon...) are dropped unless they also name Asheville or
 * Buncombe; system-wide releases name no place and are kept.
 */

import type { NewsSourceModule, ScrapedArticle } from '../types';
import { canonicalizeUrl, fetchNewsText, htmlToText } from '../feeds';
import { stripHtml } from '../../utils/parsers';

const SITE = 'https://www.missionhealth.org';
const NEWSROOM = `${SITE}/about-us/newsroom`;
const LABEL = 'MissionHealth';
const SOURCE = 'MISSION_HEALTH';

/** Mission facilities and service areas outside Buncombe County. */
const OUTSIDE_BUNCOMBE =
  /McDowell|Marion|Angel Medical|Franklin|Macon|Highlands|Cashiers|Transylvania|Brevard|Blue Ridge Regional|Spruce Pine|Mitchell County|Yancey|Haywood|Waynesville|Hendersonville|Henderson County|Jackson County|Sylva|Rutherford/i;
const IN_BUNCOMBE = /Asheville|Buncombe/i;

interface NewsResult {
  itemId: string;
  pageTitle: string;
  pageShortDescription?: string;
  pageImageUrl?: string;
  publishedOn: string;
  url: string;
}

interface SitecoreComponent {
  componentName?: string;
  fields?: { defaultResponse?: { results?: NewsResult[] } };
}

function nextData(html: string): unknown {
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error(`[${LABEL}] __NEXT_DATA__ not found`);
  return JSON.parse(json);
}

function findComponent(node: unknown, name: string): SitecoreComponent | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if ((node as SitecoreComponent).componentName === name) return node as SitecoreComponent;
  for (const child of Object.values(node)) {
    const found = findComponent(child, name);
    if (found) return found;
  }
  return undefined;
}

function isBuncombe(result: NewsResult): boolean {
  const text = `${result.pageTitle} ${result.pageShortDescription ?? ''}`;
  return !OUTSIDE_BUNCOMBE.test(text) || IN_BUNCOMBE.test(text);
}

function toArticle(result: NewsResult): ScrapedArticle {
  return {
    source: SOURCE,
    sourceId: result.itemId,
    url: canonicalizeUrl(new URL(result.url, SITE).toString()),
    title: stripHtml(result.pageTitle).trim(),
    publishedAt: new Date(result.publishedOn),
    summary: result.pageShortDescription
      ? stripHtml(result.pageShortDescription).trim() || undefined
      : undefined,
    imageUrl: result.pageImageUrl || undefined,
  };
}

const missionHealth: NewsSourceModule = {
  key: SOURCE,
  name: 'Mission Health',
  homepage: NEWSROOM,
  kind: 'institution',
  method: 'html',
  async scrape() {
    const listing = findComponent(
      nextData(await fetchNewsText(NEWSROOM, LABEL)),
      'NewsListingSection'
    );
    const results = listing?.fields?.defaultResponse?.results;
    if (!results) throw new Error(`[${LABEL}] NewsListingSection results not found`);
    return results.filter(isBuncombe).map(toArticle);
  },
  async fetchFullText(url) {
    const data = nextData(await fetchNewsText(url, LABEL)) as {
      props?: {
        pageProps?: {
          layoutData?: { sitecore?: { route?: { fields?: { pageBody?: { value?: string } } } } };
        };
      };
    };
    return htmlToText(data.props?.pageProps?.layoutData?.sitecore?.route?.fields?.pageBody?.value);
  },
};

export default missionHealth;
