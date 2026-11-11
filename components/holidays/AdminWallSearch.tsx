'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';

interface Result {
  id: string;
  title: string;
  startDate: string;
  venue: string;
}

/** Season editors only: find any event on the wall's two nights and add it to the wall */
// Dark for Halloween's night sky and Christmas's pine, light for Thanksgiving's paper menu
const TONES = {
  dark: {
    box: 'border-[#7a5426]/70 bg-black/40 text-[#e8cfa8]',
    input: 'text-gray-100 placeholder:text-gray-500',
    rows: 'divide-white/10',
    title: 'text-gray-100',
    meta: 'text-gray-400',
    add: 'bg-[#ff8a1f] text-[#1a0a00]',
  },
  light: {
    box: 'border-[#2a1a14]/25 bg-[#2a1a14]/[.03] text-[#8f1d2c]',
    input: 'text-[#2a1a14] placeholder:text-[#6b5a50]/80',
    rows: 'divide-[#2a1a14]/10',
    title: 'text-[#2a1a14]',
    meta: 'text-[#6b5a50]',
    add: 'bg-[#8f1d2c] text-[#fffaf0]',
  },
};

export default function AdminWallSearch({
  season,
  onWall,
  tone = 'dark',
}: {
  season: string;
  onWall: string[];
  tone?: keyof typeof TONES;
}) {
  const look = TONES[tone];
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/admin/season-picks/search?season=${season}&q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((response) =>
          response.ok ? response.json() : Promise.reject(new Error(String(response.status)))
        )
        .then((body: { results: Result[] }) => setResults(body.results))
        .catch((err: unknown) => {
          if ((err as Error).name !== 'AbortError') setError('Search failed');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, season]);

  const add = (eventId: string) =>
    startTransition(async () => {
      setError(null);
      const response = await fetch('/api/admin/season-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ season, eventId, added: true, hidden: false }),
      });
      if (!response.ok) {
        setError('Could not add that');
        return;
      }
      router.refresh();
    });

  const shown = query.trim().length < 2 ? [] : results;

  return (
    <div className={`mt-6 rounded-xl border border-dashed p-3 ${look.box}`}>
      <label className="flex items-center gap-2 text-sm">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">Find an event to add to the wall</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setError(null);
            setQuery(event.target.value);
          }}
          placeholder="Admin: find an event to add to the wall"
          className={`w-full bg-transparent text-base outline-none sm:text-sm [&::-webkit-search-cancel-button]:cursor-pointer ${look.input}`}
        />
      </label>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {shown.length > 0 && (
        <ul className={`mt-2 flex flex-col divide-y ${look.rows}`}>
          {shown.map((result) => {
            const already = onWall.includes(result.id);
            return (
              <li key={result.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-sm">
                  <span className={`block truncate font-semibold ${look.title}`}>
                    {result.title}
                  </span>
                  <span className={`block truncate text-xs ${look.meta}`}>
                    {new Date(result.startDate).toLocaleString('en-US', {
                      timeZone: 'America/New_York',
                      weekday: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {result.venue && ` · ${result.venue}`}
                  </span>
                </span>
                {already ? (
                  <span className={`shrink-0 text-xs ${look.meta}`}>On the wall</span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => add(result.id)}
                    className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold disabled:opacity-50 ${look.add}`}
                  >
                    <Plus size={13} aria-hidden="true" />
                    Add
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
