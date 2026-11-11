'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { buttonClass, buttonTones } from '@/components/camps/admin/useCampAdminAction';
import { BannerBar, BannerIcon, bannerStyle } from '@/components/seasonal/SeasonalLinks';
import {
  BANNER_MAX,
  DEFAULT_SEASONS,
  SHORT_MAX,
  currentSeason,
  seasonBanner,
  type Season,
  type SeasonSettings,
} from '@/lib/seasons';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** The form keeps full dates for the pickers, and a box for "every year" */
interface Form {
  start: string;
  end: string;
  everyYear: boolean;
  short: string;
  banner: string;
  enabled: boolean;
  color: string;
  fade: boolean;
  icon: string | null;
}

function toForm(season: SeasonSettings, year: number): Form {
  const everyYear = season.start.length === 5;
  if (!everyYear) return { ...season, everyYear };
  // An every-year season that runs across Jan 1 ends the next year
  const endYear = season.start > season.end ? year + 1 : year;
  return {
    ...season,
    everyYear,
    start: `${year}-${season.start}`,
    end: `${endYear}-${season.end}`,
  };
}

function toSettings(form: Form): SeasonSettings {
  const cut = (date: string) => (form.everyYear ? date.slice(5) : date);
  const { short, banner, enabled, color, fade, icon } = form;
  return { start: cut(form.start), end: cut(form.end), short, banner, enabled, color, fade, icon };
}

const sameSettings = (a: SeasonSettings, b: SeasonSettings) =>
  a.start === b.start &&
  a.end === b.end &&
  a.short === b.short &&
  a.banner === b.banner &&
  a.enabled === b.enabled &&
  a.color === b.color &&
  a.fade === b.fade &&
  a.icon === b.icon;

/** The days of `year` the season covers, as [first, last] day indexes from Jan 1 */
function segments(form: Form, year: number): Array<[number, number]> {
  const jan1 = Date.UTC(year, 0, 1);
  const days = (Date.UTC(year + 1, 0, 1) - jan1) / DAY_MS;
  const index = (date: string) => (Date.parse(`${date}T00:00:00Z`) - jan1) / DAY_MS;
  const { start, end } = toSettings(form);
  if (form.everyYear) {
    const s = index(`${year}-${start}`);
    const e = index(`${year}-${end}`);
    if (Number.isNaN(s) || Number.isNaN(e)) return [];
    return s <= e
      ? [[s, e]]
      : [
          [s, days - 1],
          [0, e],
        ];
  }
  const s = Math.max(index(start), 0);
  const e = Math.min(index(end), days - 1);
  return Number.isNaN(s) || Number.isNaN(e) || s > e ? [] : [[s, e]];
}

/** "Oct 1 – Oct 31", with the year on a one-year season */
function dateRange(form: Form): string {
  const day = (date: string) => {
    const [, m, d] = date.split('-').map(Number);
    return m && d ? `${MONTHS[m - 1]} ${d}` : '?';
  };
  return `${day(form.start)} – ${day(form.end)}${form.everyYear ? '' : `, ${form.end.slice(0, 4)}`}`;
}

function statusOf(form: Form, running: boolean, today: string): string | null {
  if (!form.enabled) return 'Off';
  if (running) return 'Running now';
  if (!form.everyYear && form.end < today) return 'Ended';
  return null;
}

const inputClass =
  'rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:[color-scheme:dark]';

