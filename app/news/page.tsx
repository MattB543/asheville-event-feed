import type { Metadata } from 'next';
import Header from '@/components/Header';
import NewsDaySection, { NewsListLabel } from '@/components/news/NewsDaySection';
import NewsEndCap from '@/components/news/NewsEndCap';
import NewsResultsList from '@/components/news/NewsResultsList';
import NewsSearchForm from '@/components/news/NewsSearchForm';
import NewsSourcesModal from '@/components/news/NewsSourcesModal';
import NewsStoryCard from '@/components/news/NewsStoryCard';
import StoryFocus from '@/components/news/StoryFocus';
import { clipText, isUsableStoryImage } from '@/components/news/display';
import {
  getSharedStory,
  NEWS_RESULTS_LIMIT,
  queryEndCapEvents,
  queryNewsDays,
  queryNewsSourceGroups,
  searchNewsStories,
  type EndCapEvent,
  type NewsDayView,
  type NewsSourceGroups,
  type NewsStoryView,
} from '@/lib/news/queries';
import { isNewsTopicSlug, newsTopic } from '@/lib/news/topics';

// No caching of news reads at all: a takedown or a pipeline run shows up on the
// next request, so there is nothing to invalidate (docs/news/05-v1-plan.md §7.1).
export const dynamic = 'force-dynamic';

// The root layout's template makes this "Asheville News | AVL GO"; link
// previews don't go through the template, so they get the full form.
const PAGE_TITLE = 'Asheville News';
const PREVIEW_TITLE = `${PAGE_TITLE} | AVL GO`;
const PAGE_DESCRIPTION =
  'Asheville and Buncombe County news, summarized by AVL GO from local newsrooms, public agencies and community forums, with links to the original reporting.';

type SearchParams = { [key: string]: string | string[] | undefined };

interface NewsPageProps {
  searchParams: Promise<SearchParams>;
}

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function parseParams(params: SearchParams) {
  const topic = firstParam(params.topic);
  return {
    sharedId: firstParam(params.s) || null,
    q: firstParam(params.q).slice(0, 200) || null,
    // An unknown topic is ignored rather than matching nothing
    topic: isNewsTopicSlug(topic) ? topic : null,
  };
}

export async function generateMetadata({ searchParams }: NewsPageProps): Promise<Metadata> {
  const { sharedId } = parseParams(await searchParams);
  const story = sharedId ? await getSharedStory(sharedId).catch(() => null) : null;

  if (!story) {
    return {
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      alternates: { canonical: '/news' },
      openGraph: {
        type: 'website',
        siteName: 'AVL GO',
        url: '/news',
        title: PREVIEW_TITLE,
        description: PAGE_DESCRIPTION,
        images: ['/avlgo-og.png'],
      },
      twitter: {
        card: 'summary_large_image',
        title: PREVIEW_TITLE,
        description: PAGE_DESCRIPTION,
        images: ['/avlgo-og.png'],
      },
    };
  }

  const description = clipText(story.summary);
  const image = isUsableStoryImage(story.imageUrl) ? story.imageUrl : '/avlgo-og.png';

  return {
    title: story.headline,
    description,
    // The share link is the feed with this story highlighted, not a page of its own
    alternates: { canonical: '/news' },
    openGraph: {
      type: 'article',
      siteName: 'AVL GO',
      url: `/news?s=${story.shortId}`,
      title: story.headline,
      description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: story.headline,
      description,
      images: [image],
    },
  };
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 mx-3 sm:mx-0 p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-gray-600 dark:text-gray-400">
      {children}
    </div>
  );
}

function ResultsHeading({
  count,
  q,
  topic,
}: {
  count: number;
  q: string | null;
  topic: string | null;
}) {
  const topicLabel = topic ? newsTopic(topic)?.label : null;
  const what = [q && `matching “${q}”`, topicLabel && `in ${topicLabel}`].filter(Boolean).join(' ');

  return (
    <div className="mt-6 mb-3 px-3 sm:px-0 flex items-baseline justify-between gap-3">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {count === 0
          ? 'No stories'
          : `${count}${count >= NEWS_RESULTS_LIMIT ? '+' : ''} ${count === 1 ? 'story' : 'stories'}`}{' '}
        {what}
      </p>
      {/* A plain anchor: the same route with different params, fully reloaded */}
      <a
        href="/news"
        className="shrink-0 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
      >
        Clear
      </a>
    </div>
  );
}

