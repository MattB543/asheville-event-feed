'use client';

import { Suspense } from 'react';
import { CalendarDays, Heart, Music, Tent, Trophy, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import IntentLink from '@/components/IntentLink';
import HeaderMenu, { type HeaderMenuItem } from '@/components/HeaderMenu';
import { useSeasonalMenuItem } from '@/components/seasonal/SeasonalLinks';

export type HeaderTab =
  | 'all'
  | 'top30'
  | 'yourList'
  | 'groups'
  | 'plan'
  | 'news'
  | 'playlist'
  | 'camps'
  | 'parking';

interface EventTabSwitcherProps {
  activeTab?: HeaderTab;
}

/**
 * useSearchParams() needs its own Suspense boundary: without one, a statically
 * rendered page bails out to client-side rendering at the root loading boundary
 * and ships no HTML content at all. The fallback (what the static HTML holds)
 * is the same tabs, just without carrying the current query over.
 */
export default function EventTabSwitcher(props: EventTabSwitcherProps) {
  return (
    <Suspense fallback={<Tabs {...props} query="" />}>
      <TabsWithQuery {...props} />
    </Suspense>
  );
}

function TabsWithQuery(props: EventTabSwitcherProps) {
  const searchParams = useSearchParams();
  return <Tabs {...props} query={searchParams.toString()} />;
}

function Tabs({ activeTab, query }: EventTabSwitcherProps & { query: string }) {
  // Build URL preserving other query params
  // Disaster Plan and News link to their own plain routes (see below); only the event tabs carry params
  const buildTabUrl = (tab: 'all' | 'top30') => {
    const params = new URLSearchParams(query);
    params.delete('tab'); // No longer using tab query param
    // `p` deep-links one poster; it means nothing on the other tabs
    params.delete('p');
    // News's own share link, search and topic; they mean nothing on the event tabs
    params.delete('s');
    params.delete('q');
    params.delete('topic');

    // Top30 has its own route
    if (tab === 'top30') {
      const queryString = params.toString();
      return `/events/top30${queryString ? `?${queryString}` : ''}`;
    }

    const queryString = params.toString();
    return `/events${queryString ? `?${queryString}` : ''}`;
  };

  return (
    // Content-width tabs: 36px tall below lg (touch), the original 32px at lg+.
    // Below sm the padding is 6px and the text 13px so five tabs, "Disaster Plan" the
    // widest, fit a 360px phone without wrapping (~320 of its 336px; at 14px/8px it was ~358)
    <nav className="flex items-center sm:gap-1 whitespace-nowrap" aria-label="Event feed tabs">
      <EventsMenu
        activeTab={activeTab}
        allHref={buildTabUrl('all')}
        top30Href={buildTabUrl('top30')}
      />
      {/* Plain /plan: the feed's filter params mean nothing on the letter.
          /events, /plan and /news are dynamic, so they prefetch on hover, not on sight */}
      <IntentLink href="/plan" className={tabClass(activeTab === 'plan')}>
        Disaster Plan
      </IntentLink>
      {/* News filters are its own, so the link drops the event tabs' params */}
      <IntentLink href="/news" className={tabClass(activeTab === 'news')}>
        News
      </IntentLink>
      <Link href="/parking" className={tabClass(activeTab === 'parking')}>
        Parking
      </Link>
      {/* No page of its own, so the label only opens the menu. Right-aligned: at the end of
          the row, a left-aligned menu would run off a 360px phone */}
      <HeaderMenu
        label="More"
        className={tabClass(activeTab === 'playlist' || activeTab === 'camps')}
        align="right"
        items={[
          { href: '/playlist', label: 'Playlist', icon: Music, active: activeTab === 'playlist' },
          { href: '/camps', label: 'Summer camps', icon: Tent, active: activeTab === 'camps' },
        ]}
      />
    </nav>
  );
}

const TAB_BASE =
  'flex items-center min-h-9 px-1.5 sm:px-3 lg:min-h-0 lg:py-1.5 text-[13px] sm:text-sm font-medium rounded-md cursor-pointer transition-colors';
const TAB_IDLE =
  'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50';

function tabClass(active: boolean, activeTone = 'brand'): string {
  if (!active) return `${TAB_BASE} ${TAB_IDLE}`;
  return activeTone === 'gray'
    ? `${TAB_BASE} text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800`
    : `${TAB_BASE} text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30`;
}

/** "Events" with All events / Top events / Your feed / Groups underneath; the label links to the feed */
function EventsMenu({
  activeTab,
  allHref,
  top30Href,
}: {
  activeTab?: HeaderTab;
  allHref: string;
  top30Href: string;
}) {
  // Groups lives only in this menu, so the directory lights up Events too
  const isEvents =
    activeTab === 'all' ||
    activeTab === 'top30' ||
    activeTab === 'yourList' ||
    activeTab === 'groups';
  const items: HeaderMenuItem[] = [
    { href: allHref, label: 'All events', icon: CalendarDays, active: activeTab === 'all' },
    { href: top30Href, label: 'Top events', icon: Trophy, active: activeTab === 'top30' },
    // Plain: the feed's filter params don't apply to a list of favorites
    {
      href: '/events/your-list',
      label: 'Your feed',
      icon: Heart,
      active: activeTab === 'yourList',
    },
    // Plain: the feed's filter params mean nothing in the directory
    { href: '/groups', label: 'Groups', icon: Users, active: activeTab === 'groups' },
  ];
  const seasonal = useSeasonalMenuItem();
  if (seasonal) items.push({ ...seasonal, active: false });

  return (
    <HeaderMenu
      label="Events"
      href={allHref}
      className={tabClass(isEvents, activeTab === 'all' ? 'gray' : 'brand')}
      items={items}
    />
  );
}
