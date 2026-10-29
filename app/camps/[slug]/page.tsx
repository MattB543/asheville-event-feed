import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import Link from 'next/link';
import { ArrowLeft, BellPlus, ExternalLink, Eye, MapPin } from 'lucide-react';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import AiNotice from '@/components/camps/AiNotice';
import CampFeedback from '@/components/camps/CampFeedback';
import { CampViewBeacon, CampWebsiteLink } from '@/components/camps/CampLinks';
import { TONE_CLASSES } from '@/components/camps/tones';
import SaveCampButton from '@/components/camps/SaveCampButton';
import { RegistrationDetails, UnconfirmedTag, YearTag } from '@/components/camps/YearTag';
import type { Milestone, SupportFact } from '@/lib/camps/contract';
import {
  AVAILABILITY_LABELS,
  CATEGORY_LABELS,
  SUPPORT_VALUE_LABELS,
  TARGET_SEASON,
  TYPE_LABELS,
  byMilestoneDate,
  driveLabel,
  formatDate,
  formatDateRange,
  formatExtendedCare,
  formatHours,
  formatPriceTier,
  formatTime,
  formatWho,
  hostOf,
  isUnconfirmed,
  milestoneLabel,
  milestoneWhen,
  registrationLine,
  reminderMilestones,
  siteTown,
  toCardData,
  upcomingUntil,
} from '@/lib/camps/display';
import { ORS_ATTRIBUTION } from '@/lib/camps/geo';
import { getCampBySlug, relatedCamps, type CampListItem } from '@/lib/db/queries/camps';
import { mapsSearchUrl } from '@/lib/utils/maps';
import { getDateStringEastern } from '@/lib/utils/timezone';
import { SITE_URL } from '@/lib/seo/site';

interface PageProps {
  params: Promise<{ slug: string }>;
}

