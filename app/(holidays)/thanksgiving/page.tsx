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
import { Flourish, Fork, Knife } from '@/components/holidays/thanksgiving/Tableware';
import SquawkingTurkey from '@/components/holidays/thanksgiving/SquawkingTurkey';
import { fraunces } from '@/components/holidays/thanksgiving/fonts';
import type { HolidayEvent } from '@/lib/holidays/events';
import { eventHref, eventTime, longDay, byTime } from '@/lib/holidays/format';
import { loadHolidayPage, type DayList } from '@/lib/holidays/page';
import { hasLoadableEventImage } from '@/lib/utils/eventImages';
import { formatPriceDisplay } from '@/lib/utils/priceDisplay';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import { venueLine } from '@/lib/utils/venueName';
import { SITE_URL } from '@/lib/seo/site';

const title = 'Thanksgiving in Asheville';
const description =
  'Thanksgiving dinners, turkey trots, Friendsgivings, shows and more in Asheville through Thanksgiving weekend.';

export function generateMetadata(): Metadata {
  const year = getTodayStringEastern().slice(0, 4);
  return {
    title: `${title} ${year}: Events & Things to Do`,
    description,
    alternates: { canonical: `${SITE_URL}/thanksgiving` },
    openGraph: {
      title: `${title} ${year}`,
      description,
      url: `${SITE_URL}/thanksgiving`,
      siteName: 'AVL GO',
      type: 'website',
    },
  };
}

const WALL_SIZE = 12;
const PER_DAY = 3;
// A red-and-cream gingham tablecloth, drawn with two crossing stripes
const GINGHAM = {
  backgroundColor: '#f6ead8',
  backgroundImage:
    'linear-gradient(90deg, rgba(158,27,50,.22) 50%, transparent 50%), linear-gradient(rgba(158,27,50,.22) 50%, transparent 50%)',
  backgroundSize: '44px 44px',
};
// The stand-in for an event with no poster: a little chalkboard special
const FLYER = {
  flyerTitleClass: `${fraunces.className} font-semibold text-[#f6ead8]`,
  flyerBackground: 'linear-gradient(160deg, #2f3b36, #1d2622)',
};

