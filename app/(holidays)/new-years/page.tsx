import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import Poster from '@/components/holidays/Poster';
import HeartButton, { FavoritesSync } from '@/components/holidays/HeartButton';
import AdminControls from '@/components/holidays/AdminControls';
import AdminWallSearch from '@/components/holidays/AdminWallSearch';
import { PreviewLink, PreviewNotice } from '@/components/holidays/Preview';
import { SeasonPreview } from '@/components/seasonal/useSeason';
import { EventDialog, PopupLink } from '@/components/holidays/EventPopup';
import Countdown from '@/components/holidays/newyear/Countdown';
import Toast from '@/components/holidays/newyear/Toast';
import { josefin, limelight } from '@/components/holidays/newyear/fonts';
import type { HolidayEvent } from '@/lib/holidays/events';
import { loadHolidayPage, type DayList } from '@/lib/holidays/page';
import { holidayWall } from '@/lib/holidays/config';
import { getSeasons } from '@/lib/db/queries/seasonSettings';
import { hasLoadableEventImage } from '@/lib/utils/eventImages';
import { formatPriceDisplay } from '@/lib/utils/priceDisplay';
import { generateEventSlug } from '@/lib/utils/slugify';
import { formatDateEastern } from '@/lib/utils/timezone';
import { venueLine } from '@/lib/utils/venueName';
import { SITE_URL } from '@/lib/seo/site';

const title = "New Year's Eve in Asheville";
const description =
  "New Year's Eve parties, shows, dinners and countdowns in Asheville, plus New Year's Day hikes and brunches.";

export async function generateMetadata(): Promise<Metadata> {
  // The year being rung in, from the run's New Year's Eve, so Jan 1 still names it
  const year = Number(holidayWall('newyear', await getSeasons()).from.slice(0, 4));
  return {
    title: `${title}: Where to Ring In ${year + 1}`,
    description,
    alternates: { canonical: `${SITE_URL}/new-years` },
    openGraph: {
      title: `${title} ${year}`,
      description,
      url: `${SITE_URL}/new-years`,
      siteName: 'AVL GO',
      type: 'website',
    },
  };
}

const WALL_SIZE = 12;
const PER_DAY = 3;
// A midnight sky: faint gold and silver stars over deep indigo
const SKY = {
  backgroundColor: '#0b1026',
  backgroundImage:
    'radial-gradient(circle, rgba(233,207,138,.55) 1px, transparent 1.5px), radial-gradient(circle, rgba(201,207,220,.35) 1px, transparent 1.5px), linear-gradient(#0b1026, #1b1f4b 70%, #0b1026)',
  backgroundSize: '89px 71px, 53px 61px, 100% 100%',
};
// The stand-in for an event with no poster: an invitation card, gold on midnight
const FLYER = {
  flyerTitleClass: `${limelight.className} text-[#e9cf8a]`,
  flyerBackground: 'linear-gradient(160deg, #1b1f4b, #0b1026)',
};
const HEART = {
  onClass: 'border-[#e9cf8a] bg-[#e9cf8a] text-[#0b1026]',
  offClass: 'border-[#e9cf8a]/30 text-[#c9cfdc] hover:border-[#e9cf8a] hover:text-[#e9cf8a]',
};
const titleLink =
  'font-semibold leading-snug text-[#fff6d6] decoration-[#e9cf8a] decoration-2 underline-offset-4 hover:underline';

const eventHref = (e: HolidayEvent) => `/events/${generateEventSlug(e.title, e.startDate, e.id)}`;
const time = (e: HolidayEvent) =>
  e.timeUnknown ? null : formatDateEastern(e.startDate, { hour: 'numeric', minute: '2-digit' });
const longDay = (d: Date) =>
  formatDateEastern(d, { weekday: 'long', month: 'long', day: 'numeric' });
const byTime = (a: HolidayEvent, b: HolidayEvent) =>
  a.startDate.getTime() - b.startDate.getTime() || a.id.localeCompare(b.id);

