import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ArrowLeft, CalendarDays, ChevronRight, ExternalLink, MapPin } from 'lucide-react';
import IntentLink from '@/components/IntentLink';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import GroupEventRow from '@/components/groups/GroupEventRow';
import { getGroupPage } from '@/lib/db/queries/groups';
import { groupCategoryLabel, isGroupCategory } from '@/lib/groups/categories';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';

/** Upcoming rows shown before the rest fold into "Show all N upcoming events". */
const UPCOMING_VISIBLE = 10;

interface PageProps {
  params: Promise<{ slug: string }>;
}

// generateMetadata and the page both need the group; this makes it one load per request.
const loadGroup = cache((slug: string) => getGroupPage(slug));

function metaDescription(name: string, description: string | null, category: string): string {
  return (
    description ??
    `${name}: a recurring ${groupCategoryLabel(category).toLowerCase()} group around Asheville, NC. See their upcoming events on AVL GO.`
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const group = await loadGroup(slug);

  if (!group) {
    return {
      title: 'Group not found',
      description: "The group you're looking for could not be found.",
      robots: { index: false, follow: true },
    };
  }

  const url = `${siteUrl}/groups/${group.slug}`;
  const description = metaDescription(group.name, group.description, group.category);

  return {
    title: group.name,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title: group.name,
      description,
      siteName: 'AVL GO',
      locale: 'en_US',
      images: [{ url: '/avlgo-og.png', width: 1200, height: 630, alt: 'AVL GO' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: group.name,
      description,
      images: ['/avlgo-og.png'],
      creator: '@mattbrooksxyz',
    },
  };
}

/** Only http(s) links are rendered; the URLs come from a research pass, not a human form. */
function httpUrl(value: string | null): string | null {
  return value && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

function sameUrl(a: string, b: string): boolean {
  const normalize = (url: string) => url.toLowerCase().replace(/\/+$/, '');
  return normalize(a) === normalize(b);
}

const linkClasses =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

const emptyLinkClasses =
  'font-medium text-brand-600 dark:text-brand-400 underline underline-offset-2 hover:text-brand-700 dark:hover:text-brand-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

const eventListClasses =
  'overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-200 dark:divide-gray-800';

export default async function GroupPage({ params }: PageProps) {
  // Per request, like /groups: the matched events are cached per Eastern date, so the page itself
  // must not outlive that cache (yesterday's events would read as upcoming after midnight).
  await connection();
  const { slug } = await params;
  const group = await loadGroup(slug);

  if (!group) notFound();

  const hiddenPastCount = group.pastTotal - group.past.length;
  const upcomingFirst = group.upcoming.slice(0, UPCOMING_VISIBLE);
  const upcomingRest = group.upcoming.slice(UPCOMING_VISIBLE);
  const meetupUrl = httpUrl(group.meetupUrl);
  const rawWebsite = httpUrl(group.website);
  // Some groups' "website" is their Meetup page; one button is enough.
  const website = rawWebsite && !(meetupUrl && sameUrl(rawWebsite, meetupUrl)) ? rawWebsite : null;

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="groups" />

      <div className="flex-grow">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10">
          <IntentLink
            href="/groups"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            All groups
          </IntentLink>

          <p className="mt-6 text-xs font-semibold uppercase tracking-wide">
            {/* Opens the directory on this category; unknown categories collect under "other". */}
            <IntentLink
              href={`/groups?cat=${isGroupCategory(group.category) ? group.category : 'other'}`}
              className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {groupCategoryLabel(group.category)}
            </IntentLink>
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            {group.name}
          </h1>
          {group.description && (
            <p className="mt-3 text-gray-700 dark:text-gray-300">{group.description}</p>
          )}

          {(group.schedule || group.homeBase) && (
            <ul className="mt-4 space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
              {group.schedule && (
                <li className="flex items-start gap-2">
                  <CalendarDays size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>
                    <span className="sr-only">Schedule: </span>
                    {group.schedule}
                  </span>
                </li>
              )}
              {group.homeBase && (
                <li className="flex items-start gap-2">
                  <MapPin size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <span>
                    <span className="sr-only">Home base: </span>
                    {group.homeBase}
                  </span>
                </li>
              )}
            </ul>
          )}

          {(website || meetupUrl) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer" className={linkClasses}>
                  Website
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
              {meetupUrl && (
                <a
                  href={meetupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClasses}
                >
                  Meetup
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              )}
            </div>
          )}

          <section aria-labelledby="upcoming-heading" className="mt-10">
            <h2
              id="upcoming-heading"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Upcoming events{' '}
              <span className="font-normal text-gray-500 dark:text-gray-400">
                ({group.upcoming.length})
              </span>
            </h2>

            {group.upcoming.length > 0 ? (
              <>
                <ul className={`mt-3 ${eventListClasses}`}>
                  {upcomingFirst.map((event) => (
                    <GroupEventRow key={event.id} event={event} />
                  ))}
                </ul>
                {/* A daily group can list dozens; the rest fold away natively, no client JS. */}
                {upcomingRest.length > 0 && (
                  <details className="group/more mt-3">
                    <summary className="inline-flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden list-none">
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="text-gray-400 dark:text-gray-500 transition-transform group-open/more:rotate-90"
                      />
                      <span className="group-open/more:hidden">
                        Show all {group.upcoming.length} upcoming events
                      </span>
                      <span className="hidden group-open/more:inline">Show fewer</span>
                    </summary>
                    <ul className={`mt-3 ${eventListClasses}`}>
                      {upcomingRest.map((event) => (
                        <GroupEventRow key={event.id} event={event} />
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <div className="mt-3 p-6 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
                <p className="text-gray-600 dark:text-gray-400">
                  Nothing on the calendar right now.
                </p>
                {group.lastEventLabel && (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Last event: {group.lastEventLabel}
                  </p>
                )}
                {(website || meetupUrl) && (
                  <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
                    {website && (
                      <a
                        href={website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={emptyLinkClasses}
                      >
                        Check their website
                      </a>
                    )}
                    {meetupUrl && (
                      <a
                        href={meetupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={emptyLinkClasses}
                      >
                        Check their Meetup page
                      </a>
                    )}
                  </p>
                )}
              </div>
            )}
          </section>

          {group.pastTotal > 0 && (
            <section aria-label="Past events" className="mt-8">
              {/* Collapsed, unless past events are all this group has to show. */}
              <details className="group/past" open={group.upcoming.length === 0}>
                <summary className="inline-flex items-center gap-2 cursor-pointer select-none text-lg font-semibold text-gray-900 dark:text-gray-100 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden list-none">
                  <ChevronRight
                    size={18}
                    aria-hidden="true"
                    className="text-gray-400 dark:text-gray-500 transition-transform group-open/past:rotate-90"
                  />
                  Past events{' '}
                  <span className="font-normal text-gray-500 dark:text-gray-400">
                    ({group.pastTotal})
                  </span>
                </summary>

                <ul className={`mt-3 ${eventListClasses}`}>
                  {group.past.map((event) => (
                    <GroupEventRow key={event.id} event={event} past />
                  ))}
                </ul>
                {hiddenPastCount > 0 && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    and {hiddenPastCount} more
                  </p>
                )}
              </details>
            </section>
          )}
        </div>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <FooterCredit />
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
