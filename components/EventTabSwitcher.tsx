'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

type Tab = 'all' | 'top30' | 'yourList' | 'posters' | 'news';

interface EventTabSwitcherProps {
  activeTab?: Tab;
}

export default function EventTabSwitcher({ activeTab }: EventTabSwitcherProps) {
  const searchParams = useSearchParams();

  // Build URL preserving other query params
  const buildTabUrl = (tab: Exclude<Tab, 'news'>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('tab'); // No longer using tab query param
    // `p` deep-links one poster; it means nothing on the other tabs
    params.delete('p');
    // News's own share link, search and topic; they mean nothing on the event tabs
    params.delete('s');
    params.delete('q');
    params.delete('topic');

    // Top30, Your List and Posters have their own routes
    if (tab === 'top30') {
      const queryString = params.toString();
      return `/events/top30${queryString ? `?${queryString}` : ''}`;
    }

    if (tab === 'yourList') {
      const queryString = params.toString();
      return `/events/your-list${queryString ? `?${queryString}` : ''}`;
    }

    if (tab === 'posters') {
      const queryString = params.toString();
      return `/posters${queryString ? `?${queryString}` : ''}`;
    }

    const queryString = params.toString();
    return `/events${queryString ? `?${queryString}` : ''}`;
  };

  return (
    <nav
      className="flex items-center gap-0.5 sm:gap-1 whitespace-nowrap"
      aria-label="Event feed tabs"
    >
      <Link
        href={buildTabUrl('all')}
        className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'all'
            ? 'text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        <span className="sm:hidden">All</span>
        <span className="hidden sm:inline">All Events</span>
      </Link>
      <Link
        href={buildTabUrl('top30')}
        className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'top30'
            ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        Top 30
      </Link>
      <Link
        href={buildTabUrl('yourList')}
        className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'yourList'
            ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        Your List
      </Link>
      <Link
        href={buildTabUrl('posters')}
        className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md cursor-pointer transition-colors ${
          activeTab === 'posters'
            ? 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/30'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
      >
        Posters
      </Link>
      {/* News filters are its own, so the link drops the event tabs' params */}
      <Link
        href="/news"
        className={`px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-md cursor-pointer transition-colors ${
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
