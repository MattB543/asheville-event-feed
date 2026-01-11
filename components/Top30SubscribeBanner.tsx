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
      <div className="mb-6 rounded-xl bg-[#e8f4f8] dark:bg-[#1a3a4a] border border-[#c5e4ed] dark:border-[#2a5a6a] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#c5e4ed] dark:bg-[#2a5a6a] flex items-center justify-center">
              <Bell className="w-3.5 h-3.5 text-[#2a7d9c] dark:text-[#7ec8e3]" />
            </div>
            <span className="font-medium text-gray-900 dark:text-white text-sm">
              You&apos;re subscribed to Top 30 updates
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEmailAlertsClick}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors cursor-pointer whitespace-nowrap bg-[#c5e4ed] dark:bg-[#2a5a6a] text-[#2a7d9c] dark:text-[#7ec8e3] hover:bg-[#a8d8e8] dark:hover:bg-[#3a6a7a]"
            >
              <Check className="w-3.5 h-3.5" />
              Manage
            </button>
            <button
              onClick={onCalendarSyncClick}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors cursor-pointer whitespace-nowrap bg-[#c5e4ed] dark:bg-[#2a5a6a] text-[#2a7d9c] dark:text-[#7ec8e3] hover:bg-[#a8d8e8] dark:hover:bg-[#3a6a7a]"
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
    <div className="mb-6 rounded-xl bg-[#e8f4f8] dark:bg-[#1a3a4a] border border-[#c5e4ed] dark:border-[#2a5a6a] p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="hidden sm:flex flex-shrink-0 w-10 h-10 rounded-full bg-[#c5e4ed] dark:bg-[#2a5a6a] items-center justify-center">
            <Bell className="w-5 h-5 text-[#2a7d9c] dark:text-[#7ec8e3]" />
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base">
            Stay updated on Top 30 events
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEmailAlertsClick}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer whitespace-nowrap border border-[#a8d8e8] dark:border-[#3a6a7a] text-[#2a7d9c] dark:text-[#7ec8e3] hover:bg-[#c5e4ed] dark:hover:bg-[#2a5a6a]"
          >
            <Bell className="w-4 h-4" />
            Email Alerts
          </button>
          <button
            onClick={onCalendarSyncClick}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer whitespace-nowrap border border-[#a8d8e8] dark:border-[#3a6a7a] text-[#2a7d9c] dark:text-[#7ec8e3] hover:bg-[#c5e4ed] dark:hover:bg-[#2a5a6a]"
          >
            <CalendarPlus2 className="w-4 h-4" />
            Calendar Sync
          </button>
        </div>
      </div>
    </div>
  );
}