const META_TYPES: Record<string, string> = {
  day: 'Day camp',
  half_day: 'Half-day camp',
  overnight: 'Overnight camp',
  evening: 'Evening camp',
  vbs: 'Vacation Bible School',
  clinic: 'Camp clinic',
  pre_college: 'Pre-college program',
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const camp = await getCampBySlug(slug).catch(() => null);
  if (!camp) return { title: 'Camp not found', robots: { index: false } };
  const { card } = camp;
  const title = card.name.toLowerCase().includes(camp.providerName.toLowerCase())
    ? card.name
    : `${card.name} · ${camp.providerName}`;
  const towns = [...new Set(camp.sites.map(siteTown).filter(Boolean))].slice(0, 2).join(' and ');
  const who = formatWho(card.ages, card.grades);
  // "Overnight camp in Cleveland, SC for rising 5th–12th grade. <first sentence>. Dates, ..."
  const description = [
    `${META_TYPES[card.type] ?? 'Summer camp'}${towns ? ` in ${towns}` : ' near Asheville'}${who ? ` for ${who.toLowerCase()}` : ''}.`,
    card.description.split(/(?<=\.)\s/)[0],
    'Dates, prices and when 2027 registration opens.',
  ].join(' ');
  const url = `${SITE_URL}/camps/${camp.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title, description, siteName: 'AVL GO', locale: 'en_US' },
  };
}

const buttonClasses =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:text-brand-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';
const linkClasses =
  'text-brand-600 dark:text-brand-400 underline underline-offset-2 hover:text-brand-700 dark:hover:text-brand-300';
const sectionHeading = 'text-lg font-semibold text-gray-900 dark:text-gray-100';

function SourceLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={linkClasses}>
      {hostOf(url)}
    </a>
  );
}

function MilestoneItem({
  milestone,
  confirmed,
  now,
}: {
  milestone: Milestone;
  confirmed: boolean;
  now: Date;
}) {
  const past = now >= upcomingUntil(milestone);
  return (
    <li className="text-sm">
      <p className="text-gray-900 dark:text-gray-100">
        <span className="font-medium">{milestoneLabel(milestone, past)}</span>{' '}
        {milestoneWhen(milestone)}
        {milestone.certainty === 'expected' && (
          <span className="ml-1.5 inline-block rounded px-1 text-[11px] font-medium leading-4 bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
            expected
          </span>
        )}
        {isUnconfirmed(milestone, confirmed) && <UnconfirmedTag />}
        {milestone.year !== TARGET_SEASON && (
          <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">
            (for summer {milestone.year})
          </span>
        )}
      </p>
      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
        “{milestone.text}” · <SourceLink url={milestone.url} />
      </p>
    </li>
  );
}

function SupportRow({ label, fact }: { label: string; fact: SupportFact | null }) {
  if (!fact) return null;
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900 dark:text-gray-100">
        <span className="font-medium">{SUPPORT_VALUE_LABELS[fact.value]}.</span>{' '}
        <span className="text-gray-700 dark:text-gray-300">“{fact.text}”</span>
      </dd>
    </div>
  );
}

function RelatedCamp({ camp, now }: { camp: CampListItem; now: Date }) {
  const data = toCardData(camp, now);
  return (
    <li className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{data.providerName}</p>
      <Link
        href={`/camps/${data.slug}`}
        className="font-semibold text-gray-900 dark:text-gray-100 hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {data.name}
      </Link>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        {[data.who, data.place].filter(Boolean).join(' · ')}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200">
        {data.registration.text}
      </p>
    </li>
  );
}

export default async function CampPage({ params }: PageProps) {
  const { slug } = await params;
  // Per request, like /camps: registration status depends on the clock.
  await connection();
  const camp = await getCampBySlug(slug);
  if (!camp) notFound();

  const now = new Date();
  const { card } = camp;
  const line = registrationLine(card, camp.confirmed, now);
  const milestones = [...card.registration].sort(byMilestoneDate);
  const hasReminder = reminderMilestones(card, now).length > 0;
  const related = await relatedCamps(camp).catch((error) => {
    console.error('[Camps] Related camps failed:', error);
    return [];
  });
  const website = card.camp_page_url ?? camp.providerUrl;
  const siteByName = new Map(camp.sites.map((site) => [site.name, site]));

  const sessions = [...card.sessions].sort(
    (a, b) => a.start.localeCompare(b.start) || (a.site ?? '').localeCompare(b.site ?? '')
  );
  const columns = {
    site: camp.sites.length > 1 && sessions.some((session) => session.site),
    who: sessions.some((session) => session.ages || session.grades),
    hours: sessions.some((session) => session.hours),
    price: sessions.some((session) => session.price),
    status: sessions.some((session) => session.status),
  };

  const facts = [
    { label: 'Who', value: formatWho(card.ages, card.grades), year: null },
    {
      label: 'Season',
      value:
        [formatDateRange(card.season.start, card.season.end), card.season.text]
          .filter(Boolean)
          .join('. ') || null,
      year: card.season.year,
    },
    {
      label: 'Hours',
      value: [formatHours(card.hours), card.hours?.text && `“${card.hours.text}”`]
        .filter(Boolean)
        .join(' · '),
      year: null,
    },
    {
      label: 'Extended care',
      value: card.extended_care
        ? [formatExtendedCare(card.extended_care), card.extended_care.cost_text]
            .filter(Boolean)
            .join('. ')
        : null,
      year: null,
    },
    ...card.prices.map((price) => ({
      label: 'Price',
      value: `${formatPriceTier(price)}${price.label ? ` (${price.label})` : ''}`,
      year: price.year,
    })),
  ].filter((fact) => fact.value);

  // The Eastern day it was read, not the UTC one (an evening check is the next day in UTC)
  const checked = camp.checkedAt
    ? formatDate(getDateStringEastern(new Date(camp.checkedAt)), true)
    : null;

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="camps" />
      <CampViewBeacon campId={camp.id} />

      <div className="flex-grow">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10">
          <Link
            href="/camps"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            All camps
          </Link>

          <AiNotice className="mt-4" />

          <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            {camp.providerName}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            {card.name}
          </h1>
          <p className="mt-2 flex flex-wrap gap-1">
            {[
              TYPE_LABELS[card.type] ?? card.type,
              ...card.categories.map((value) => CATEGORY_LABELS[value] ?? value),
            ].map((label) => (
              <span
                key={label}
                className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300"
              >
                {label}
              </span>
            ))}
          </p>
          {card.description && (
            <p className="mt-4 text-gray-700 dark:text-gray-300">{card.description}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SaveCampButton campId={camp.id} campName={card.name} withLabel />
            {website && (
              <CampWebsiteLink campId={camp.id} href={website} className={buttonClasses}>
                Camp website <ExternalLink size={14} aria-hidden="true" />
              </CampWebsiteLink>
            )}
            {card.registration_url && card.registration_url !== website && (
              <CampWebsiteLink
                campId={camp.id}
                href={card.registration_url}
                className={buttonClasses}
              >
                Registration page <ExternalLink size={14} aria-hidden="true" />
              </CampWebsiteLink>
            )}
            {hasReminder && (
              <a href={`/api/camps/${camp.id}/reminder`} rel="nofollow" className={buttonClasses}>
                <BellPlus size={14} aria-hidden="true" />
                Add reminder
              </a>
            )}
          </div>

          <section
            aria-labelledby="registration-heading"
            className="mt-8 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden"
          >
            <div className={`border-b px-4 py-3 ${TONE_CLASSES[line.tone]}`}>
              <h2
                id="registration-heading"
                className="text-xs font-semibold uppercase tracking-wide opacity-80"
              >
                Registration
              </h2>
              <p className="mt-0.5 text-lg font-semibold leading-snug">
                {line.text}
                {line.unconfirmed && <UnconfirmedTag />}
              </p>
              <RegistrationDetails details={line.details} className="text-sm opacity-90" />
            </div>

            <div className="p-4 space-y-4">
              {milestones.length > 0 ? (
                <ul className="space-y-3">
                  {milestones.map((milestone, index) => (
                    <MilestoneItem
                      key={`${milestone.audience}-${milestone.kind}-${milestone.date}-${index}`}
                      milestone={milestone}
                      confirmed={camp.confirmed}
                      now={now}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Registration date not posted yet. Save this camp, then on{' '}
                  <Link href="/camps?saved=1" className={linkClasses}>
                    the camps page
                  </Link>{' '}
                  put your saved camps’ dates in your calendar: the date shows up there once the
                  camp posts it.
                </p>
              )}

              {card.last_year_registration_opened && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Last year it opened</span>{' '}
                  {formatDate(card.last_year_registration_opened.date, true)}
                  {card.last_year_registration_opened.time &&
                    `, ${formatTime(card.last_year_registration_opened.time)}`}
                  <span className="block text-xs text-gray-600 dark:text-gray-400">
                    “{card.last_year_registration_opened.text}” ·{' '}
                    <SourceLink url={card.last_year_registration_opened.url} />
                  </span>
                </p>
              )}

              {card.availability && (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">
                    Availability
                    {card.season.year !== TARGET_SEASON && ` (summer ${card.season.year})`}:
                  </span>{' '}
                  {AVAILABILITY_LABELS[card.availability.status] ?? card.availability.status}
                  {card.availability.scope && ` (${card.availability.scope})`}
                  <span className="block text-xs text-gray-600 dark:text-gray-400">
                    “{card.availability.text}”
                  </span>
                </p>
              )}
            </div>
          </section>

          {facts.length > 0 && (
            <section aria-labelledby="details-heading" className="mt-8">
              <h2 id="details-heading" className={sectionHeading}>
                Details
              </h2>
              <dl className="mt-3 divide-y divide-gray-200 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                {facts.map((fact, index) => (
                  <div
                    key={`${fact.label}-${index}`}
                    className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]"
                  >
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {fact.label}
                    </dt>
                    <dd className="text-sm text-gray-900 dark:text-gray-100">
                      {fact.value}
                      {fact.year ? <YearTag year={fact.year} /> : null}
                    </dd>
                  </div>
                ))}
                {camp.views > 0 && (
                  <div className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Popularity
                    </dt>
                    <dd className="inline-flex items-center gap-1.5 text-sm text-gray-900 dark:text-gray-100">
                      <Eye size={14} aria-hidden="true" className="text-gray-400" />
                      {camp.views} {camp.views === 1 ? 'view' : 'views'} in the last 14 days
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {sessions.length > 0 && (
            <section aria-labelledby="sessions-heading" className="mt-8">
              <h2 id="sessions-heading" className={sectionHeading}>
                Weeks and sessions
                <YearTag year={card.season.year} />
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                As the camp lists them. A blank means the camp’s general details apply.
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/60 text-left text-xs text-gray-600 dark:text-gray-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Week / theme
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Dates
                      </th>
                      {columns.site && (
                        <th scope="col" className="px-3 py-2 font-medium">
                          Site
                        </th>
                      )}
                      {columns.who && (
                        <th scope="col" className="px-3 py-2 font-medium">
                          Ages / grades
                        </th>
                      )}
                      {columns.hours && (
                        <th scope="col" className="px-3 py-2 font-medium">
                          Hours
                        </th>
                      )}
                      {columns.price && (
                        <th scope="col" className="px-3 py-2 font-medium">
                          Price
                        </th>
                      )}
                      {columns.status && (
                        <th scope="col" className="px-3 py-2 font-medium">
                          Status
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-800 dark:text-gray-200">
                    {sessions.map((session, index) => (
                      <tr key={`${session.start}-${session.site}-${index}`}>
                        <td className="px-3 py-2 min-w-40">{session.label ?? '–'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDateRange(session.start, session.end)}
                        </td>
                        {columns.site && (
                          <td className="px-3 py-2 min-w-40">
                            {session.site ?? ''}
                            {session.site && siteByName.get(session.site)?.town && (
                              <span className="block text-xs text-gray-500 dark:text-gray-400">
                                {siteTown(siteByName.get(session.site)!)}
                              </span>
                            )}
                          </td>
                        )}
                        {columns.who && (
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatWho(session.ages, session.grades) ?? ''}
                          </td>
                        )}
                        {columns.hours && (
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatHours(session.hours) ?? ''}
                          </td>
                        )}
                        {columns.price && (
                          <td className="px-3 py-2 min-w-28">
                            {session.price && (
                              <>
                                <span className="whitespace-nowrap">
                                  {formatPriceTier(session.price)}
                                </span>
                                {session.price.label && (
                                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                                    {session.price.label}
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                        )}
                        {columns.status && (
                          <td className="px-3 py-2 whitespace-nowrap">
                            {session.status ? AVAILABILITY_LABELS[session.status] : ''}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section aria-labelledby="where-heading" className="mt-8">
            <h2 id="where-heading" className={sectionHeading}>
              Where
            </h2>
            {camp.sites.length === 0 ? (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                The camp’s site doesn’t say where it meets.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {camp.sites.map((site) => {
                  const address = [site.address, site.town, site.state].filter(Boolean).join(', ');
                  return (
                    <li
                      key={site.name}
                      className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 text-sm"
                    >
                      <p className="font-medium text-gray-900 dark:text-gray-100">{site.name}</p>
                      {address && <p className="text-gray-700 dark:text-gray-300">{address}</p>}
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600 dark:text-gray-400">
                        <span>
                          {site.driveMinutes !== null
                            ? `About ${driveLabel(site.driveMinutes)} drive from downtown`
                            : 'Drive time not known'}
                        </span>
                        <a
                          href={mapsSearchUrl(address ? `${site.name}, ${address}` : site.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1 ${linkClasses}`}
                        >
                          <MapPin size={13} aria-hidden="true" />
                          Map
                        </a>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Drive times from Pack Square, without traffic: {ORS_ATTRIBUTION}
            </p>
          </section>

          {(card.financial_aid || card.special_needs || card.lunch || card.transportation) && (
            <section aria-labelledby="support-heading" className="mt-8">
              <h2 id="support-heading" className={sectionHeading}>
                Good to know
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                In the camp’s own words.
              </p>
              <dl className="mt-3 divide-y divide-gray-200 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <SupportRow label="Financial aid" fact={card.financial_aid} />
                <SupportRow label="Special needs" fact={card.special_needs} />
                <SupportRow label="Lunch" fact={card.lunch} />
                <SupportRow label="Transportation" fact={card.transportation} />
              </dl>
            </section>
          )}

          {card.sources.length > 0 && (
            <section aria-labelledby="sources-heading" className="mt-8">
              <h2 id="sources-heading" className={sectionHeading}>
                Sources
              </h2>
              <ul className="mt-2 space-y-1 text-sm">
                {card.sources.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${linkClasses} break-all`}
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
              {checked && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Checked {checked}.</p>
              )}
            </section>
          )}

          {related.length > 0 && (
            <section aria-labelledby="related-heading" className="mt-8">
              <h2 id="related-heading" className={sectionHeading}>
                Similar camps nearby
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {related.map((other) => (
                  <RelatedCamp key={other.id} camp={other} now={now} />
                ))}
              </ul>
            </section>
          )}

          <div className="mt-8">
            <CampFeedback campId={camp.id} campName={card.name} />
          </div>
        </div>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <FooterCredit />
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
