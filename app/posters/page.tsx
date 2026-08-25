import type { Metadata } from 'next';
import Header from '@/components/Header';
import PosterUploadButton from '@/components/posters/PosterUploadButton';
import PosterWall from '@/components/posters/PosterWall';
import {
  countHiddenAdultPosters,
  queryPublishedPosters,
  queryPublishedPosterByExtractionId,
  type PosterFeedUpload,
  type PosterTimeframe,
} from '@/lib/db/queries/posters';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Community Posters',
  description:
    'Event posters and flyers photographed around Asheville, read by AI and added to the feed.',
};

// No caching: a moderator hiding or approving a poster should show up on the
// next request, and the volume here is tiny.
export const dynamic = 'force-dynamic';

interface PostersPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The toggles and the deep link have to survive each other, so hrefs are built
 * from the current params rather than hardcoded.
 */
function feedHref(
  targetExtractionId: string | null,
  { showAdult, showPast }: { showAdult: boolean; showPast: boolean }
): string {
  const params = new URLSearchParams();
  if (targetExtractionId) params.set('p', targetExtractionId);
  if (showAdult) params.set('adult', 'show');
  if (showPast) params.set('past', 'show');

  const query = params.toString();
  return query ? `/posters?${query}` : '/posters';
}

/** Same pill as the header's tabs, so the two rows of tabs read as one system. */
function timeframeTabClasses(active: boolean): string {
  return `px-2 py-1 sm:py-1.5 text-sm font-medium rounded-md transition-colors ${
    active
      ? 'text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800'
      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
  }`;
}

export default async function PostersPage({ searchParams }: PostersPageProps) {
  const params = await searchParams;
  const rawTarget = params.p;
  const targetExtractionId = Array.isArray(rawTarget) ? rawTarget[0] : (rawTarget ?? null);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = !!user;

  // Signed out is never allowed through, so `?adult=show` on its own does
  // nothing - the gate is the session, not the URL.
  const showAdult = signedIn && params.adult === 'show';

  const showPast = params.past === 'show';
  const timeframe: PosterTimeframe = showPast ? 'past' : 'upcoming';

  let uploads: PosterFeedUpload[] = [];
  let hiddenAdultCount = 0;
  let failed = false;

  try {
    [uploads, hiddenAdultCount] = await Promise.all([
      queryPublishedPosters(undefined, { includeAdult: showAdult, timeframe }),
      showAdult ? Promise.resolve(0) : countHiddenAdultPosters(undefined, { timeframe }),
    ]);

    // The deep link can point at a poster older than the feed window, in which
    // case it gets pulled in on top of the newest 30.
    if (targetExtractionId) {
      const alreadyListed = uploads.some((upload) =>
        upload.extractions.some((extraction) => extraction.id === targetExtractionId)
      );

      if (!alreadyListed) {
        const target = await queryPublishedPosterByExtractionId(targetExtractionId, {
          includeAdult: showAdult,
        });
        if (target) uploads = [target, ...uploads];
      }
    }
  } catch (error) {
    console.error('[Posters] Failed to fetch posters:', error);
    failed = true;
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="posters" />

      <div className="flex-grow">
        {/* Page furniture stays in the same max-w-7xl column as the event pages,
            so the title lines up across tabs. The wall below runs full width. */}
        <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 pt-6 pb-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 lg:gap-4 px-3 sm:px-0">
            <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              Community posters
            </h1>
            <PosterUploadButton />
          </div>

          <p className="mt-2 px-3 sm:px-0 text-sm text-gray-600 dark:text-gray-400">
            {showPast
              ? 'Flyers whose events have already come and gone.'
              : 'Flyers spotted around Asheville — tap any poster to read what it says.'}
          </p>

          {/* Plain anchors for the same reason as the banner link below: both
              states are the same route segment and differ only by search param. */}
          <div className="mt-3 px-3 sm:px-0">
            <nav aria-label="Poster timeframe" className="-ml-2 flex items-center gap-0.5">
              <a
                href={feedHref(null, { showAdult, showPast: false })}
                aria-current={showPast ? undefined : 'page'}
                className={timeframeTabClasses(!showPast)}
              >
                Upcoming
              </a>
              <a
                href={feedHref(null, { showAdult, showPast: true })}
                aria-current={showPast ? 'page' : undefined}
                className={timeframeTabClasses(showPast)}
              >
                Past
              </a>
            </nav>
          </div>

          {(showAdult || hiddenAdultCount > 0) && (
            <div className="mt-4 mx-3 sm:mx-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-800/40 dark:border-blue-400/30">
              <p className="text-sm text-blue-900 dark:text-blue-200">
                {!signedIn
                  ? 'Some posters are not suitable for children and are hidden. Sign in to view them.'
                  : showAdult
                    ? 'Showing posters that are not suitable for children.'
                    : `${hiddenAdultCount} poster${hiddenAdultCount === 1 ? '' : 's'} not suitable for children ${hiddenAdultCount === 1 ? 'is' : 'are'} hidden.`}
              </p>

              {/* A plain anchor, not <Link>: both states are the same route segment
                  and differ only by search param, so a soft navigation would reuse
                  the cached payload and the list would never change. */}
              <a
                href={
                  signedIn
                    ? feedHref(targetExtractionId, { showAdult: !showAdult, showPast })
                    : '/login'
                }
                className="text-sm font-medium text-blue-800 dark:text-blue-300 underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-200 whitespace-nowrap"
              >
                {!signedIn ? 'Sign in' : showAdult ? 'Hide them' : 'Show hidden'}
              </a>
            </div>
          )}
        </div>

        {uploads.length === 0 ? (
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-8">
            <div className="p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
              <p className="text-gray-600 dark:text-gray-400">
                {failed
                  ? 'Posters are unavailable right now. Please try again shortly.'
                  : hiddenAdultCount > 0
                    ? // Not "no posters yet" - there are posters, they are just all filtered.
                      'Every poster here is currently filtered out. Nothing else to show.'
                    : showPast
                      ? 'No posters have aged out yet.'
                      : // "Coming up", not "at all" - anything dated is on the past wall.
                        'Nothing coming up on the wall right now. Be the first to pin something up.'}
              </p>
            </div>
          </div>
        ) : (
          // Full width: the wall is the one thing on the page that should run
          // edge to edge, so the patchwork has no margin breaking it up. The
          // gap above it is large on purpose - butted right under the header the
          // wall reads as part of the page furniture rather than as its own
          // thing, and the tape needs room to hang above the top row.
          <div className="px-1 sm:px-2 pt-14 sm:pt-24 pb-10">
            <PosterWall uploads={uploads} initialExtractionId={targetExtractionId} />
          </div>
        )}
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
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
