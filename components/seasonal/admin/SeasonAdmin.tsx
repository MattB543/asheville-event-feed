'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
// Shorter than this, a season's bar is too thin for its emoji, which sits on a pin above it
const PIN_DAYS = 12;

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
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300';

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
  const pct = (day: number) => `${(day / daysInYear) * 100}%`;
  const monthStart = (m: number) => (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
  const todayIndex = (Date.parse(`${today}T00:00:00Z`) - Date.UTC(year, 0, 1)) / DAY_MS;

  const setForm = (i: number, change: Partial<Form>) =>
    setForms((all) => all.map((f, j) => (j === i ? { ...f, ...change } : f)));

  // The season's name, dates and status, shown over its bar or pin on hover or focus
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
    return segments(forms[i], year).map(([s, e]) => ({
      season,
      s,
      e,
      look,
      faded,
      pin: e - s + 1 < PIN_DAYS,
    }));
  });

  return (
    <>
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="relative h-5 text-xs text-gray-500 dark:text-gray-400">
          {MONTHS.map((month, m) => (
            <span key={month} className="absolute top-0 pl-1" style={{ left: pct(monthStart(m)) }}>
              <span className="hidden sm:inline">{month}</span>
              <span className="sm:hidden">{month[0]}</span>
            </span>
          ))}
        </div>
        {drawn.some((d) => d.pin) && (
          <div className="relative mt-1 h-8">
            {drawn
              .filter((d) => d.pin)
              .map(({ season, s, e, look, faded }) => (
                <a
                  key={`${season.key}-${s}`}
                  href={`#season-${season.key}`}
                  aria-label={season.label}
                  className={`group absolute bottom-1 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full text-sm shadow ring-2 ring-white dark:ring-gray-900 ${faded}`}
                  style={{ ...look, left: pct((s + e + 1) / 2) }}
                >
                  <BannerIcon
                    season={{ key: season.key, icon: forms[seasons.indexOf(season)].icon }}
                  />
                  {tip(season)}
                </a>
              ))}
          </div>
        )}
        <div className="relative mt-1 h-10 rounded-md bg-gray-100 dark:bg-gray-800">
          {MONTHS.slice(1).map((month, m) => (
            <span
              key={month}
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-gray-200 dark:bg-gray-700"
              style={{ left: pct(monthStart(m + 1)) }}
            />
          ))}
          {drawn.map(({ season, s, e, look, faded, pin }) => (
            <a
              key={`${season.key}-${s}`}
              href={`#season-${season.key}`}
              aria-label={season.label}
              className={`group absolute inset-y-1 flex min-w-1 items-center justify-center rounded-sm text-sm ${faded}`}
              style={{ ...look, left: pct(s), width: pct(e - s + 1) }}
            >
              {!pin && (
                <BannerIcon
                  season={{ key: season.key, icon: forms[seasons.indexOf(season)].icon }}
                />
              )}
              {!pin && tip(season)}
            </a>
          ))}
        </div>
        <div className="relative h-5">
          <span
            className="absolute top-1 -translate-x-1/2 rounded bg-red-500 px-1.5 text-xs font-semibold text-white"
            style={{ left: pct(todayIndex) }}
          >
            Today
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-4">
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
      onSaved(settings);
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

  return (
    <form
      id={`season-${season.key}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send(toSettings(form), false);
      }}
      className="scroll-mt-24 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{season.label}</h2>
        <Link
          href={season.href}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          {season.href}
        </Link>
        {running && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
            Running now
          </span>
        )}
        <label className="ml-auto inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
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

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
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

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
        <div>
          <label htmlFor={`${season.key}-color`} className={labelClass}>
            Banner colour
          </label>
          <div className="mt-1 flex items-center gap-2 text-sm">
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
        </div>
        <div>
          <label htmlFor={`${season.key}-icon`} className={labelClass}>
            Banner icon
          </label>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="relative">
              <input
                id={`${season.key}-icon`}
                value={form.icon ?? ''}
                onChange={(e) => onChange({ icon: e.target.value.trim() || null })}
                className={`${inputClass} w-16 text-center text-base`}
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
        </div>
      </div>

      <label className={`${labelClass} mt-3`}>
        Banner
        <input
          {...text('banner')}
          maxLength={BANNER_MAX}
          className={`${inputClass} mt-1 w-full py-1.5`}
        />
      </label>

      <label className={`${labelClass} mt-3`}>
        Banner on phones
        <input
          {...text('short')}
          maxLength={SHORT_MAX}
          className={`${inputClass} mt-1 w-full py-1.5`}
        />
      </label>

      <p className={`${labelClass} mt-3`}>Preview</p>
      <div className="mt-1 overflow-hidden rounded-md">
        <BannerBar season={preview} banner={previewText} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
        {error && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
