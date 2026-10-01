/**
 * Who an ingested item belongs to. The canonical publisher URL is the only
 * ingest identity (news_articles.url is unique); the outlet domain is what
 * takedown and outlet counts key on.
 */

import type { NewsSourceKind, NewsSourceModule, ScrapedArticle } from './types';

/** Lowercased host without a leading `www.`. */
export function hostDomain(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** The domain a module's own items are attributed to. */
export function moduleDomain(module: NewsSourceModule): string {
  return module.domain ?? hostDomain(module.homepage);
}

export interface ArticleIdentity {
  url: string;
  outletDomain: string;
  outletName: string;
  kind: NewsSourceKind;
}

/**
 * Aggregator items (those with `publisher`) belong to the publisher and count
 * as outlet reporting. Everything else belongs to the module that scraped it,
 * whatever host the URL happens to be on (a county document on docs.google.com
 * is still the county's).
 */
export function articleIdentity(module: NewsSourceModule, item: ScrapedArticle): ArticleIdentity {
  if (item.publisher) {
    return {
      url: item.url,
      outletDomain: item.publisher.domain.toLowerCase().replace(/^www\./, ''),
      outletName: item.publisher.name,
      kind: 'outlet',
    };
  }
  return {
    url: item.url,
    outletDomain: moduleDomain(module),
    outletName: module.name,
    kind: module.kind,
  };
}
