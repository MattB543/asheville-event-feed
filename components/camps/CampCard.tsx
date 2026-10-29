'use client';

import { memo } from 'react';
import Link from 'next/link';
import { CalendarDays, Car, Clock, ExternalLink, Eye, MapPin, Tag, Users } from 'lucide-react';
import {
  CATEGORY_LABELS,
  REMINDER_LABELS,
  TYPE_LABELS,
  type CampCardData,
} from '@/lib/camps/display';
import ReminderMenu from './ReminderMenu';
import SaveCampButton from './SaveCampButton';
import { UnconfirmedTag, YearTag } from './YearTag';
import { sendCampView } from './campViews';
import { TONE_CLASSES } from './tones';

const chipClasses =
  'min-w-0 truncate rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs leading-4 text-gray-700 dark:text-gray-300';
const actionClasses =
  'inline-flex min-h-9 items-center gap-1 rounded-lg px-1.5 sm:px-2 py-1.5 text-sm whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

/**
 * One program card in the directory. `match` says which of its rows the filters kept, and
 * `schedule` the earlier summer whose weeks it matched on (the week filter, before 2027 is posted).
 * Every card has every line, at the same height, so a row of cards reads straight across: a fact
 * the camp doesn't state says so, and a long one is cut short (the camp's page has it all).
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
  const agesStated = !!camp.who || camp.rows.some((row) => row.ages || row.grades);
  const facts = [
    {
      icon: Users,
      label: 'Who',
      text: camp.who ?? (agesStated ? 'Ages vary by session' : null),
      missing: 'Ages not stated',
    },
    {
      icon: CalendarDays,
      label: 'Dates',
      text: camp.season?.text,
      year: camp.season?.year,
      missing: 'Dates not posted',
    },
    {
      icon: Clock,
      label: 'Hours',
      text: [camp.hours, camp.care].filter(Boolean).join(' · '),
      missing: 'Hours not stated',
    },
    {
      icon: Tag,
      label: 'Price',
      text: camp.price?.text,
      year: camp.price?.year,
      missing: 'Price unknown',
    },
    { icon: MapPin, label: 'Where', text: camp.location, missing: 'Location not stated' },
    { icon: Car, label: 'Drive', text: camp.drive, missing: 'Drive time unknown' },
  ];

  return (
    // min-w-0: a phone's one grid column is sized to its content, and the cut-short lines are long
    <li className="flex min-w-0 flex-col rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      {/* One line on every card: the headline alone (the camp page has the other dates), cut
          short before its "unconfirmed" label */}
      <p
        title={registration.text}
        className={`flex h-9 items-center rounded-t-[11px] border-b px-3 text-sm font-semibold ${TONE_CLASSES[registration.tone]}`}
      >
        <span className="truncate">{registration.text}</span>
        {registration.unconfirmed && <UnconfirmedTag />}
      </p>

      <div className="flex-1 p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {showProvider && (
              <p className="truncate text-sm leading-5 text-gray-600 dark:text-gray-300">
                {camp.providerName}
              </p>
            )}
            <h3
              title={camp.name}
              className="truncate font-semibold leading-6 text-gray-900 dark:text-gray-100"
            >
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

        <p className="mt-1.5 flex h-5 gap-1 overflow-hidden">
          <span className={`${chipClasses} shrink-0`}>{TYPE_LABELS[camp.type] ?? camp.type}</span>
          {camp.categories.slice(0, 2).map((value) => (
            <span key={value} className={chipClasses}>
              {CATEGORY_LABELS[value] ?? value}
            </span>
          ))}
        </p>

        <p
          title={camp.summary || undefined}
          className={`mt-2 h-10 line-clamp-2 text-sm leading-5 ${
            camp.summary ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {camp.summary || 'No description posted'}
        </p>

        <dl className="mt-2 space-y-1 text-sm leading-5">
          {facts.map(({ icon: Icon, label, text, year, missing }) => (
            <div key={label} className="flex h-5 items-center gap-2">
              <dt className="sr-only">{label}</dt>
              <Icon size={15} aria-hidden="true" className="shrink-0 text-gray-400" />
              <dd className="flex min-w-0 items-center">
                {text ? (
                  <>
                    <span title={text} className="truncate text-gray-700 dark:text-gray-300">
                      {text}
                    </span>
                    {year ? <YearTag year={year} /> : null}
                  </>
                ) : (
                  <span className="truncate text-gray-500 dark:text-gray-400">{missing}</span>
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
      </div>

      <div className="flex flex-wrap items-center gap-x-0.5 border-t border-gray-100 dark:border-gray-800 px-1 sm:px-1.5 py-1">
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
            Website
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
        {camp.reminders.length > 0 && (
          <ReminderMenu
            campId={camp.id}
            label={REMINDER_LABELS.public}
            dates={camp.reminders}
            className={`${actionClasses} text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800`}
          />
        )}
        {camp.views > 0 && (
          <span
            title="Views of this camp in the last 14 days"
            className="ml-auto inline-flex items-center gap-0.5 pl-1 pr-1.5 text-xs text-gray-500 dark:text-gray-400"
          >
            <Eye size={13} aria-hidden="true" />
            {camp.views}
            <span className="sr-only">
              {camp.views === 1 ? ' view' : ' views'} in the last 14 days
            </span>
          </span>
        )}
      </div>
    </li>
  );
});
