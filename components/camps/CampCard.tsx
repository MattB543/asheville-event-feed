'use client';

import { memo } from 'react';
import Link from 'next/link';
import {
  BellPlus,
  CalendarDays,
  Car,
  Clock,
  ExternalLink,
  Eye,
  MapPin,
  Tag,
  Users,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  SUPPORT_LABELS,
  TYPE_LABELS,
  type CampCardData,
} from '@/lib/camps/display';
import SaveCampButton from './SaveCampButton';
import { RegistrationDetails, UnconfirmedTag, YearTag } from './YearTag';
import { sendCampView } from './campViews';
import { TONE_CLASSES } from './tones';

const chipClasses =
  'rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300';
const actionClasses =
  'inline-flex min-h-9 items-center gap-1 rounded-lg px-2 py-1.5 text-sm whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/**
 * One program card in the directory. `match` says which of its rows the filters kept, and
 * `schedule` the earlier summer whose weeks it matched on (the week filter, before 2027 is posted).
 * Memoized: a keystroke in the search box re-renders the directory before its list changes.
 */
export default memo(function CampCard({
  camp,
  showProvider,
  match,
  schedule,
}: {
  camp: CampCardData;
  showProvider: boolean;
  match: string | null;
  schedule: number | null;
}) {
  const { registration } = camp;
  // Most camps haven't posted 2027 yet: that reads as a quiet line, and only news gets a banner
  const quiet = registration.tone === 'unknown';
  const agesStated = !!camp.who || camp.rows.some((row) => row.ages || row.grades);
  // `note` is the camp's own words under a fact: what a price is for, exceptions to the hours
  const facts = [
    {
      icon: Users,
      label: 'Who',
      text: camp.who ?? (agesStated ? 'Ages vary by session' : 'Ages not stated'),
      year: null,
      note: null,
    },
    {
      icon: CalendarDays,
      label: 'Dates',
      text: camp.season?.text,
      year: camp.season?.year,
      note: null,
    },
    {
      icon: Clock,
      label: 'Hours',
      text: [camp.hours, camp.care].filter(Boolean).join(' · ') || null,
      year: null,
      note: camp.hoursNote,
    },
    {
      icon: Tag,
      label: 'Price',
      text: camp.price?.text,
      year: camp.price?.year,
      note: camp.priceNote,
    },
    {
      icon: camp.driveMinutes !== null ? Car : MapPin,
      label: 'Where',
      text: camp.place ?? 'Location not stated',
      year: null,
      note: null,
    },
  ].filter((fact) => fact.text || fact.note);

  return (
    <li className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      {!quiet && (
        <div className={`border-b px-3 py-2 ${TONE_CLASSES[registration.tone]}`}>
          <p className="font-semibold leading-snug">
            {registration.text}
            {registration.unconfirmed && <UnconfirmedTag />}
          </p>
          <RegistrationDetails
            details={registration.details}
            className="mt-0.5 text-xs opacity-90"
          />
        </div>
      )}

      <div className="flex-1 p-3">
        {quiet && (
          <div className="mb-1.5 text-xs text-gray-600 dark:text-gray-400">
            <p>
              {registration.text}
              {registration.unconfirmed && <UnconfirmedTag />}
            </p>
            <RegistrationDetails details={registration.details} className="" />
          </div>
        )}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {showProvider && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{camp.providerName}</p>
            )}
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              <Link
                href={`/camps/${camp.slug}`}
                className="hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {camp.name}
              </Link>
            </h3>
          </div>
          <SaveCampButton campId={camp.id} campName={camp.name} />
        </div>

        <p className="mt-1.5 flex flex-wrap gap-1">
          <span className={chipClasses}>{TYPE_LABELS[camp.type] ?? camp.type}</span>
          {camp.categories.slice(0, 2).map((value) => (
            <span key={value} className={chipClasses}>
              {CATEGORY_LABELS[value] ?? value}
            </span>
          ))}
        </p>

        <dl className="mt-3 space-y-1 text-sm text-gray-700 dark:text-gray-300">
          {facts.map(({ icon: Icon, label, text, year, note }) => (
            <div key={label} className="flex items-start gap-2">
              <dt className="sr-only">{label}</dt>
              <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
              <dd className="min-w-0">
                {text}
                {text && year ? <YearTag year={year} /> : null}
                {note && (
                  <span
                    title={note}
                    className="block text-xs text-gray-500 dark:text-gray-400 line-clamp-2"
                  >
                    {note}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {match && (
          <p className="mt-2 text-sm font-medium text-brand-700 dark:text-brand-300">
            {match}
            {schedule && (
              <span
                title={`Matched on the camp's ${schedule} weeks: it hasn't posted 2027 dates yet`}
                className="ml-1.5 inline-block rounded px-1 text-[11px] font-medium leading-4 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                {schedule} schedule
              </span>
            )}
          </p>
        )}

        {(camp.support.length > 0 || camp.views > 0) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-gray-500 dark:text-gray-400">
            {camp.support.map((key, index) => (
              <span key={key}>
                {index > 0 && '· '}
                {SUPPORT_LABELS[key]}
              </span>
            ))}
            {camp.views > 0 && (
              <span
                title="Views of this camp in the last 14 days"
                className="ml-auto inline-flex items-center gap-1"
              >
                <Eye size={13} aria-hidden="true" />
                {camp.views} {camp.views === 1 ? 'view' : 'views'} in 14 days
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-0.5 border-t border-gray-100 dark:border-gray-800 px-1.5 py-1">
        <Link
          href={`/camps/${camp.slug}`}
          className={`${actionClasses} font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/50`}
        >
          Details
        </Link>
        {camp.websiteUrl && (
          <a
            href={camp.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => sendCampView(camp.id)}
            className={`${actionClasses} text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800`}
          >
            Camp website
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
        {camp.hasReminder && (
          <a
            href={`/api/camps/${camp.id}/reminder`}
            rel="nofollow"
            className={`${actionClasses} text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800`}
          >
            <BellPlus size={14} aria-hidden="true" />
            Add reminder
          </a>
        )}
      </div>
    </li>
  );
});