function storyIds(days: NewsDayView[], results: NewsStoryView[]): Set<string> {
  const ids = new Set(results.map((story) => story.shortId));
  for (const day of days) {
    for (const story of [...day.top, ...day.more]) ids.add(story.shortId);
  }
  return ids;
}

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const { sharedId, q, topic } = parseParams(await searchParams);
  const filtering = q !== null || topic !== null;
  const now = new Date();

  // Events data has its own failure path, so a news outage doesn't take the
  // end cap down with it, or the reverse.
  const endCapPromise = queryEndCapEvents().catch((error: unknown) => {
    console.error('[News] Failed to fetch the end cap events:', error);
    return [] as EndCapEvent[];
  });

  let days: NewsDayView[] = [];
  let results: NewsStoryView[] = [];
  let shared: NewsStoryView | null = null;
  let sources: NewsSourceGroups = { newsrooms: [], official: [], community: [] };
  let failed = false;

  try {
    [days, results, shared, sources] = await Promise.all([
      filtering ? Promise.resolve([]) : queryNewsDays(),
      filtering ? searchNewsStories({ q, topic }) : Promise.resolve([]),
      sharedId ? getSharedStory(sharedId) : Promise.resolve(null),
      queryNewsSourceGroups(),
    ]);
  } catch (error) {
    console.error('[News] Failed to fetch news:', error);
    failed = true;
  }

  const endCapEvents = await endCapPromise;
  // A shared story that isn't already on the page gets one slot at the top
  const sharedSlot = shared && !storyIds(days, results).has(shared.shortId) ? shared : null;

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="news" />

      <div className="flex-grow">
        {/* The event pages' gutters, around a centered reading column. The end
            cap is centered under it but wider: event cards lay out in three
            columns from xl up and need about 1000px to do it. */}
        <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-6 pb-4">
          <div className="max-w-3xl mx-auto">
            <div className="px-3 sm:px-0">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                Asheville news
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Headlines and summaries by AVL GO, from reporting by{' '}
                <NewsSourcesModal groups={sources} />.
              </p>
              <div className="mt-4">
                <NewsSearchForm q={q ?? ''} topic={topic ?? ''} />
              </div>
            </div>

            {sharedId && !shared && !failed && (
              <p
                role="status"
                className="mt-4 mx-3 sm:mx-0 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-sm text-gray-700 dark:text-gray-300"
              >
                That story is no longer available.
              </p>
            )}

            {sharedSlot && (
              <section aria-label="Shared with you" className="mt-6">
                <div className="bg-white dark:bg-gray-900 sm:border border-y border-gray-200 dark:border-gray-800 sm:rounded-lg sm:shadow-sm overflow-hidden">
                  <NewsListLabel>Shared with you</NewsListLabel>
                  <NewsStoryCard story={sharedSlot} now={now} />
                </div>
              </section>
            )}
            <StoryFocus sharedId={shared?.shortId ?? null} />

            {failed ? (
              <EmptyState>News is unavailable right now. Please try again shortly.</EmptyState>
            ) : filtering ? (
              <>
                <ResultsHeading count={results.length} q={q} topic={topic} />
                {results.length > 0 ? (
                  <NewsResultsList stories={results} now={now} />
                ) : (
                  <EmptyState>
                    Nothing matches that yet.{' '}
                    <a href="/news" className="text-brand-600 dark:text-brand-400 hover:underline">
                      See all the news
                    </a>
                    .
                  </EmptyState>
                )}
              </>
            ) : days.length > 0 ? (
              <div className="mt-6 flex flex-col gap-8">
                {days.map((day) => (
                  <NewsDaySection key={day.day} day={day} now={now} />
                ))}
              </div>
            ) : (
              <EmptyState>No stories yet. Check back soon.</EmptyState>
            )}
          </div>

          <div className="max-w-5xl mx-auto">
            <NewsEndCap events={endCapEvents} />
          </div>
        </div>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <p className="mb-2">
          Built by{' '}
          <a
            href="https://mattbrooks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-gray-300"
          >
            Matt
          </a>{' '}
          at Brooks Solutions, LLC.
        </p>
        <p>
          © {new Date().getFullYear()} AVL GO. Headlines and summaries are ours; the reporting
          belongs to the outlets we link to.
        </p>
      </footer>
    </main>
  );
}