/** The event's popup: an invitation card with its poster, when and where, and what it is */
function Details({ event }: { event: HolidayEvent }) {
  const when = time(event);
  const price = event.price && event.price !== 'Unknown' ? formatPriceDisplay(event.price) : null;
  return (
    <EventDialog
      eventId={event.id}
      title={event.title}
      className="bg-[#12163a] text-[#fff6d6] backdrop:bg-[#05081a]/85"
      frameClass="border-[3px] border-double border-[#e9cf8a]/50"
      closeClass="text-[#e9cf8a] hover:bg-white/10"
    >
      <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
        <div className="mx-auto w-48 self-start border-[5px] border-[#e9cf8a] bg-[#e9cf8a] sm:w-full">
          <Poster
            src={hasLoadableEventImage(event.imageUrl) ? event.imageUrl : null}
            title={event.title}
            sizes="200px"
            flyerTextClass="text-lg"
            {...FLYER}
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#e9cf8a]">
            {longDay(event.startDate)}
            {when && `, ${when}`}
          </p>
          <h2
            className={`${limelight.className} mt-1 pr-8 text-[1.7rem] leading-tight sm:text-[2rem]`}
          >
            {event.title}
          </h2>
          <p className="mt-2 text-sm text-[#c9cfdc]">{venueLine(event)}</p>
          {price && <p className="mt-1 text-sm font-semibold text-[#e9cf8a]">{price}</p>}
          {event.aiSummary && (
            <p className="mt-3 leading-relaxed text-[#e6e2d4]">{event.aiSummary}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={eventHref(event)}
              className="rounded-full bg-[#e9cf8a] px-5 py-2.5 text-sm font-semibold text-[#0b1026] hover:bg-[#f3dc8c]"
            >
              See the full listing
            </Link>
            <HeartButton eventId={event.id} title={event.title} {...HEART} />
          </div>
        </div>
      </div>
    </EventDialog>
  );
}

/** One event in a day's list: a small poster beside its title, time and place */
function Row({ event, controls }: { event: HolidayEvent; controls?: ReactNode }) {
  const when = time(event);
  return (
    <li className="flex gap-3">
      <Details event={event} />
      <PopupLink
        eventId={event.id}
        href={eventHref(event)}
        hidden
        className="w-20 shrink-0 self-start border-[3px] border-[#e9cf8a]/80 bg-[#e9cf8a]/80"
      >
        <Poster
          src={hasLoadableEventImage(event.imageUrl) ? event.imageUrl : null}
          title={event.title}
          sizes="80px"
          flyerTextClass="text-[10px]"
          {...FLYER}
        />
      </PopupLink>
      <div className="min-w-0">
        <PopupLink eventId={event.id} href={eventHref(event)} className={titleLink}>
          {event.title}
        </PopupLink>
        <p className="mt-0.5 text-sm text-[#c9cfdc]">
          {when && `${when}, `}
          {venueLine(event)}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <HeartButton eventId={event.id} title={event.title} {...HEART} />
          {controls}
        </div>
      </div>
    </li>
  );
}

function Days({
  days,
  controlsFor,
}: {
  days: DayList[];
  controlsFor: (e: HolidayEvent) => ReactNode;
}) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {days.map(([day, list]) => (
        <div key={day} className="rounded-sm border border-[#e9cf8a]/20 bg-white/[.04] p-4 sm:p-5">
          <h3 className="border-b border-[#e9cf8a]/20 pb-2 text-sm font-semibold text-[#e9cf8a]">
            {longDay(list[0].startDate)}
          </h3>
          <ul className="mt-3 flex flex-col gap-4">
            {[...list].sort(byTime).map((e) => (
              <Row key={e.id} event={e} controls={controlsFor(e)} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Section({
  heading,
  note,
  children,
}: {
  heading: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="pt-14">
      <h2
        className={`${limelight.className} text-center text-[2rem] leading-tight text-[#fff6d6] sm:text-[2.6rem]`}
      >
        {heading}
      </h2>
      <p className="mt-1 text-center text-[#e9cf8a]">{note}</p>
      {children}
    </section>
  );
}

export default async function NewYearsPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  // Per request: the countdown's night and the lists move with the date
  await connection();
  const {
    today,
    lastDay,
    open,
    previewing,
    canPreview,
    over,
    failed,
    admin,
    addedIds,
    isHidden,
    wallStart,
    wallEnd,
    picks,
    beforeDays,
    afterDays,
    hiddenHere,
  } = await loadHolidayPage('newyear', {
    audience: 'all',
    byDate: true,
    wallSize: WALL_SIZE,
    perDay: PER_DAY,
    preview: (await searchParams).preview === '1',
  });
  const controlsFor = (e: HolidayEvent) =>
    admin ? (
      <AdminControls
        season="newyear"
        eventId={e.id}
        added={addedIds.includes(e.id)}
        hidden={isHidden(e.id)}
        variant="inline"
      />
    ) : undefined;
  const moreHref = `/events?tagsInclude=New%20Year&dateFilter=custom&dateStart=${today}&dateEnd=${lastDay}`;
  const empty = picks.length === 0 && beforeDays.length === 0 && afterDays.length === 0;
  const link = 'font-semibold text-[#e9cf8a] underline decoration-[#e9cf8a]/50 underline-offset-4';
  // The end of New Year's Eve, which is midnight
  const midnight = new Date(wallEnd.getTime() + 1).toISOString();

  return (
    <SeasonPreview seasonKey={previewing ? 'newyear' : null}>
      <main className="flex min-h-screen flex-col overflow-x-clip text-[#fff6d6]" style={SKY}>
        <FavoritesSync />
        <Header />
        {previewing && (
          <PreviewNotice
            path="/new-years"
            className="bg-[#e9cf8a] text-[#0b1026] hover:bg-[#f3dc8c]"
          />
        )}

        <div
          className={`${josefin.className} mx-auto w-full max-w-6xl flex-grow px-4 py-10 sm:px-6 sm:py-16`}
        >
          <header className="text-center">
            <Toast />
            <h1
              className={`${limelight.className} mt-4 text-[clamp(2.4rem,8vw,5rem)] leading-[1] text-[#fff6d6]`}
            >
              New Year&apos;s Eve
              <br />
              in Asheville
            </h1>
            {open && <Countdown midnight={midnight} />}
          </header>

          {!open ? (
            <p className="py-14 text-center text-lg">
              {over
                ? "That's a wrap on New Year's for this year."
                : "New Year's plans go up on December 26."}{' '}
              <Link href="/events" className={link}>
                See what&apos;s on now
              </Link>
              {canPreview && (
                <PreviewLink className="bg-[#e9cf8a] text-[#0b1026] hover:bg-[#f3dc8c]" />
              )}
            </p>
          ) : failed ? (
            <p className="py-14 text-center">The page didn&apos;t load. Reload it in a minute.</p>
          ) : empty ? (
            <p className="py-14 text-center">
              Nothing planned yet.{' '}
              <Link href="/events" className={link}>
                See what&apos;s on now
              </Link>
            </p>
          ) : (
            <>
              {beforeDays.length > 0 && (
                <Section heading="Before the big night" note="The best of each day until then">
                  <Days days={beforeDays} controlsFor={controlsFor} />
                </Section>
              )}

              {picks.length > 0 && (
                <Section heading="New Year's Eve" note={longDay(wallStart)}>
                  {admin && <AdminWallSearch season="newyear" onWall={picks.map((e) => e.id)} />}
                  <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-3">
                    {picks.map((e) => {
                      const when = time(e);
                      return (
                        <li key={e.id} className="flex flex-col">
                          <Details event={e} />
                          <PopupLink
                            eventId={e.id}
                            href={eventHref(e)}
                            hidden
                            className="block border-[6px] border-[#e9cf8a] bg-[#e9cf8a] shadow-[0_12px_28px_rgba(0,0,0,.5)]"
                          >
                            <Poster
                              src={hasLoadableEventImage(e.imageUrl) ? e.imageUrl : null}
                              title={e.title}
                              sizes="(min-width: 1024px) 360px, 45vw"
                              flyerTextClass="text-lg sm:text-xl"
                              {...FLYER}
                            />
                          </PopupLink>
                          <PopupLink
                            eventId={e.id}
                            href={eventHref(e)}
                            className={`mt-3 ${titleLink}`}
                          >
                            {e.title}
                          </PopupLink>
                          <p className="mt-0.5 text-sm text-[#c9cfdc]">
                            {when ?? 'All day'}, {venueLine(e)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <HeartButton eventId={e.id} title={e.title} {...HEART} />
                            {controlsFor(e)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {afterDays.length > 0 && (
                <Section
                  heading="New Year's Day"
                  note="Hikes, plunges and brunch to start the year"
                >
                  <Days days={afterDays} controlsFor={controlsFor} />
                </Section>
              )}

              <p className="pt-14 text-center">
                <Link
                  href={moreHref}
                  className="inline-flex rounded-full bg-[#e9cf8a] px-6 py-3 font-semibold text-[#0b1026] hover:bg-[#f3dc8c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff6d6]"
                >
                  See every New Year&apos;s event
                </Link>
              </p>
            </>
          )}

          {admin && hiddenHere.length > 0 && (
            <section className="mt-14 rounded-sm border border-[#e9cf8a]/20 bg-white/[.04] p-5">
              <h2 className="text-lg font-bold">Hidden from this page (admin only)</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {hiddenHere.map((e) => (
                  <li key={e.id} className="rounded border border-[#e9cf8a]/20 p-3">
                    <Link href={eventHref(e)} className="font-semibold hover:underline">
                      {e.title}
                    </Link>
                    <span className="ml-2 text-sm text-[#c9cfdc]">{longDay(e.startDate)}</span>
                    {controlsFor(e)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="bg-[#05081a] py-8 text-center text-sm text-[#c9cfdc]">
          <FooterCredit />
        </footer>
      </main>
    </SeasonPreview>
  );
}
