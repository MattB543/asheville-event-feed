/**
 * Reads for the /news page (docs/news/05-v1-plan.md §7). None of them is
 * cached: a takedown or a pipeline run has to show on the next request. Every
 * story read goes through `liveStories()`, and only `live` member articles are
 * ever linked, so a hidden article can't leak through a story that's still up.
 *
 * The one cached read here is the end cap's Top 30, which is events data and
 * lives under the same `events` tag as the event pages.
 */

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { and, asc, desc, eq, exists, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { newsArticles, newsDays, newsSources, newsStories } from '@/lib/db/schema';
import { queryTop30CategoryEvents } from '@/lib/db/queries/events';
import { liveStories, type NewsStoryRow } from '@/lib/news/db';
import { getEventOccurrences, mergeTop30CategoryEvents } from '@/lib/utils/top30Ranking';
import { getDayBoundariesEastern, getTodayStringEastern } from '@/lib/utils/timezone';

/** One article a story links out to. */
export interface NewsLink {
  url: string;
  outletName: string;
  outletDomain: string;
  kind: string;
  publishedAt: Date;
}

export interface NewsStoryView {
  id: string;
  shortId: string;
  headline: string;
  summary: string;
  imageUrl: string | null;
  topics: string[];
  place: string | null;
  score: number;
  topRank: number | null;
  filingDay: string; // 'YYYY-MM-DD', ET
  /** The newest member article's time, which is what the filing day follows. */
  lastArticleAt: Date;
  /** Where "Read at X" and a minimal row's headline go. Null only if every member went away. */
  lead: NewsLink | null;
  /** One link per other outlet that covered the story, earliest article first. */
  otherOutlets: NewsLink[];
  /** A Reddit thread attached to a newsroom story. */
  discussion: NewsLink | null;
}

export interface NewsDayView {
  day: string;
  /** news_days.summary: one sentence per Top story, in rank order. Null until the AI run writes it. */
  shortVersion: { storyId: string; text: string }[] | null;
  top: NewsStoryView[];
  more: NewsStoryView[];
}

export interface NewsSourceLink {
  domain: string;
  name: string;
  url: string;
}

export interface NewsSourceGroups {
  newsrooms: NewsSourceLink[];
  official: NewsSourceLink[];
  community: NewsSourceLink[];
}

/** How many filing days the default view covers. */
export const NEWS_DAYS_SHOWN = 7;
/** Cap on a search or topic result list. */
export const NEWS_RESULTS_LIMIT = 50;

const STORY_FIELDS = {
  id: newsStories.id,
  shortId: newsStories.shortId,
  tier: newsStories.tier,
  headline: newsStories.headline,
  summary: newsStories.summary,
  imageUrl: newsStories.imageUrl,
  topics: newsStories.topics,
  place: newsStories.place,
  score: newsStories.score,
  topRank: newsStories.topRank,
  filingDay: newsStories.filingDay,
  leadArticleId: newsStories.leadArticleId,
  firstPublishedAt: newsStories.firstPublishedAt,
  lastArticleAt: newsStories.lastArticleAt,
};

type StoryRow = Pick<NewsStoryRow, keyof typeof STORY_FIELDS>;

/** Reddit links read as "r/asheville discussion"; anything else community is a plain outlet chip. */
function isRedditUrl(url: string): boolean {
  return /^https?:\/\/([a-z0-9-]+\.)?reddit\.com\//i.test(url);
}

/**
 * Attach each story's live member articles: the lead, the other outlets and a
 * Reddit thread. One query for the whole page.
 */
async function withLinks(rows: StoryRow[]): Promise<NewsStoryView[]> {
  if (rows.length === 0) return [];

  const members = await db
    .select({
      id: newsArticles.id,
      storyId: newsArticles.storyId,
      url: newsArticles.url,
      outletName: newsArticles.outletName,
      outletDomain: newsArticles.outletDomain,
      kind: newsArticles.kind,
      publishedAt: newsArticles.publishedAt,
    })
    .from(newsArticles)
    .where(
      and(
        inArray(
          newsArticles.storyId,
          rows.map((row) => row.id)
        ),
        eq(newsArticles.state, 'live')
      )
    )
    .orderBy(asc(newsArticles.publishedAt), asc(newsArticles.id));

  const byStory = new Map<string, typeof members>();
  for (const member of members) {
    if (!member.storyId) continue;
    const list = byStory.get(member.storyId) ?? [];
    list.push(member);
    byStory.set(member.storyId, list);
  }

  return rows.map((row) => {
    const list = byStory.get(row.id) ?? [];
    // The pipeline's lead, or the same priority it uses if that article has
    // since gone (outlet, then official, then the earliest).
    const leadMember =
      list.find((m) => m.id === row.leadArticleId) ??
      list.find((m) => m.kind === 'outlet') ??
      list.find((m) => m.kind !== 'community') ??
      list[0];

    const otherOutlets: NewsLink[] = [];
    const seenDomains = new Set(leadMember ? [leadMember.outletDomain] : []);
    let discussion: NewsLink | null = null;

    for (const member of list) {
      if (member === leadMember) continue;
      if (member.kind === 'community' && isRedditUrl(member.url)) {
        discussion ??= toLink(member);
        continue;
      }
      if (seenDomains.has(member.outletDomain)) continue;
      seenDomains.add(member.outletDomain);
      otherOutlets.push(toLink(member));
    }

    return {
      id: row.id,
      shortId: row.shortId,
      headline: row.headline,
      summary: row.summary,
      imageUrl: row.imageUrl,
      topics: row.topics,
      place: row.place,
      score: row.score,
      topRank: row.topRank,
      filingDay: row.filingDay,
      lastArticleAt: row.lastArticleAt,
      lead: leadMember ? toLink(leadMember) : null,
      otherOutlets,
      // A community-tier story's lead already is the thread
      discussion: row.tier === 'community' ? null : discussion,
    };
  });
}

function toLink(member: {
  url: string;
  outletName: string;
  outletDomain: string;
  kind: string;
  publishedAt: Date;
}): NewsLink {
  return {
    url: member.url,
    outletName: member.outletName,
    outletDomain: member.outletDomain,
    kind: member.kind,
    publishedAt: member.publishedAt,
  };
}

/** Top stories in rank order, then everything else by score, newest first on ties. */
function byFeedOrder(a: NewsStoryView, b: NewsStoryView): number {
  if (a.topRank !== null || b.topRank !== null) {
    return (a.topRank ?? Number.MAX_SAFE_INTEGER) - (b.topRank ?? Number.MAX_SAFE_INTEGER);
  }
  return b.score - a.score;
}

/** The default view: the last `NEWS_DAYS_SHOWN` filing days that have a live story, newest first. */
export async function queryNewsDays(): Promise<NewsDayView[]> {
  const dayRows = await db
    .selectDistinct({ day: newsStories.filingDay })
    .from(newsStories)
    .where(liveStories())
    .orderBy(desc(newsStories.filingDay))
    .limit(NEWS_DAYS_SHOWN);
  const days = dayRows.map((row) => row.day);
  if (days.length === 0) return [];

  const [storyRows, summaryRows] = await Promise.all([
    db
      .select(STORY_FIELDS)
      .from(newsStories)
      .where(liveStories(inArray(newsStories.filingDay, days)))
      .orderBy(desc(newsStories.score), desc(newsStories.firstPublishedAt), asc(newsStories.id)),
    db
      .select({ day: newsDays.day, summary: newsDays.summary })
      .from(newsDays)
      .where(inArray(newsDays.day, days)),
  ]);

  const stories = await withLinks(storyRows);
  const summaries = new Map(summaryRows.map((row) => [row.day, row.summary]));

  return days.map((day) => {
    const dayStories = stories.filter((story) => story.filingDay === day).sort(byFeedOrder);
    const shortVersion = summaries.get(day);
    return {
      day,
      shortVersion: Array.isArray(shortVersion) && shortVersion.length > 0 ? shortVersion : null,
      top: dayStories.filter((story) => story.topRank !== null),
      more: dayStories.filter((story) => story.topRank === null),
    };
  });
}

/**
 * Search (`websearch_to_tsquery` over headline + summary) and/or one topic, as
 * a flat list: newest filing day first, Top stories first within a day.
 */
export async function searchNewsStories({
  q,
  topic,
}: {
  q: string | null;
  topic: string | null;
}): Promise<NewsStoryView[]> {
  const rows = await db
    .select(STORY_FIELDS)
    .from(newsStories)
    .where(
      liveStories(
        q ? sql`${newsStories.searchTsv} @@ websearch_to_tsquery('english', ${q})` : undefined,
        topic ? sql`${topic} = ANY(${newsStories.topics})` : undefined
      )
    )
    .orderBy(
      desc(newsStories.filingDay),
      sql`${newsStories.topRank} ASC NULLS LAST`,
      desc(newsStories.score),
      desc(newsStories.firstPublishedAt),
      asc(newsStories.id)
    )
    .limit(NEWS_RESULTS_LIMIT);

  return withLinks(rows);
}

const SHORT_ID_PATTERN = /^[a-z0-9]{8}$/;

/**
 * A shared story (`?s=`), whatever the date window or filters. Hidden, pending
 * and unknown ids all come back null. Cached per request so generateMetadata
 * and the page share one lookup.
 */
export const getSharedStory = cache(async (shortId: string): Promise<NewsStoryView | null> => {
  const id = shortId.trim().toLowerCase();
  if (!SHORT_ID_PATTERN.test(id)) return null;

  const rows = await db
    .select(STORY_FIELDS)
    .from(newsStories)
    .where(liveStories(eq(newsStories.shortId, id)))
    .limit(1);

  const [story] = await withLinks(rows);
  return story ?? null;
});

/** A source's homepage if it's a site root, else the bare domain (a section page or vendor portal path won't do). */
function sourceHomepage(domain: string, homepage: string | null): string {
  if (homepage) {
    try {
      const url = new URL(homepage);
      if (/^https?:$/.test(url.protocol) && url.pathname === '/' && !url.search) return url.origin;
    } catch {
      // Fall through to the domain
    }
  }
  return `https://${domain}`;
}

/**
 * The "these sources" modal: enabled sources that have at least one live
 * article, by kind. Sources that only ever produced skipped items (one-off
 * publishers an aggregator brought in, a removed module) stay off the list.
 * Two rows can share a name, so names are listed once.
 */
export async function queryNewsSourceGroups(): Promise<NewsSourceGroups> {
  const rows = await db
    .select({
      domain: newsSources.domain,
      name: newsSources.name,
      kind: newsSources.kind,
      homepage: newsSources.homepage,
    })
    .from(newsSources)
    .where(
      and(
        eq(newsSources.enabled, true),
        exists(
          db
            .select({ id: newsArticles.id })
            .from(newsArticles)
            .where(
              and(eq(newsArticles.outletDomain, newsSources.domain), eq(newsArticles.state, 'live'))
            )
        )
      )
    )
    .orderBy(asc(newsSources.name));

  const groups: NewsSourceGroups = { newsrooms: [], official: [], community: [] };
  const seen = new Set<string>();

  for (const row of rows) {
    const key = `${row.kind}|${row.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const link = {
      domain: row.domain,
      name: row.name,
      url: sourceHomepage(row.domain, row.homepage),
    };
    if (row.kind === 'outlet') groups.newsrooms.push(link);
    else if (row.kind === 'community') groups.community.push(link);
    else groups.official.push(link);
  }

  return groups;
}

// ===== End cap: the Top 30 events in the next 7 days =====

/** Same depth the Top 30 page ranks from, so the ranks match it. */
const TOP30_CANDIDATE_LIMIT = 50;
const TOP30_VISIBLE_LIMIT = 30;
const END_CAP_DAYS = 7;

const getTop30OverallCandidates = unstable_cache(
  async () => queryTop30CategoryEvents('overall', TOP30_CANDIDATE_LIMIT),
  ['news-end-cap-top30-overall'],
  { tags: ['events'], revalidate: 3600 }
);

export interface EndCapEvent {
  id: string;
  sourceId: string;
  source: string;
  title: string;
  description: string | null;
  aiSummary: string | null;
  startDate: Date;
  location: string | null;
  organizer: string | null;
  price: string | null;
  imageUrl: string | null;
  url: string;
  tags: string[] | null;
  timeUnknown: boolean;
  recurringType: string | null;
  favoriteCount: number;
  top30Occurrences: { id: string; startDate: Date; timeUnknown?: boolean | null }[] | null;
  /** Its rank on the Top 30 page. */
  rank: number;
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return next.toISOString().slice(0, 10);
}

/**
 * The overall Top 30, ranked exactly as the Top 30 tab ranks it with no
 * filters on, cut to events with a date in the next 7 ET calendar days
 * (today included). Ranks keep their Top 30 numbers, gaps and all.
 */
export async function queryEndCapEvents(): Promise<EndCapEvent[]> {
  const ranked = mergeTop30CategoryEvents(await getTop30OverallCandidates()).slice(
    0,
    TOP30_VISIBLE_LIMIT
  );

  const today = getTodayStringEastern();
  const windowStart = getDayBoundariesEastern(today).start.getTime();
  const windowEnd = getDayBoundariesEastern(addDays(today, END_CAP_DAYS - 1)).end.getTime();

  return ranked.flatMap((event, index) => {
    const inWindow = getEventOccurrences(event).some(({ startDate }) => {
      const time = startDate.getTime();
      return time >= windowStart && time <= windowEnd;
    });
    if (!inWindow) return [];

    return [
      {
        id: event.id,
        sourceId: event.sourceId,
        source: event.source,
        title: event.title,
        description: event.description,
        aiSummary: event.aiSummary,
        startDate: event.startDate,
        location: event.location,
        organizer: event.organizer,
        price: event.price,
        imageUrl: event.imageUrl,
        url: event.url,
        tags: event.tags,
        timeUnknown: event.timeUnknown ?? false,
        recurringType: event.recurringType,
        favoriteCount: event.favoriteCount ?? 0,
        top30Occurrences: event.top30Occurrences ?? null,
        rank: index + 1,
      },
    ];
  });
}
