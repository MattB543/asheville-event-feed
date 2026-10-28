import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import { YearTag } from '@/components/camps/CampDirectory';
import {
  CATEGORY_LABELS,
  TYPE_LABELS,
  audienceLabel,
  formatAges,
  formatDate,
  formatDateRange,
  formatGrades,
  formatMilestoneWhen,
  formatPrice,
  formatTime,
  isSiteLevel,
  isTentative,
  type CampListing,
} from '@/lib/camps/display';
import { campsDataInfo, getCampListing } from '@/lib/camps/pilotData';
import type { Evidence } from '@/lib/camps/types';
import { SITE_URL } from '@/lib/seo/site';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const camp = getCampListing(slug);
  if (!camp) return { title: 'Camp not found', robots: { index: false } };
  const title = `${camp.name}${camp.variant ? ` (${camp.variant})` : ''} · ${camp.providerName}`;
  return {
    title,
    description: camp.description ?? `${camp.name}, a summer camp near Asheville, NC.`,
    alternates: { canonical: `${SITE_URL}/camps/${camp.slug}` },
    robots: { index: false, follow: false }, // pilot
  };
}

interface FactRow {
  label: string;
  value: string;
  evidence: Evidence & { status: string; publishable: boolean };
}

function factRows(camp: CampListing): FactRow[] {
  const { facts } = camp;
  const rows: FactRow[] = [];
  const add = (
    label: string,
    value: string | null | undefined,
    evidence: (Evidence & { status: string; publishable: boolean }) | undefined
  ) => {
    if (value && evidence) rows.push({ label, value, evidence });
  };

  add('Grades', facts.grades && formatGrades(facts.grades), facts.grades);
  add('Ages', facts.ages && formatAges(facts.ages), facts.ages);
  add('Season', facts.dates && formatDateRange(facts.dates.start, facts.dates.end), facts.dates);
  add(
    'Hours',
    facts.hours &&
      [formatTime(facts.hours.start), formatTime(facts.hours.end)].filter(Boolean).join(' – '),
    facts.hours
  );
  add(
    'Extended care',
    facts.extendedCare &&
      [
        facts.extendedCare.early_dropoff_start &&
          `drop-off from ${formatTime(facts.extendedCare.early_dropoff_start)}`,
        facts.extendedCare.late_pickup_end &&
          `pickup until ${formatTime(facts.extendedCare.late_pickup_end)}`,
        facts.extendedCare.cost_text,
      ]
        .filter(Boolean)
        .join(', '),
    facts.extendedCare
  );
  for (const price of facts.prices) {
    add(
      'Price',
      `${formatPrice(price.amount)} per ${price.unit}${price.tier ? ` (${price.tier})` : ''}`,
      price
    );
  }
  for (const fee of facts.fees) {
    add('Fee', `${formatPrice(fee.amount)} ${fee.label.toLowerCase()} per ${fee.per}`, fee);
  }
  for (const location of facts.locations) {
    add(
      'Where',
      [location.name, location.address, location.town, location.state].filter(Boolean).join(', '),
      location
    );
  }
  const flag = (label: string, fact: CampListing['facts']['lunch']) =>
    add(
      label,
      fact && `${fact.available ? 'Yes' : 'No'}${fact.details ? `: ${fact.details}` : ''}`,
      fact
    );
  flag('Financial aid', facts.financialAid);
  flag('Special-needs support', facts.specialNeeds);
  flag('Lunch', facts.lunch);
  flag('Transportation', facts.transportation);
  add(
    'Registration last year',
    facts.lastYearOpened &&
      formatMilestoneWhen({
        ...facts.lastYearOpened,
        precision: facts.lastYearOpened.time ? 'datetime' : 'date',
      }),
    facts.lastYearOpened
  );
  return rows;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const buttonClasses =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export default async function CampPage({ params }: PageProps) {
  const { slug } = await params;
  const camp = getCampListing(slug);
  if (!camp) notFound();
  // Per request, like /camps: registration status depends on the clock.
  await connection();

  const rows = factRows(camp);
  const sources = [
    ...new Set(rows.map((row) => row.evidence.url).concat(camp.milestones.map((m) => m.sourceUrl))),
  ];
  const { attribution } = campsDataInfo();

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="flex-grow">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10">
          <Link
            href="/camps"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            All camps
          </Link>

          <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            {camp.providerName}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            {camp.name}
          </h1>
          {camp.variant && <p className="mt-1 text-gray-600 dark:text-gray-400">{camp.variant}</p>}
          <p className="mt-2 flex flex-wrap gap-1">
            {[
              TYPE_LABELS[camp.type] ?? camp.type,
              ...camp.categories.map((value) => CATEGORY_LABELS[value] ?? value),
            ].map((label) => (
              <span
                key={label}
                className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300"
              >
                {label}
              </span>
            ))}
          </p>
          {camp.description && (
            <p className="mt-4 text-gray-700 dark:text-gray-300">{camp.description}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {(camp.campPageUrl ?? camp.websiteUrl) && (
              <a
                href={(camp.campPageUrl ?? camp.websiteUrl)!}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses}
              >
                Camp website <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
            {camp.registrationUrl && camp.registrationUrl !== camp.campPageUrl && (
              <a
                href={camp.registrationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses}
              >
                Registration page <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>

          <section
            aria-labelledby="registration-heading"
            className="mt-8 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
          >
            <h2
              id="registration-heading"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Registration
            </h2>
            <p className="mt-1 font-medium text-gray-900 dark:text-gray-100">
              {camp.registration.text}
            </p>
            {camp.registration.detail && (
              <p className="text-sm text-gray-600 dark:text-gray-400">{camp.registration.detail}</p>
            )}

            {camp.milestones.length > 0 && (
              <ul className="mt-3 space-y-3">
                {camp.milestones.map((milestone) => (
                  <li
                    key={`${milestone.audience}-${milestone.kind}-${milestone.date}`}
                    className="text-sm"
                  >
                    <p className="text-gray-900 dark:text-gray-100">
                      <span className="font-medium">
                        {milestone.kind === 'opens' ? 'Opens' : milestone.kind.replace('_', ' ')}{' '}
                        for {audienceLabel(milestone.audience)}:
                      </span>{' '}
                      {formatMilestoneWhen(milestone)}
                      {milestone.precision === 'date' && ' (time not stated)'}
                      {isTentative(milestone) && (
                        <span className="ml-1.5 rounded px-1 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                          expected, not confirmed
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      For summer {milestone.seasonYear} · “{milestone.quote}” ·{' '}
                      <a
                        href={milestone.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {host(milestone.sourceUrl)}
                      </a>{' '}
                      ·{' '}
                      {milestone.verifyStatus === 'verified'
                        ? 'quote found on the page'
                        : `needs a check (${milestone.flags.filter((flag) => flag !== 'needs_hand_check').join(', ')})`}{' '}
                      ·{' '}
                      {milestone.handCheckedAt
                        ? `checked by hand ${formatDate(milestone.handCheckedAt.slice(0, 10), true)} (pilot session, not yet by Matt)`
                        : 'not yet checked by a person'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {camp.availability && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                Availability ({camp.availability.seasonYear}): {camp.availability.status}
                {camp.availability.scope ? ` (${camp.availability.scope})` : ''}
                {camp.availability.seasonYear < 2027 && ' · last summer, not 2027'}
                {camp.availability.verifyStatus !== 'verified' &&
                  !camp.availability.handCheckedAt &&
                  ' · needs a check'}
              </p>
            )}
          </section>

          <section aria-labelledby="details-heading" className="mt-8">
            <h2
              id="details-heading"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Details
            </h2>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                No details could be confirmed on the camp’s pages yet.
              </p>
            ) : (
              <dl className="mt-3 divide-y divide-gray-200 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                {rows.map((row, index) => (
                  <div
                    key={`${row.label}-${index}`}
                    className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]"
                  >
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {row.label}
                    </dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100">
                      {row.value}
                      <YearTag
                        value={{
                          year: row.evidence.year,
                          unconfirmed: !row.evidence.publishable,
                        }}
                      />
                      <details className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <summary className="cursor-pointer">
                          Source: {host(row.evidence.url)}
                        </summary>
                        <p className="mt-1">
                          “{row.evidence.quote}”{' '}
                          <a
                            href={row.evidence.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                          >
                            open page
                          </a>
                        </p>
                        {row.evidence.check && (
                          <p className="mt-0.5">
                            Checked {formatDate(row.evidence.check.checkedAt.slice(0, 10), true)}:{' '}
                            {row.evidence.check.status}
                            {row.evidence.check.flags.length > 0 &&
                              ` (${row.evidence.check.flags.join(', ')})`}
                            {row.evidence.check.handCheckedAt &&
                              `; checked by hand: ${row.evidence.check.handCheckNote ?? 'confirmed'}`}
                          </p>
                        )}
                      </details>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {camp.geo && (
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              {isSiteLevel(camp.geo) && camp.geo.driveMinutes !== null
                ? `About ${Math.round(camp.geo.driveMinutes)} minutes’ drive from downtown Asheville (Pack Square, no traffic).`
                : `Drive time not shown: we could only place this camp at the town (${camp.geo.label}).`}
              {camp.geo.inRadius === false && ' Outside the directory’s drive-time limit.'}
              {camp.geo.nearCutoff && ' Close to the drive-time limit; needs a look.'}
            </p>
          )}

          {camp.sessions.length > 0 && (
            <section aria-labelledby="sessions-heading" className="mt-8">
              <h2
                id="sessions-heading"
                className="text-lg font-semibold text-gray-900 dark:text-gray-100"
              >
                Sessions{' '}
                <span className="font-normal text-gray-500 dark:text-gray-400">
                  (summer {camp.sessionsYear})
                </span>
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                As listed on the camp’s pages; individual sessions aren’t verified yet.
              </p>
              <ul className="mt-2 grid gap-1 text-sm text-gray-700 dark:text-gray-300 sm:grid-cols-2">
                {camp.sessions.map((session, index) => (
                  <li key={`${session.start}-${index}`}>
                    {session.label ? `${session.label}: ` : ''}
                    {formatDateRange(session.start, session.end)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-labelledby="pilot-heading"
            className="mt-8 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200"
          >
            <h2 id="pilot-heading" className="font-semibold">
              Pilot data
            </h2>
            <p className="mt-1">
              {camp.quality.verified} of {camp.quality.total} facts found word for word on the cited
              page; {camp.quality.review} need a check; {camp.quality.dropped} dropped (not on the
              page).
            </p>
            {camp.providerNotes && (
              <details className="mt-2">
                <summary className="cursor-pointer">Notes from the extraction</summary>
                <p className="mt-1 whitespace-pre-line">{camp.providerNotes}</p>
              </details>
            )}
          </section>

          {sources.length > 0 && (
            <section aria-labelledby="sources-heading" className="mt-8">
              <h2
                id="sources-heading"
                className="text-lg font-semibold text-gray-900 dark:text-gray-100"
              >
                Sources
              </h2>
              <ul className="mt-2 space-y-1 text-sm">
                {sources.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 dark:text-brand-400 underline underline-offset-2 break-all"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
              {camp.lastChecked && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Last checked {formatDate(camp.lastChecked.slice(0, 10), true)}.
                </p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Drive times: {attribution}
              </p>
            </section>
          )}
        </div>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <FooterCredit />
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
