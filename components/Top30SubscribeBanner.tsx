'use client';

import { Bell, Check, CalendarPlus2 } from 'lucide-react';
import { type Top30SubscriptionType } from '@/lib/newsletter/types';

interface Top30SubscribeBannerProps {
  currentSubscription: Top30SubscriptionType;
  onEmailAlertsClick: () => void;
  onCalendarSyncClick: () => void;
}

export default function Top30SubscribeBanner({
  currentSubscription,
  onEmailAlertsClick,
  onCalendarSyncClick,
}: Top30SubscribeBannerProps) {
  const isSubscribed = currentSubscription !== 'none';

  if (isSubscribed) {
    // Compact single-line version for subscribed users
    return (
      <div className="mb-6 rounded-xl bg-secondary-200/50 dark:bg-secondary-800/30 border border-secondary-300 dark:border-secondary-700 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-secondary-300/50 dark:bg-secondary-700/50 flex items-center justify-center">
              <Bell className="w-3.5 h-3.5 text-secondary-700 dark:text-secondary-300" />
            </div>
            <span className="font-medium text-gray-900 dark:text-white text-sm">
              You&apos;re subscribed to Top 30 updates
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEmailAlertsClick}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors cursor-pointer whitespace-nowrap bg-secondary-300/50 dark:bg-secondary-700/50 text-secondary-800 dark:text-secondary-200 hover:bg-secondary-300 dark:hover:bg-secondary-700"
            >
              <Check className="w-3.5 h-3.5" />
              Manage
            </button>
            <button
              onClick={onCalendarSyncClick}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors cursor-pointer whitespace-nowrap bg-secondary-300/50 dark:bg-secondary-700/50 text-secondary-800 dark:text-secondary-200 hover:bg-secondary-300 dark:hover:bg-secondary-700"
            >
              <CalendarPlus2 className="w-3.5 h-3.5" />
              Calendar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Full version for non-subscribed users
  return (
    <div className="mb-6 rounded-xl bg-secondary-200/50 dark:bg-secondary-800/30 border border-secondary-300 dark:border-secondary-700 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-secondary-300/50 dark:bg-secondary-700/50 flex items-center justify-center">
            <Bell className="w-5 h-5 text-secondary-700 dark:text-secondary-300" />
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base">
            Stay updated on Top 30 events
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEmailAlertsClick}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer whitespace-nowrap border border-secondary-400 dark:border-secondary-600 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800"
          >
            <Bell className="w-4 h-4" />
            Email Alerts
          </button>
          <button
            onClick={onCalendarSyncClick}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer whitespace-nowrap border border-secondary-400 dark:border-secondary-600 text-secondary-700 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800"
          >
            <CalendarPlus2 className="w-4 h-4" />
            Calendar Sync
          </button>
        </div>
      </div>
    </div>
  );
}
