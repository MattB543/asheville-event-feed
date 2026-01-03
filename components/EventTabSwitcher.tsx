'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface EventTabSwitcherProps {
  activeTab: 'all' | 'top30' | 'yourList';
}

export default function EventTabSwitcher({ activeTab }: EventTabSwitcherProps) {
  const searchParams = useSearchParams();

  // Build URL preserving other query params
  const buildTabUrl = (tab: 'all' | 'top30' | 'yourList') => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('tab'); // No longer using tab query param

    // Top30 and Your List have their own routes
    if (tab === 'top30') {
      const queryString = params.toString();
      return `/events/top30${queryString ? `?${queryString}` : ''}`;
    }

    if (tab === 'yourList') {
      const queryString = params.toString();
      return `/events/your-list${queryString ? `?${queryString}` : ''}`;
    }

    const queryString = params.toString();
    return `/events${queryString ? `?${queryString}` : ''}`;
  };

  return (
    <nav className="flex items-center gap-0.5 sm:gap-1" aria-label="Event feed tabs">
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
    </nav>
  );
}
