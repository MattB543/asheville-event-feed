'use client';

import { Bell, Check } from 'lucide-react';
import { type Top30SubscriptionType } from '@/lib/newsletter/types';

interface Top30SubscribeBannerProps {
  currentSubscription: Top30SubscriptionType;
  onSubscribeClick: () => void;
}

export default function Top30SubscribeBanner({
  currentSubscription,
  onSubscribeClick,
}: Top30SubscribeBannerProps) {
  const isSubscribed = currentSubscription !== 'none';

  if (isSubscribed) {
    // Compact single-line version for subscribed users
    return (
      <div className="mb-6 rounded-xl bg-[#9E6240]/10 dark:bg-[#9E6240]/20 border border-[#9E6240]/30 dark:border-[#9E6240]/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#9E6240]/20 dark:bg-[#9E6240]/30 flex items-center justify-center">
              <Bell className="w-3.5 h-3.5 text-[#9E6240] dark:text-[#C4876A]" />
            </div>
            <span className="font-medium text-gray-900 dark:text-white text-sm">
              You&apos;re subscribed to Top 30 updates
            </span>
          </div>
          <button
            onClick={onSubscribeClick}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-xs transition-colors cursor-pointer whitespace-nowrap bg-[#9E6240]/20 dark:bg-[#9E6240]/30 text-[#7A4D32] dark:text-[#C4876A] hover:bg-[#9E6240]/30 dark:hover:bg-[#9E6240]/40"
          >
            <Check className="w-3.5 h-3.5" />
            Manage
          </button>
        </div>
      </div>
    );
  }

  // Full version for non-subscribed users
  return (
    <div className="mb-6 rounded-xl bg-[#9E6240]/10 dark:bg-[#9E6240]/20 border border-[#9E6240]/30 dark:border-[#9E6240]/40 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#9E6240]/20 dark:bg-[#9E6240]/30 flex items-center justify-center">
            <Bell className="w-5 h-5 text-[#9E6240] dark:text-[#C4876A]" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base">
              Get notified when new events hit the Top 30
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              Be first to know about the most unique events in Asheville
            </p>
          </div>
        </div>
        <button
          onClick={onSubscribeClick}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer whitespace-nowrap bg-[#9E6240] hover:bg-[#8A553A] text-white"
        >
          <Bell className="w-4 h-4" />
          Get Notified
        </button>
      </div>
    </div>
  );
}
