'use client';

import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import IntentLink from '@/components/IntentLink';

type Tab = 'all' | 'top30' | 'groups' | 'news' | 'parking';

interface EventTabSwitcherProps {
  activeTab?: Tab;
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
  // Groups and News link to their own plain routes (see below); only the event tabs carry params
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
    // Content-width tabs: 36px tall below lg (touch), the original 32px at lg+
    <nav
      className="flex items-center gap-0.5 sm:gap-1 whitespace-nowrap"
      aria-label="Event feed tabs"
    >
      <EventsMenu
        activeTab={activeTab}
        allHref={buildTabUrl('all')}
        top30Href={buildTabUrl('top30')}
      />
      {/* Plain /groups: the feed's filter params mean nothing in the directory.
          /events, /groups and /news are dynamic, so they prefetch on hover, not on sight */}
      <IntentLink href="/groups" className={tabClass(activeTab === 'groups')}>
        Groups
      </IntentLink>
      {/* News filters are its own, so the link drops the event tabs' params */}
      <IntentLink href="/news" className={tabClass(activeTab === 'news')}>
        News
      </IntentLink>
      <Link href="/parking" className={tabClass(activeTab === 'parking')}>
        Parking
      </Link>
    </nav>
  );
}

const TAB_BASE =
  'flex items-center min-h-9 px-2.5 sm:px-3 lg:min-h-0 lg:py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors';
const TAB_IDLE =
  'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50';

function tabClass(active: boolean, activeTone = 'brand'): string {
  if (!active) return `${TAB_BASE} ${TAB_IDLE}`;
  return activeTone === 'gray'
    ? `${TAB_BASE} text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800`
    : `${TAB_BASE} text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30`;
}

/** Desktop hover (or keyboard focus) opens the menu; the trigger itself still links to /events. */
const HOVER_QUERY = '(pointer: fine) and (min-width: 1024px)';

/**
 * "Events" with All events / Top 30 underneath. At lg+ with a mouse the menu
 * opens on hover and the label is a plain link to the feed; on touch the label
 * toggles the menu, since there is no hover to reveal Top 30.
 */
function EventsMenu({
  activeTab,
  allHref,
  top30Href,
}: {
  activeTab?: Tab;
  allHref: string;
  top30Href: string;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const isEvents = activeTab === 'all' || activeTab === 'top30';
  const items = [
    { href: allHref, label: 'All events', active: activeTab === 'all' },
    { href: top30Href, label: 'Top 30', active: activeTab === 'top30' },
  ];

  return (
    <div ref={rootRef} className="group/events relative">
      <IntentLink
        href={allHref}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={(event) => {
          if (window.matchMedia(HOVER_QUERY).matches) return;
          event.preventDefault();
          setIsOpen((open) => !open);
        }}
        className={`${tabClass(isEvents, activeTab === 'all' ? 'gray' : 'brand')} gap-1`}
      >
        Events
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </IntentLink>
      {/* pt-1 bridges the gap so the pointer can travel from the tab into the menu. Its links
          keep viewport prefetch: they're display:none until the menu is opened */}
      <div
        id={menuId}
        className={`absolute left-0 top-full z-50 pt-1 ${
          isOpen ? 'block' : 'hidden'
        } lg:group-hover/events:block pointer-fine:lg:group-focus-within/events:block`}
      >
        <ul className="min-w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {items.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                onClick={() => setIsOpen(false)}
                aria-current={item.active ? 'page' : undefined}
                className={`flex min-h-10 items-center px-3 text-sm lg:min-h-9 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  item.active
                    ? 'font-semibold text-gray-900 dark:text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
