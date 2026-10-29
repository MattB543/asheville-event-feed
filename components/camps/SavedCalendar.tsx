'use client';

import { useState } from 'react';
import { CalendarPlus, Check, Copy } from 'lucide-react';
import {
  calendarFeedUrl,
  retryCalendarSync,
  subscribeSavedCamps,
  useSavedCamps,
} from './savedCamps';

const linkClasses =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-medium cursor-pointer text-gray-700 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/**
 * The saved-camps calendar (01 §4.4): one subscribe link per browser. Registration dates posted
 * later reach the parent's calendar on their own, and saving or unsaving a camp updates it.
 */
export default function SavedCalendar() {
  const { ids, token, sync } = useSavedCamps();
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  if (ids.length === 0 && !token) return null;

  async function subscribe() {
    setStatus('working');
    try {
      await subscribeSavedCamps();
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this calendar link:', url);
    }
  }

  if (!token) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <button
          type="button"
          disabled={status === 'working'}
          onClick={() => void subscribe()}
          className={linkClasses}
        >
          <CalendarPlus size={15} aria-hidden="true" />
          {status === 'working' ? 'Making your calendar…' : 'Put saved camps’ dates in my calendar'}
        </button>
        {status === 'error' && <span role="alert">That didn’t work. Please try again.</span>}
      </div>
    );
  }

  const https = calendarFeedUrl(token);
  const webcal = https.replace(/^https?:\/\//, 'webcal://');
  return (
    // w-full: a line of its own when it sits in a row of buttons (the directory's saved box)
    <div className="w-full space-y-2 text-sm text-gray-600 dark:text-gray-400">
      <p>
        Your saved camps’ registration dates, as a calendar you can subscribe to. Saving or unsaving
        a camp updates it.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={webcal} className={linkClasses}>
          <CalendarPlus size={15} aria-hidden="true" />
          Apple / Outlook
        </a>
        <a
          href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClasses}
        >
          <CalendarPlus size={15} aria-hidden="true" />
          Google Calendar
        </a>
        <button type="button" onClick={() => void copy(https)} className={linkClasses}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {sync === 'failed' && (
        <p role="alert" className="text-amber-800 dark:text-amber-200">
          Couldn’t update your calendar with your latest changes.{' '}
          <button
            type="button"
            onClick={retryCalendarSync}
            className="font-medium underline underline-offset-2 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Try again
          </button>
        </p>
      )}
      {sync === 'pending' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Updating your calendar…</p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Google Calendar checks for changes every few hours to a day; Apple and Outlook more often.
        The list lives in this browser: save camps here to change it.
      </p>
    </div>
  );
}