/** A year's timeline of every season, and a form for each one's dates and banner */
export default function SeasonAdmin({ seasons, today }: { seasons: Season[]; today: string }) {
  const year = Number(today.slice(0, 4));
  const [saved, setSaved] = useState<SeasonSettings[]>(seasons);
  const [forms, setForms] = useState(() => seasons.map((s) => toForm(s, year)));
  const running = currentSeason(
    seasons.map((s, i) => ({ ...s, ...saved[i] })),
    today
  )?.key;

  const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
  const monthStart = (m: number) => (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / DAY_MS;

  const setForm = (i: number, change: Partial<Form>) =>
    setForms((all) => all.map((f, j) => (j === i ? { ...f, ...change } : f)));

  // The season's name, dates and status, shown over its bar on hover or focus
  const tip = (season: Season) => {
    const i = seasons.indexOf(season);
    const status = statusOf(forms[i], season.key === running, today);
    return (
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-gray-100 dark:text-gray-900"
      >
        {season.label}: {dateRange(forms[i])}
        {status && <span className="ml-1.5 opacity-70">{status}</span>}
      </span>
    );
  };

  // Drawn last-first, so where two overlap the one that wins is on top
  const drawn = [...seasons].reverse().flatMap((season) => {
    const i = seasons.indexOf(season);
    const look = bannerStyle(forms[i]);
    const faded = forms[i].enabled ? '' : 'opacity-30';
    return segments(forms[i], year).map(([s, e]) => ({ season, s, e, look, faded }));
  });

  // Half a year to a row, so short seasons get room: Jan-Jun, then Jul-Dec
  const halves = [
    { from: 0, to: monthStart(6), months: [0, 1, 2, 3, 4, 5] },
    { from: monthStart(6), to: daysInYear, months: [6, 7, 8, 9, 10, 11] },
  ];

  return (
    <>
      <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        {halves.map(({ from, to, months }) => {
          const pct = (day: number) => `${((day - from) / (to - from)) * 100}%`;
          // Each season's part of this half
          const here = drawn.flatMap((d) => {
            const s = Math.max(d.s, from);
            const e = Math.min(d.e, to - 1);
            return s > e ? [] : [{ ...d, s, e }];
          });
          return (
            <div key={from}>
              <div className="relative h-5 text-xs text-gray-500 dark:text-gray-400">
                {months.map((m) => (
                  <span
                    key={m}
                    className="absolute top-0 pl-1"
                    style={{ left: pct(monthStart(m)) }}
                  >
                    {MONTHS[m]}
                  </span>
                ))}
              </div>
              <div className="relative mt-1 h-10 rounded-md bg-gray-100 dark:bg-gray-800">
                {months.slice(1).map((m) => (
                  <span
                    key={m}
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-gray-200 dark:bg-gray-700"
                    style={{ left: pct(monthStart(m)) }}
                  />
                ))}
                {here.map(({ season, s, e, look, faded }) => (
                  <a
                    key={`${season.key}-${s}`}
                    href={`#season-${season.key}`}
                    aria-label={season.label}
                    className={`group absolute inset-y-1 flex items-center justify-center rounded-sm text-sm ${faded}`}
                    // Never narrower than its icon, and kept inside the row: a short season
                    // shows a little longer than it really is
                    style={{
                      ...look,
                      left: `clamp(0px, ${pct(s)}, calc(100% - 1.75rem))`,
                      width: `max(${pct(from + e - s + 1)}, 1.75rem)`,
                    }}
                  >
                    <BannerIcon
                      season={{ key: season.key, icon: forms[seasons.indexOf(season)].icon }}
                    />
                    {tip(season)}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 space-y-8">
        {seasons.map((season, i) => (
          <SeasonRow
            key={season.key}
            season={season}
            form={forms[i]}
            saved={saved[i]}
            running={season.key === running}
            onChange={(change) => setForm(i, change)}
            onSaved={(settings) => {
              setSaved((all) => all.map((s, j) => (j === i ? settings : s)));
              setForm(i, toForm(settings, year));
            }}
            year={year}
          />
        ))}
      </div>
    </>
  );
}

function SeasonRow({
  season,
  form,
  saved,
  running,
  onChange,
  onSaved,
  year,
}: {
  season: Season;
  form: Form;
  saved: SeasonSettings;
  running: boolean;
  onChange: (change: Partial<Form>) => void;
  onSaved: (settings: SeasonSettings) => void;
  year: number;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = sending || refreshing;
  const defaults = DEFAULT_SEASONS.find((s) => s.key === season.key)!;
  const changed = !sameSettings(toSettings(form), saved);
  const preview = { ...season, ...toSettings(form) };
  let previewText = form.banner;
  try {
    previewText = seasonBanner(preview);
  } catch {
    // A half-typed date can't name the last day yet
  }
  const edited = !sameSettings(saved, defaults);

  const send = async (settings: SeasonSettings, reset: boolean) => {
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: season.key, ...(reset ? { reset } : settings) }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? `Could not save that (${response.status})`);
        return;
      }
      const json = (await response.json().catch(() => null)) as {
        settings?: SeasonSettings | null;
      } | null;
      onSaved(json?.settings ?? settings);
      // The header's banner on this page follows too
      startTransition(() => router.refresh());
    } catch {
      setError('Could not reach the server');
    } finally {
      setSending(false);
    }
  };

  const text = (name: 'short' | 'banner') => ({
    value: form[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [name]: e.target.value }),
  });

  const counter = (value: string, max: number) => (
    <span
      className={`text-xs tabular-nums ${value.length > max - 10 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}
    >
      {value.length}/{max}
    </span>
  );
  const rowLabel = 'pt-1.5 text-sm font-medium text-gray-500 dark:text-gray-400';

  return (
    <form
      id={`season-${season.key}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send(toSettings(form), false);
      }}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      {/* The banner itself leads the card, as visitors will see it */}
      <div className={form.enabled ? '' : 'opacity-40 grayscale'}>
        <BannerBar season={preview} banner={previewText} />
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="flex items-center gap-1.5 text-lg font-bold text-gray-900 dark:text-gray-100">
            {season.label}
            <Link
              href={season.href}
              aria-label={`Open the ${season.label} page`}
              className="rounded text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
            >
              <ExternalLink size={16} aria-hidden="true" />
            </Link>
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">{dateRange(form)}</span>
          {running && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
              Running now
            </span>
          )}
          <div className="ml-auto flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              {form.enabled ? 'On' : 'Off'}
              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                aria-label={`${season.label} on`}
                onClick={() => onChange({ enabled: !form.enabled })}
                className={`relative h-6 w-11 cursor-pointer rounded-full transition-colors ${form.enabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-700'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-5' : ''}`}
                />
              </button>
            </label>
          </div>
        </div>
        {!form.enabled && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Off: no banner anywhere, and the page stays closed.
          </p>
        )}

        <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[7rem_1fr]">
          <span className={rowLabel}>Dates</span>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="date"
              aria-label="Starts"
              value={form.start}
              onChange={(e) => onChange({ start: e.target.value })}
              className={`${inputClass} w-36`}
            />
            <span>to</span>
            <input
              type="date"
              aria-label="Ends"
              value={form.end}
              onChange={(e) => onChange({ end: e.target.value })}
              className={`${inputClass} w-36`}
            />
            <label className="ml-1 inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={form.everyYear}
                onChange={(e) => onChange({ everyYear: e.target.checked })}
                className="h-4 w-4"
              />
              Every year
            </label>
          </div>

          <label htmlFor={`${season.key}-color`} className={rowLabel}>
            Colour
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              id={`${season.key}-color`}
              type="color"
              value={form.color}
              onChange={(e) => onChange({ color: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-950"
            />
            <label className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.fade}
                onChange={(e) => onChange({ fade: e.target.checked })}
                className="h-4 w-4"
              />
              Gradient
            </label>
            {(form.color !== defaults.color || form.fade !== defaults.fade) && (
              <button
                type="button"
                onClick={() => onChange({ color: defaults.color, fade: defaults.fade })}
                className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              >
                Reset colour
              </button>
            )}
          </div>

          <label htmlFor={`${season.key}-icon`} className={rowLabel}>
            Icon
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="relative">
              <input
                id={`${season.key}-icon`}
                value={form.icon ?? ''}
                onChange={(e) => onChange({ icon: e.target.value.trim() || null })}
                className={`${inputClass} w-12 text-center text-base`}
              />
              {/* Empty means the drawn icon, so it shows in the box like a placeholder */}
              {!form.icon && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-gray-700 dark:text-gray-300">
                  <BannerIcon season={{ key: season.key, icon: null }} />
                </span>
              )}
            </span>
            {form.icon && (
              <button
                type="button"
                onClick={() => onChange({ icon: null })}
                className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              >
                Reset icon
              </button>
            )}
          </div>

          <label htmlFor={`${season.key}-banner`} className={rowLabel}>
            Banner
          </label>
          <div>
            <input
              id={`${season.key}-banner`}
              {...text('banner')}
              maxLength={BANNER_MAX}
              className={`${inputClass} w-full py-1.5`}
            />
            <div className="mt-1 flex justify-between gap-2 text-xs text-gray-400">
              <span>
                <code>{'{end}'}</code> becomes the last day
              </span>
              {counter(form.banner, BANNER_MAX)}
            </div>
          </div>

          <label htmlFor={`${season.key}-short`} className={rowLabel}>
            On phones
          </label>
          <div>
            <input
              id={`${season.key}-short`}
              {...text('short')}
              maxLength={SHORT_MAX}
              className={`${inputClass} w-full py-1.5`}
            />
            <div className="mt-1 flex justify-end">{counter(form.short, SHORT_MAX)}</div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={busy || !changed}
            className={`${buttonClass} ${buttonTones.primary}`}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {changed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange(toForm(saved, year))}
              className={`${buttonClass} ${buttonTones.plain}`}
            >
              Cancel
            </button>
          )}
          {edited && !changed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(defaults, true)}
              className={`${buttonClass} ${buttonTones.plain}`}
            >
              Reset to default
            </button>
          )}
          {changed && !error && (
            <span className="text-sm text-amber-700 dark:text-amber-400">Unsaved changes</span>
          )}
          {error && (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
