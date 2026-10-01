'use client';

import { useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { NEWS_TOPICS } from '@/lib/news/topics';

interface NewsSearchFormProps {
  q: string;
  topic: string;
}

/**
 * Search and the topic filter, as a plain GET form so the URL is the state:
 * results are shareable and work without JavaScript. Picking a topic submits
 * straight away. A full navigation on purpose - the page is uncached, and a
 * soft one could reuse the router's copy of the same route.
 */
export default function NewsSearchForm({ q, topic }: NewsSearchFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action="/news"
      method="get"
      role="search"
      className="flex gap-2"
      onSubmit={(event) => {
        // The native submit, minus empty fields in the URL
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const params = new URLSearchParams();
        for (const key of ['q', 'topic']) {
          const value = data.get(key);
          if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
        }
        const query = params.toString();
        window.location.assign(query ? `/news?${query}` : '/news');
      }}
    >
      <label className="relative flex-1 min-w-0">
        <span className="sr-only">Search the news</span>
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={200}
          placeholder="Search the news"
          enterKeyHint="search"
          className="h-9 sm:h-10 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
      </label>

      <label className="relative shrink-0">
        <span className="sr-only">Topic</span>
        <select
          name="topic"
          defaultValue={topic}
          onChange={() => formRef.current?.requestSubmit()}
          className={`h-9 sm:h-10 max-w-[9.5rem] sm:max-w-none appearance-none rounded-lg border bg-white dark:bg-gray-900 pl-3 pr-8 text-sm cursor-pointer focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${
            topic
              ? 'border-brand-500 text-brand-700 dark:text-brand-300'
              : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'
          }`}
        >
          <option value="">All topics</option>
          {NEWS_TOPICS.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
      </label>
    </form>
  );
}
