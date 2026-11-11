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
import AdventDoor from '@/components/holidays/christmas/AdventDoor';
import SnowyFir from '@/components/holidays/christmas/SnowyFir';
import { EventDialog, PopupLink } from '@/components/holidays/EventPopup';
import MusicToggle from '@/components/holidays/christmas/MusicToggle';
import SendSanta from '@/components/holidays/christmas/SendSanta';
import { bodoni } from '@/components/holidays/christmas/fonts';
import type { HolidayEvent } from '@/lib/holidays/events';
import { eventHref, eventTime, longDay, byTime } from '@/lib/holidays/format';
import { loadHolidayPage, type DayList } from '@/lib/holidays/page';
import { hasLoadableEventImage } from '@/lib/utils/eventImages';
import { formatPriceDisplay } from '@/lib/utils/priceDisplay';
import { formatDateEastern, getTodayStringEastern } from '@/lib/utils/timezone';
import { venueLine } from '@/lib/utils/venueName';
import { SITE_URL } from '@/lib/seo/site';
import './christmas.css';

const title = 'Christmas in Asheville';
const description =
  'Christmas lights, holiday markets, Nutcrackers, carols, Santa and more in Asheville through Christmas Day.';

export function generateMetadata(): Metadata {
  const year = getTodayStringEastern().slice(0, 4);
  return {
    title: `${title} ${year}: Events & Things to Do`,
    description,
    alternates: { canonical: `${SITE_URL}/christmas` },
    openGraph: {
      title: `${title} ${year}`,
      description,
      url: `${SITE_URL}/christmas`,
      siteName: 'AVL GO',
      type: 'website',
    },
  };
}

const WALL_SIZE = 12;
const PER_DAY = 3;
// A still snowfall over pine green: three sizes of flake, each tiled at its own spacing
const SNOW = {
  backgroundColor: '#10291f',
  backgroundImage:
    'radial-gradient(circle, rgba(246,239,226,.55) 1.5px, transparent 2px), radial-gradient(circle, rgba(246,239,226,.3) 1px, transparent 1.5px), radial-gradient(circle, rgba(246,239,226,.18) 2.5px, transparent 3px)',
  backgroundSize: '97px 83px, 53px 61px, 151px 137px',
};
// The stand-in for an event with no poster: a red card with gold lettering
const FLYER = {
  flyerTitleClass: `${bodoni.className} font-bold text-[#e7c873]`,
  flyerBackground: 'linear-gradient(160deg, #9f1239, #5f0a22)',
};

const HEART = {
  onClass: 'border-[#9f1239] bg-[#9f1239] text-white',
  offClass: 'border-[#10291f]/20 text-[#4b5b52] hover:border-[#9f1239] hover:text-[#9f1239]',
};

