'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

type Tab = 'all' | 'top30' | 'groups' | 'news';

interface EventTabSwitcherProps {
  activeTab?: Tab;
}

export default function EventTabSwitcher({ activeTab }: EventTabSwitcherProps) {
  const searchParams = useSearchParams();

  // Build URL preserving other query params
  // Groups and News link to their own plain routes (see below); only the event tabs carry params
  const buildTabUrl = (tab: 'all' | 'top30') => {
    const params = new URLSearchParams(searchParams.toString());
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
      <Link
        href={buildTabUrl('all')}
        className={`flex items-center min-h-9 px-2.5 sm:px-3 lg:min-h-0 lg:py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'all'
            ? 'text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        All Events
      </Link>
      <Link
        href={buildTabUrl('top30')}
        className={`flex items-center min-h-9 px-2.5 sm:px-3 lg:min-h-0 lg:py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'top30'
            ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        Top 30
      </Link>
      {/* Plain /groups: the feed's filter params mean nothing in the directory */}
      <Link
        href="/groups"
        className={`flex items-center min-h-9 px-2.5 sm:px-3 lg:min-h-0 lg:py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'groups'
            ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        Groups
      </Link>
      {/* News filters are its own, so the link drops the event tabs' params */}
      <Link
        href="/news"
        className={`flex items-center min-h-9 px-2.5 sm:px-3 lg:min-h-0 lg:py-1.5 text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'news'
            ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        News
      </Link>
    </nav>
  );
}
