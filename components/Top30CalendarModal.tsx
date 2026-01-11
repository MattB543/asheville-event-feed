'use client';

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
          <div className="w-16 h-16 rounded-full bg-[#9E6240]/20 dark:bg-[#9E6240]/30 flex items-center justify-center">
            <CalendarPlus2 className="w-8 h-8 text-[#9E6240] dark:text-[#C4876A]" />
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
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[#9E6240] hover:bg-[#8A553A] text-white font-medium transition-colors"
          >
            Subscribe on iOS / Mac
          </a>

          <a
            href="https://calendar.google.com/calendar/r?cid=webcal://avlgo.com/api/top30/calendar"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Subscribe on Google Calendar
          </a>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Or copy the calendar URL:</p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value="https://avlgo.com/api/top30/calendar"
              className="flex-1 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"
            />
            <button
              onClick={() => {
                void navigator.clipboard.writeText('https://avlgo.com/api/top30/calendar');
                showToast('URL copied!');
              }}
              className="px-3 py-2 text-xs font-medium text-[#9E6240] dark:text-[#C4876A] hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors cursor-pointer"
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
