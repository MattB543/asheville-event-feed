'use client';

import Image from 'next/image';
import { X, CalendarPlus2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

interface Top30CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Top30CalendarModal({ isOpen, onClose }: Top30CalendarModalProps) {
  const { showToast } = useToast();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 max-w-md w-full p-6 animate-fade-in">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-[#e8f4f8] dark:bg-[#1a3a4a] flex items-center justify-center">
            <CalendarPlus2 className="w-8 h-8 text-[#2a7d9c] dark:text-[#7ec8e3]" />
          </div>
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
          Sync to Your Calendar
        </h2>
        <p className="text-gray-600 dark:text-gray-400 text-center mb-6">
          Add the Top 30 events directly to your calendar. Events update automatically.
        </p>

        <div className="space-y-3">
          <a
            href="webcal://avlgo.com/api/top30/calendar"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#2a7d9c] hover:bg-[#1f6a87] text-white font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            Apple Calendar
          </a>

          <a
            href="https://calendar.google.com/calendar/r?cid=webcal://avlgo.com/api/top30/calendar"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-[#a8d8e8] dark:border-[#3a6a7a] text-[#2a7d9c] dark:text-[#7ec8e3] font-medium hover:bg-[#e8f4f8] dark:hover:bg-[#1a3a4a] transition-colors"
          >
            <Image
              src="/google_cal.svg"
              alt="Google Calendar"
              width={20}
              height={20}
              className="w-5 h-5"
            />
            Google Calendar
          </a>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Or copy the calendar URL:</p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value="https://avlgo.com/api/top30/calendar"
              className="flex-1 px-3 py-2 text-xs bg-[#e8f4f8] dark:bg-[#1a3a4a] rounded-lg border border-[#c5e4ed] dark:border-[#2a5a6a] text-gray-600 dark:text-gray-400"
            />
            <button
              onClick={() => {
                void navigator.clipboard.writeText('https://avlgo.com/api/top30/calendar');
                showToast('URL copied!');
              }}
              className="px-3 py-2 text-xs font-medium text-[#2a7d9c] dark:text-[#7ec8e3] hover:bg-[#e8f4f8] dark:hover:bg-[#1a3a4a] rounded-lg transition-colors cursor-pointer"
            >
              Copy
            </button>
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500 text-center">
          Calendar updates every few hours
        </p>
      </div>
    </div>
  );
}