/** The event's popup: a card off the menu, with its poster, when and where, and what it is */
function Details({ event }: { event: HolidayEvent }) {
  const when = eventTime(event);
  const price = event.price && event.price !== 'Unknown' ? formatPriceDisplay(event.price) : null;
  return (
    <EventDialog
      eventId={event.id}
      title={event.title}
      className="bg-[#fffaf0] text-[#2a1a14] backdrop:bg-[#2a1a14]/70"
      // The menu's own double border
      frameClass="border-[3px] border-double border-[#8f1d2c]/60"
      closeClass="text-[#8f1d2c] hover:bg-[#8f1d2c]/10"
    >
      <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
        <div className="mx-auto w-48 rotate-[-2deg] self-start bg-white p-1.5 shadow-[0_6px_14px_rgba(60,30,20,.25)] sm:w-full">
          <Poster
            src={hasLoadableEventImage(event.imageUrl) ? event.imageUrl : null}
            title={event.title}
            sizes="200px"
            flyerTextClass="text-lg"
            {...FLYER}
          />
        </div>
        <div className="min-w-0">
          <p className={`${fraunces.className} text-lg italic text-[#8f1d2c]`}>
            {longDay(event.startDate)}
            {when && `, ${when}`}
          </p>
          <h2
            className={`${fraunces.className} mt-1 pr-8 text-[1.7rem] font-black leading-tight sm:text-[2rem]`}
          >
            {event.title}
          </h2>
          <p className="mt-2 text-sm text-[#6b5a50]">{venueLine(event)}</p>
          {price && (
            <p className={`${fraunces.className} mt-1 font-semibold text-[#8f1d2c]`}>{price}</p>
          )}
          {event.aiSummary && (
            <p className={`${fraunces.className} mt-3 italic leading-relaxed text-[#4a3a32]`}>
              {event.aiSummary}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={eventHref(event)}
              className="rounded-full bg-[#8f1d2c] px-5 py-2.5 text-sm font-semibold text-[#fffaf0] hover:bg-[#a32437]"
            >
              See the full listing
            </Link>
            <HeartButton
              eventId={event.id}
              title={event.title}
              onClass="border-[#8f1d2c] bg-[#8f1d2c] text-white"
              offClass="border-[#2a1a14]/20 text-[#6b5a50] hover:border-[#8f1d2c] hover:text-[#8f1d2c]"
            />
          </div>
        </div>
      </div>
    </EventDialog>
  );
}

/** One dish: its photo clipped on, the name with dotted leaders out to the price */
function Dish({
  event,
  big,
  chefsPick,
  controls,
}: {
  event: HolidayEvent;
  big?: boolean;
  chefsPick?: boolean;
  controls?: ReactNode;
}) {
  // A menu never leaves a price blank
  const cost =
    event.price && event.price !== 'Unknown' ? formatPriceDisplay(event.price) : 'Market price';
  const when = eventTime(event);
  return (
    <li className="flex gap-4 py-5 sm:gap-6">
      <Details event={event} />
      <PopupLink
        eventId={event.id}
        href={eventHref(event)}
        hidden
        className={`relative shrink-0 self-start bg-white p-1.5 shadow-[0_6px_14px_rgba(60,30,20,.25)] ${
          big ? 'w-24 rotate-[-2deg] sm:w-36' : 'w-20 rotate-[1.5deg] sm:w-24'
        }`}
      >
        {/* The paper clip holding the photo to the menu */}
        <span
          aria-hidden="true"
          className="absolute -top-2.5 left-3 z-10 h-6 w-3 rounded-full border-2 border-[#9aa0a8]"
        />
        <Poster
          src={hasLoadableEventImage(event.imageUrl) ? event.imageUrl : null}
          title={event.title}
          sizes={big ? '(min-width: 640px) 144px, 96px' : '(min-width: 640px) 96px, 80px'}
          flyerTextClass={big ? 'text-sm sm:text-lg' : 'text-xs sm:text-sm'}
          {...FLYER}
        />
      </PopupLink>
      <div className="min-w-0 flex-1">
        {/* Dotted leaders run from the end of the title's last line out to the price, as on a
            printed menu: the dots are the row's background, and the title's own fill hides them */}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 sm:bg-[radial-gradient(circle,rgba(42,26,20,.35)_1.2px,transparent_1.6px)] sm:bg-[length:8px_6px] sm:bg-[position:left_bottom_0.4em] sm:bg-repeat-x">
            <PopupLink
              eventId={event.id}
              href={eventHref(event)}
              className={`${fraunces.className} box-decoration-clone bg-[#fffaf0] pr-2 font-semibold leading-snug text-[#2a1a14] decoration-[#c8702a] decoration-2 underline-offset-4 hover:underline ${
                big ? 'text-[1.2rem] sm:text-[1.4rem]' : 'text-[1.1rem] sm:text-[1.2rem]'
              }`}
            >
              {event.title}
            </PopupLink>
          </div>
          <span
            className={`${fraunces.className} hidden shrink-0 text-[1.05rem] font-semibold leading-snug text-[#8f1d2c] sm:inline ${
              cost === 'Market price' ? 'italic font-normal' : ''
            }`}
          >
            {cost}
          </span>
        </div>
        {chefsPick && (
          <span
            className={`${fraunces.className} mt-1.5 inline-block -rotate-3 rounded-full border-2 border-[#8f1d2c] px-2.5 py-0.5 text-sm font-semibold italic text-[#8f1d2c]`}
          >
            Chef&apos;s pick
          </span>
        )}
        {event.aiSummary && (
          <p
            className={`${fraunces.className} mt-1 line-clamp-2 max-w-[60ch] text-[15px] italic leading-relaxed text-[#4a3a32]`}
          >
            {event.aiSummary}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-[#6b5a50]">
          <span>
            {when && <span className="font-semibold text-[#2a1a14]">{when}, </span>}
            {venueLine(event)}
            {/* On phones there's no room for the leaders, so the price joins this line */}
            <span className="sm:hidden">, {cost.toLowerCase()}</span>
          </span>
          <HeartButton
            eventId={event.id}
            title={event.title}
            onClass="border-[#8f1d2c] bg-[#8f1d2c] text-white"
            offClass="border-[#2a1a14]/20 text-[#6b5a50] hover:border-[#8f1d2c] hover:text-[#8f1d2c]"
          />
          {controls}
        </div>
      </div>
    </li>
  );
}

function Course({ name, note, children }: { name: string; note: string; children: ReactNode }) {
  return (
    <section className="pt-8">
      <Flourish />
      <h2
        className={`${fraunces.className} text-center text-[2rem] font-black leading-tight text-[#2a1a14] sm:text-[2.6rem]`}
      >
        {name}
      </h2>
      <p className={`${fraunces.className} text-center italic text-[#6b5a50]`}>{note}</p>
      {children}
    </section>
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
    <div className="mt-4 flex flex-col gap-4">
      {days.map(([day, list]) => (
        <div key={day}>
          <h3
            className={`${fraunces.className} border-b border-[#2a1a14]/15 pb-1 text-lg font-semibold italic text-[#8f1d2c]`}
          >
            {longDay(list[0].startDate)}
          </h3>
          <ul className="divide-y divide-dashed divide-[#2a1a14]/15">
            {[...list].sort(byTime).map((e) => (
              <Dish key={e.id} event={e} controls={controlsFor(e)} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default async function ThanksgivingPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  // Per request: the courses move with the date
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
    picks,
    beforeDays,
    afterDays,
    hiddenHere,
  } = await loadHolidayPage('thanksgiving', {
    audience: 'all',
    // Best first, so the top dish can be the chef's pick; each list is then shown by time
    byDate: false,
    wallSize: WALL_SIZE,
    perDay: PER_DAY,
    preview: (await searchParams).preview === '1',
  });
  const chefsPick = picks.find((e) => !addedIds.includes(e.id))?.id;
  const controlsFor = (e: HolidayEvent) =>
    admin ? (
      <AdminControls
        season="thanksgiving"
        eventId={e.id}
        added={addedIds.includes(e.id)}
        hidden={isHidden(e.id)}
        variant="inline"
      />
    ) : undefined;
  const moreHref = `/events?tagsInclude=Thanksgiving&dateFilter=custom&dateStart=${today}&dateEnd=${lastDay}`;
  const empty = picks.length === 0 && beforeDays.length === 0 && afterDays.length === 0;
  const link = 'font-semibold text-[#8f1d2c] underline decoration-[#c8702a] underline-offset-4';

  return (
    <SeasonPreview seasonKey={previewing ? 'thanksgiving' : null}>
      <main className="flex min-h-screen flex-col overflow-x-clip" style={GINGHAM}>
        <FavoritesSync />
        <Header />
        {previewing && (
          <PreviewNotice
            path="/thanksgiving"
            className="bg-[#8f1d2c] text-[#fffaf0] hover:bg-[#a32437]"
          />
        )}

        <div className="relative mx-auto w-full max-w-[820px] flex-grow px-3 py-8 sm:px-6 sm:py-14">
          {/* Laid either side of the menu and kept there as the page scrolls */}
          <Fork className="fixed left-[calc(50%-410px-4rem)] top-40 hidden h-72 w-10 rotate-[-4deg] drop-shadow-md xl:block" />
          <Knife className="fixed right-[calc(50%-410px-4rem)] top-44 hidden h-72 w-10 rotate-[3deg] drop-shadow-md xl:block" />

          <article className="relative rounded-sm bg-[#fffaf0] px-4 py-8 text-[#2a1a14] shadow-[0_24px_48px_rgba(70,20,20,.35)] sm:px-12 sm:py-12">
            {/* The menu's double border */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-2 border-[3px] border-double border-[#8f1d2c]/60 sm:inset-4"
            />

            <header className="relative text-center">
              <SquawkingTurkey />
              <h1
                className={`${fraunces.className} mt-3 text-[clamp(2.4rem,8vw,4.5rem)] font-black leading-[0.95] tracking-tight`}
              >
                Thanksgiving
                <br />
                in Asheville
              </h1>
              <p className={`${fraunces.className} mt-3 text-lg italic text-[#6b5a50]`}>
                Served now through the long weekend
              </p>
            </header>

            {!open ? (
              <p className="relative py-12 text-center text-lg">
                {over
                  ? 'The kitchen is closed for this year.'
                  : 'Thanksgiving events go on the menu in November.'}{' '}
                <Link href="/events" className={link}>
                  See what&apos;s on now
                </Link>
                {canPreview && (
                  <PreviewLink className="bg-[#8f1d2c] text-[#fffaf0] hover:bg-[#a32437]" />
                )}
              </p>
            ) : failed ? (
              <p className="relative py-12 text-center">
                The menu didn&apos;t load. Reload the page in a minute.
              </p>
            ) : empty ? (
              <p className="relative py-12 text-center">
                Nothing on the menu yet.{' '}
                <Link href="/events" className={link}>
                  See what&apos;s on now
                </Link>
              </p>
            ) : (
              <div className="relative">
                {beforeDays.length > 0 && (
                  <Course name="Appetizers" note={`The days before, ${PER_DAY} a day`}>
                    <Days days={beforeDays} controlsFor={controlsFor} />
                  </Course>
                )}

                {picks.length > 0 && (
                  <Course name="The Main Course" note={longDay(wallStart)}>
                    {admin && (
                      <AdminWallSearch
                        season="thanksgiving"
                        onWall={picks.map((e) => e.id)}
                        tone="light"
                      />
                    )}
                    <ul className="mt-4 divide-y divide-dashed divide-[#2a1a14]/15">
                      {[...picks].sort(byTime).map((e) => (
                        <Dish
                          key={e.id}
                          event={e}
                          big
                          chefsPick={e.id === chefsPick}
                          controls={controlsFor(e)}
                        />
                      ))}
                    </ul>
                  </Course>
                )}

                {afterDays.length > 0 && (
                  <Course name="Leftovers" note="The long weekend">
                    <Days days={afterDays} controlsFor={controlsFor} />
                  </Course>
                )}

                <Course name="Dessert" note="Still hungry?">
                  <p className="mt-4 text-center">
                    <Link
                      href={moreHref}
                      className="inline-flex rounded-full bg-[#8f1d2c] px-6 py-3 font-semibold text-[#fffaf0] hover:bg-[#a32437] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2a1a14]"
                    >
                      See every Thanksgiving event
                    </Link>
                  </p>
                </Course>
              </div>
            )}

            {admin && hiddenHere.length > 0 && (
              <section className="relative mt-12">
                <h2 className="text-lg font-bold">Hidden from this page (admin only)</h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {hiddenHere.map((e) => (
                    <li key={e.id} className="rounded border border-[#2a1a14]/15 p-3">
                      <Link href={eventHref(e)} className="font-semibold hover:underline">
                        {e.title}
                      </Link>
                      <span className="ml-2 text-sm text-[#6b5a50]">{longDay(e.startDate)}</span>
                      {controlsFor(e)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        </div>
        <footer className="bg-[#fffaf0]/90 py-8 text-center text-sm text-[#6b5a50]">
          <FooterCredit />
        </footer>
      </main>
    </SeasonPreview>
  );
}