/** The event's popup: its poster large, then when, where, the price and what it is */
function Details({ event }: { event: HolidayEvent }) {
  const when = eventTime(event);
  const price = event.price && event.price !== 'Unknown' ? formatPriceDisplay(event.price) : null;
  return (
    <EventDialog
      eventId={event.id}
      title={event.title}
      className="bg-[#f6efe2] text-[#10291f] backdrop:bg-[#0b1f17]/80"
      // The double gold border of a Christmas card
      frameClass="border-[3px] border-double border-[#c9a24a]"
      closeClass="text-[#9f1239] hover:bg-[#9f1239]/10"
    >
      <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
        <div className="mx-auto w-48 self-start border-[5px] border-[#c9a24a] bg-[#c9a24a] shadow-[0_10px_24px_rgba(0,0,0,.3)] sm:w-full">
          <Poster
            src={hasLoadableEventImage(event.imageUrl) ? event.imageUrl : null}
            title={event.title}
            sizes="200px"
            flyerTextClass="text-lg"
            {...FLYER}
          />
        </div>
        <div className="min-w-0">
          <p className={`${bodoni.className} text-lg italic text-[#9f1239]`}>
            {longDay(event.startDate)}
            {when && `, ${when}`}
          </p>
          <h2
            className={`${bodoni.className} mt-1 pr-8 text-[1.7rem] font-bold leading-tight sm:text-[2rem]`}
          >
            {event.title}
          </h2>
          <p className="mt-2 text-sm">{venueLine(event)}</p>
          {price && <p className="mt-1 text-sm font-semibold">{price}</p>}
          {event.aiSummary && <p className="mt-3 leading-relaxed">{event.aiSummary}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={eventHref(event)}
              className="rounded-full bg-[#9f1239] px-5 py-2.5 text-sm font-semibold text-[#f6efe2] hover:bg-[#b3153f]"
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

/** One day behind its advent door: each event with its poster, time and place */
function Door({
  day,
  today,
  list,
  controlsFor,
}: {
  day: string;
  today: string;
  list: HolidayEvent[];
  controlsFor: (e: HolidayEvent) => ReactNode;
}) {
  const weekday = formatDateEastern(list[0].startDate, { weekday: 'long' });
  return (
    <AdventDoor day={day} weekday={weekday} today={day === today}>
      <p className="border-b border-[#10291f]/15 pb-2 text-sm font-semibold text-[#9f1239]">
        {longDay(list[0].startDate)}
      </p>
      <ul className="mt-3 flex flex-col gap-4">
        {[...list].sort(byTime).map((e) => {
          const when = eventTime(e);
          return (
            <li key={e.id} className="flex gap-3">
              <Details event={e} />
              <PopupLink
                eventId={e.id}
                href={eventHref(e)}
                hidden
                className="w-24 shrink-0 self-start border-[3px] border-[#c9a24a] bg-[#c9a24a]"
              >
                <Poster
                  src={hasLoadableEventImage(e.imageUrl) ? e.imageUrl : null}
                  title={e.title}
                  sizes="96px"
                  flyerTextClass="text-xs"
                  {...FLYER}
                />
              </PopupLink>
              <div className="min-w-0">
                <PopupLink
                  eventId={e.id}
                  href={eventHref(e)}
                  className="font-semibold leading-snug decoration-[#c9a24a] decoration-2 underline-offset-4 hover:underline"
                >
                  {e.title}
                </PopupLink>
                <p className="mt-0.5 text-sm opacity-75">
                  {when && `${when}, `}
                  {venueLine(e)}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <HeartButton eventId={e.id} title={e.title} {...HEART} />
                  {controlsFor(e)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </AdventDoor>
  );
}

function Doors({
  days,
  today,
  controlsFor,
}: {
  days: DayList[];
  today: string;
  controlsFor: (e: HolidayEvent) => ReactNode;
}) {
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {days.map(([day, list]) => (
        <Door key={day} day={day} today={today} list={list} controlsFor={controlsFor} />
      ))}
    </ul>
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
        className={`${bodoni.className} text-center text-[2rem] font-bold leading-tight text-[#f6efe2] sm:text-[2.6rem]`}
      >
        {heading}
      </h2>
      <p className={`${bodoni.className} mt-1 text-center text-xl italic text-[#e7c873]`}>{note}</p>
      {children}
    </section>
  );
}

export default async function ChristmasPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  // Per request: the calendar moves with the date
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
  } = await loadHolidayPage('christmas', {
    audience: 'all',
    byDate: true,
    wallSize: WALL_SIZE,
    perDay: PER_DAY,
    preview: (await searchParams).preview === '1',
  });
  const controlsFor = (e: HolidayEvent) =>
    admin ? (
      <AdminControls
        season="christmas"
        eventId={e.id}
        added={addedIds.includes(e.id)}
        hidden={isHidden(e.id)}
        variant="inline"
      />
    ) : undefined;
  const moreHref = `/events?tagsInclude=Christmas&dateFilter=custom&dateStart=${today}&dateEnd=${lastDay}`;
  const empty = picks.length === 0 && beforeDays.length === 0 && afterDays.length === 0;
  const link = 'font-semibold text-[#e7c873] underline decoration-[#c9a24a] underline-offset-4';
  const weekend = `${formatDateEastern(wallStart, { month: 'long', day: 'numeric' })} to ${formatDateEastern(wallEnd, { day: 'numeric' })}`;

  return (
    <SeasonPreview seasonKey={previewing ? 'christmas' : null}>
      <main className="flex min-h-screen flex-col overflow-x-clip text-[#f6efe2]" style={SNOW}>
        <FavoritesSync />
        <Header />
        {previewing && (
          <PreviewNotice
            path="/christmas"
            className="bg-[#9f1239] text-[#f6efe2] hover:bg-[#b3153f]"
          />
        )}

        <div className="relative mx-auto w-full max-w-6xl flex-grow px-4 py-10 sm:px-6 sm:py-16">
          <MusicToggle />
          <header className="text-center">
            <SnowyFir />
            <h1
              className={`${bodoni.className} mt-4 text-[clamp(2.6rem,9vw,5.5rem)] font-bold leading-[0.95]`}
            >
              Christmas
              <br />
              in Asheville
            </h1>
            <p
              className={`${bodoni.className} mx-auto mt-4 max-w-lg text-2xl italic text-[#e7c873]`}
            >
              Lights, markets, Nutcrackers and Santa, a day at a time through Christmas
            </p>
            {admin && <SendSanta />}
          </header>

          {!open ? (
            <p className="py-14 text-center text-lg">
              {over ? 'Christmas is over for this year.' : 'The calendar opens on December 1.'}{' '}
              <Link href="/events" className={link}>
                See what&apos;s on now
              </Link>
              {canPreview && (
                <PreviewLink className="bg-[#9f1239] text-[#f6efe2] hover:bg-[#b3153f]" />
              )}
            </p>
          ) : failed ? (
            <p className="py-14 text-center">
              The calendar didn&apos;t load. Reload the page in a minute.
            </p>
          ) : empty ? (
            <p className="py-14 text-center">
              Nothing on the calendar yet.{' '}
              <Link href="/events" className={link}>
                See what&apos;s on now
              </Link>
            </p>
          ) : (
            <>
              {beforeDays.length > 0 && (
                <Section heading="Counting down" note="A door a day, each hiding that day's best">
                  <Doors days={beforeDays} today={today} controlsFor={controlsFor} />
                </Section>
              )}

              {picks.length > 0 && (
                <Section heading="The weekend before Christmas" note={weekend}>
                  {admin && <AdminWallSearch season="christmas" onWall={picks.map((e) => e.id)} />}
                  <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-3">
                    {picks.map((e) => {
                      const when = eventTime(e);
                      return (
                        <li key={e.id} className="flex flex-col">
                          <Details event={e} />
                          <div data-snow-surface>
                            <PopupLink
                              eventId={e.id}
                              href={eventHref(e)}
                              hidden
                              className="block border-[6px] border-[#c9a24a] bg-[#c9a24a] shadow-[0_12px_28px_rgba(0,0,0,.45)]"
                            >
                              <Poster
                                src={hasLoadableEventImage(e.imageUrl) ? e.imageUrl : null}
                                title={e.title}
                                sizes="(min-width: 1024px) 360px, 45vw"
                                flyerTextClass="text-lg sm:text-xl"
                                {...FLYER}
                              />
                            </PopupLink>
                          </div>
                          <PopupLink
                            eventId={e.id}
                            href={eventHref(e)}
                            className="mt-3 font-semibold leading-snug decoration-[#c9a24a] decoration-2 underline-offset-4 hover:underline"
                          >
                            {e.title}
                          </PopupLink>
                          <p className="mt-0.5 text-sm text-[#f6efe2]/75">
                            {formatDateEastern(e.startDate, { weekday: 'long' })}
                            {when && ` ${when}`}, {venueLine(e)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <HeartButton
                              eventId={e.id}
                              title={e.title}
                              onClass="border-[#9f1239] bg-[#9f1239] text-white"
                              offClass="border-[#f6efe2]/30 text-[#f6efe2] hover:border-[#e7c873] hover:text-[#e7c873]"
                            />
                            {controlsFor(e)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {afterDays.length > 0 && (
                <Section heading="The last days" note="Through Christmas Day">
                  <Doors days={afterDays} today={today} controlsFor={controlsFor} />
                </Section>
              )}

              <p className="pt-14 text-center">
                <Link
                  href={moreHref}
                  data-snow-surface
                  className="inline-flex rounded-full bg-[#9f1239] px-6 py-3 font-semibold text-[#f6efe2] hover:bg-[#b3153f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e7c873]"
                >
                  See every Christmas event
                </Link>
              </p>
            </>
          )}

          {admin && hiddenHere.length > 0 && (
            <section className="mt-14 rounded-sm bg-[#f6efe2] p-5 text-[#10291f]">
              <h2 className="text-lg font-bold">Hidden from this page (admin only)</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {hiddenHere.map((e) => (
                  <li key={e.id} className="rounded border border-[#10291f]/15 p-3">
                    <Link href={eventHref(e)} className="font-semibold hover:underline">
                      {e.title}
                    </Link>
                    <span className="ml-2 text-sm opacity-75">{longDay(e.startDate)}</span>
                    {controlsFor(e)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="bg-[#0b1f17] py-8 text-center text-sm text-[#f6efe2]/70">
          <FooterCredit />
        </footer>
      </main>
    </SeasonPreview>
  );
}
