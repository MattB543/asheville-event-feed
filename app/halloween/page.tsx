import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import Sky from '@/components/halloween/Sky';
import Poster from '@/components/halloween/Poster';
import HeartButton, { FavoritesSync } from '@/components/halloween/HeartButton';
import {
  BatSwarm,
  BloodDrips,
  CrawlingSpider,
  Embers,
  FloatingCandles,
  Leaf,
  LowFog,
  Cobweb,
  DripLetter,
  Eyes,
  Graveyard,
  Pumpkin,
  SheetGhost,
  SkullDivider,
  Specter,
  Bat,
} from '@/components/halloween/Decor';
import { creepster, fraunces } from '@/components/halloween/fonts';
import {
  getHalloweenEvents,
  type HalloweenAudience,
  type HalloweenEvent,
} from '@/lib/db/queries/halloween';
import { addDaysToDateString } from '@/lib/utils/dateFilters';
import { hasLoadableEventImage } from '@/lib/utils/eventImages';
import { formatPriceDisplay } from '@/lib/utils/priceDisplay';
import { generateEventSlug } from '@/lib/utils/slugify';
import {
  formatDateEastern,
  getDateStringEastern,
  getDayBoundariesEastern,
  getStartOfTodayEastern,
  getTodayStringEastern,
} from '@/lib/utils/timezone';
import { venueLine } from '@/lib/utils/venueName';
import { SITE_URL } from '@/lib/seo/site';
import './halloween.css';

const title = 'Halloween in Asheville';
const description =
  'The strangest, spookiest things to do in Asheville before Halloween: goth proms, drag, burlesque, horror screenings and haunted storytelling.';

export const metadata: Metadata = {
  title: `${title}: the wildest events`,
  description,
  alternates: { canonical: `${SITE_URL}/halloween` },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/halloween`,
    siteName: 'AVL GO',
    type: 'website',
  },
};

const WEEKEND_PICKS = 10;
const PER_DAY = 3;
const TILTS = [
  '-2deg',
  '1.5deg',
  '-1deg',
  '2.5deg',
  '-2.5deg',
  '1deg',
  '-1.5deg',
  '2deg',
  '-0.5deg',
  '1.8deg',
];

const eventHref = (e: HalloweenEvent) => `/events/${generateEventSlug(e.title, e.startDate, e.id)}`;
// Posters saved by hand from sources that block other sites or whose links expired
const SAVED_POSTERS = new Set([
  '2847b5b6-e992-4d5a-8a33-b9980113c579',
  'c5a5a9f8-146e-400f-a00c-22300421b9ab',
  '518a629a-d693-474e-a8fc-50f558c7abb8',
  '3d3f5832-5753-4bcd-b570-32466b7d510d',
  'b634f90b-7101-4f44-aaec-996da7d65a91',
  '4fe23d8e-01fb-47b5-b8df-cf2e122e39cb',
  '29a6965e-8f41-4fc8-ba57-965b8a08cfb1',
  '0c3f213b-f593-4082-a47f-d983b14bf1e0',
]);
const image = (e: HalloweenEvent) =>
  SAVED_POSTERS.has(e.id)
    ? `/halloween/${e.id}.jpg`
    : hasLoadableEventImage(e.imageUrl)
      ? e.imageUrl
      : null;
const price = (e: HalloweenEvent) =>
  e.price && e.price !== 'Unknown' ? formatPriceDisplay(e.price) : null;
const time = (e: HalloweenEvent) =>
  e.timeUnknown ? null : formatDateEastern(e.startDate, { hour: 'numeric', minute: '2-digit' });

function WallPoster({ event, index }: { event: HalloweenEvent; index: number }) {
  const day = formatDateEastern(event.startDate, { weekday: 'short' });
  const when = time(event) ? `${day} ${time(event)}` : day;
  const cost = price(event);
  return (
    <Link href={eventHref(event)} className="block no-underline">
      <div
        className="relative bg-[#f3eee2] p-[9px] pb-3 shadow-[0_14px_28px_rgba(0,0,0,.6)]"
        style={{ transform: `rotate(${TILTS[index % TILTS.length]})` }}
      >
        <span
          aria-hidden="true"
          className="absolute -top-[11px] left-1/2 -ml-[42px] h-[22px] w-[84px] bg-[rgba(230,220,180,.78)]"
          style={{ transform: `rotate(${TILTS[(index + 3) % TILTS.length]})` }}
        />
        <Poster
          src={image(event)}
          title={event.title}
          when={when}
          venue={venueLine(event)}
          sizes="(min-width: 1024px) 280px, (min-width: 640px) 45vw, 90vw"
          flyerTextClass="text-[28px]"
        />
        <div className="pt-[9px] text-[#1a1416]">
          <div className="text-xs font-bold uppercase tracking-wide text-[#b4470c]">{when}</div>
          <div className="mt-0.5 text-[15px] font-semibold leading-tight">{event.title}</div>
          <div className="mt-0.5 text-[13px] text-[#5a5257]">
            {venueLine(event)}
            {cost && ` · ${cost}`}
          </div>
        </div>
      </div>
    </Link>
  );
}

function EventCard({ event, index }: { event: HalloweenEvent; index: number }) {
  const cost = price(event);
  return (
    <article className="relative flex flex-wrap gap-5 rounded-[14px] border border-[#3b2a5c] bg-gradient-to-br from-[#160d22] to-[#0c0912] to-60% p-4 shadow-[0_0_24px_rgba(124,58,237,.12)] sm:px-5">
      <Cobweb size={64} style={{ position: 'absolute', right: 0, top: 0, opacity: 0.4 }} />
      <Link
        href={eventHref(event)}
        tabIndex={-1}
        aria-hidden="true"
        className="w-[130px] shrink-0 self-start bg-[#f3eee2] p-[7px] shadow-[0_10px_20px_rgba(0,0,0,.55)] sm:w-[170px]"
        style={{ transform: `rotate(${index % 2 ? '1.5deg' : '-1.5deg'})` }}
      >
        <Poster src={image(event)} title={event.title} sizes="170px" flyerTextClass="text-[20px]" />
      </Link>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {time(event) && <span className="text-sm font-bold text-[#ffb35c]">{time(event)}</span>}
        </div>
        <Link
          href={eventHref(event)}
          className="text-xl font-bold leading-tight text-[#f1e7d0] no-underline hover:text-[#ffb35c]"
        >
          {event.title}
        </Link>
        <span className="text-sm text-gray-400">{venueLine(event)}</span>
        {event.aiSummary && (
          <p className="mt-1 text-[15px] leading-relaxed text-gray-300">{event.aiSummary}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {cost && (
            <span className="rounded-[5px] border border-[#b4470c] bg-[#2b1405] px-2 py-0.5 text-[13px] font-bold text-[#ffb35c]">
              {cost}
            </span>
          )}
          {(event.tags ?? []).slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-[5px] border border-[#4c2f73] bg-[#221433] px-2 py-0.5 text-[13px] text-[#cdb8f5]"
            >
              {tag}
            </span>
          ))}
          <span className="flex-1" />
          <HeartButton eventId={event.id} title={event.title} />
        </div>
      </div>
    </article>
  );
}

function Tombstone({ date }: { date: Date }) {
  return (
    <div className="w-[72px] shrink-0 sm:w-[84px]">
      <div className="flex h-[88px] flex-col items-center justify-center rounded-t-[42px] rounded-b-md border border-[#5d6270] bg-gradient-to-b from-[#4b4f5c] to-[#2c2f38] shadow-[0_6px_0_#14161c] sm:h-[98px]">
        <span className="text-xs font-bold tracking-[.12em] text-[#cfd3dc]">
          {formatDateEastern(date, { weekday: 'short' }).toUpperCase()}
        </span>
        <span
          className={`${creepster.className} text-[34px] leading-none text-gray-100 sm:text-[38px]`}
        >
          {formatDateEastern(date, { day: 'numeric' })}
        </span>
        <span className="text-[11px] font-semibold text-[#a3a8b4]">
          {formatDateEastern(date, { month: 'short' }).toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function AudienceToggle({ audience }: { audience: HalloweenAudience }) {
  const option = (value: HalloweenAudience, label: string, href: string) => (
    <Link
      href={href}
      scroll={false}
      aria-current={audience === value ? 'true' : undefined}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        audience === value ? 'bg-[#ff8a1f] text-[#1a0a00]' : 'text-[#ffd7a8] hover:bg-white/10'
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex gap-0.5 rounded-full border border-white/15 bg-black/50 p-0.5">
      {option('wild', 'After dark', '/halloween')}
      {option('family', 'Family-friendly', '/halloween?for=family')}
    </div>
  );
}

export default async function HalloweenPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>;
}) {
  const audience: HalloweenAudience = (await searchParams).for === 'family' ? 'family' : 'wild';
  const family = audience === 'family';
  // Per request: the countdown and "before the big night" move with the date
  await connection();

  const today = getTodayStringEastern();
  const halloween = `${today.slice(0, 4)}-10-31`;
  const eve = addDaysToDateString(halloween, -1);
  const over = today > halloween;
  const daysLeft = Math.round(
    (Date.parse(`${halloween}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000
  );

  let events: HalloweenEvent[] = [];
  let failed = false;
  if (!over) {
    try {
      events = await getHalloweenEvents(
        getStartOfTodayEastern(),
        getDayBoundariesEastern(halloween).end,
        audience
      );
    } catch (error) {
      console.error('[Halloween] Failed to load events:', error);
      failed = true;
    }
  }

  const bigStart = getDayBoundariesEastern(eve).start;
  const picks = events.filter((e) => e.startDate >= bigStart).slice(0, WEEKEND_PICKS);
  const columns = [0, 1, 2, 3].map((c) => picks.filter((_, i) => i % 4 === c));
  const days = new Map<string, HalloweenEvent[]>();
  for (const e of events.filter((e) => e.startDate < bigStart)) {
    const key = getDateStringEastern(e.startDate);
    const list = days.get(key) ?? [];
    if (list.length < PER_DAY) days.set(key, [...list, e]);
  }
  const beforeDays = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));

  const halloweenDate = getDayBoundariesEastern(halloween).start;
  const weekendHeading = ['Sat', 'Sun'].includes(
    formatDateEastern(halloweenDate, { weekday: 'short' })
  )
    ? 'Halloween weekend'
    : 'Halloween eve and night';
  const longDay = (d: Date) =>
    formatDateEastern(d, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <main className="hw-page min-h-screen flex flex-col bg-[#030712] text-gray-200">
      <FavoritesSync />
      <Header />
      {!family && <BloodDrips />}

      <Sky>
        <h1
          className={`${fraunces.className} m-0 text-[clamp(40px,6vw,72px)] leading-none text-[#fff4e6] [text-shadow:0_2px_18px_rgba(0,0,0,.7)]`}
        >
          Halloween in Ashevill{family ? 'e' : <DripLetter>e</DripLetter>}
        </h1>
        <p className="mt-3 text-[17px] text-[#d6d0e6]">
          {family
            ? 'Trick-or-treating, costume parades and spooky fun for kids'
            : 'The strangest, spookiest things to do'}{' '}
          from now through {longDay(halloweenDate)}
        </p>
        {!over && (
          <div className="absolute right-3 top-3 sm:right-6">
            <AudienceToggle audience={audience} />
          </div>
        )}
        {!over && (
          <div className="mt-4 inline-flex items-center gap-2.5 rounded-full border border-[#ff8a1f]/45 bg-[#ff8a1f]/10 py-2 pl-2.5 pr-4">
            <Pumpkin size={30} />
            {daysLeft > 0 ? (
              <>
                <span className="text-[26px] font-extrabold text-[#ffb35c]">{daysLeft}</span>
                <span className="text-[15px] font-semibold text-[#ffd7a8]">
                  {daysLeft === 1 ? 'day' : 'days'} until Halloween
                </span>
              </>
            ) : (
              <span className="text-[17px] font-bold text-[#ffd7a8]">It&apos;s Halloween</span>
            )}
          </div>
        )}
      </Sky>

      <div className="relative mx-auto flex w-full max-w-[1180px] flex-grow flex-col gap-16 px-4 pb-10 pt-10 sm:px-6">
        {/* Things that drift over the content and fade away */}
        <Leaf
          color="#b4470c"
          style={{ left: '22%', top: '8%', animation: 'hw-leaf 26s linear infinite' }}
        />
        <Leaf
          color="#7a2e0e"
          style={{ left: '64%', top: '36%', animation: 'hw-leaf 32s linear infinite -12s' }}
        />
        <Leaf
          color="#8a5a12"
          style={{ left: '8%', top: '62%', animation: 'hw-leaf 29s linear infinite -20s' }}
        />
        <div
          className="hw-float left-[34%] top-[6%] opacity-80"
          style={{ animation: 'hw-rise 12s ease-in-out infinite' }}
        >
          <div style={{ animation: 'hw-wobble 6s ease-in-out infinite' }}>
            <Specter width={70} />
          </div>
        </div>
        <div
          className="hw-float left-[12%] top-[2%]"
          style={{ animation: 'hw-apparition 11s ease-in-out infinite -3s' }}
        >
          <Specter width={56} eyes={false} />
        </div>
        <div
          className="hw-float left-0 top-[30%]"
          style={{ animation: 'hw-drift 28s linear infinite -6s' }}
        >
          <div style={{ animation: 'hw-wobble 7s ease-in-out infinite' }}>
            <Specter width={64} />
          </div>
        </div>
        <div
          className="hw-float left-[70%] top-[78%]"
          style={{ animation: 'hw-apparition 14s ease-in-out infinite -8s' }}
        >
          <Specter width={46} eyes={false} />
        </div>
        <div
          className="hw-float left-[58%] top-[55%] flex gap-6"
          style={{ animation: 'hw-wobble 9s ease-in-out infinite' }}
        >
          {[10, 7, 5].map((size, i) => (
            <span
              key={size}
              className="rounded-full bg-[#b8ffd0]"
              style={{
                width: size,
                height: size,
                marginTop: [0, 22, 8][i],
                boxShadow: `0 0 ${size + 4}px ${size / 2}px rgba(140,255,190,.4)`,
                animation: `hw-twinkle ${3 + i}s ease-in-out infinite -${i}s`,
              }}
            />
          ))}
        </div>
        {!family && (
          <Eyes
            color="#ff3b3b"
            style={{ left: '1%', top: '24%', animation: 'hw-eyes 7s ease-in-out infinite' }}
          />
        )}
        {!family && (
          <Eyes
            color="#b8ffd0"
            style={{ right: '1%', top: '48%', animation: 'hw-eyes 9s ease-in-out infinite' }}
          />
        )}
        {!family && (
          <Eyes
            color="#ff3b3b"
            style={{ left: '48%', top: '88%', animation: 'hw-eyes 11s ease-in-out infinite' }}
          />
        )}
        <div
          className="hw-float left-0 top-[42%]"
          style={{ animation: 'hw-pass 18s linear infinite -4s' }}
        >
          <Bat width={30} color="#0a0612" />
        </div>
        <div
          className="hw-float left-0 top-[68%]"
          style={{ animation: 'hw-pass 23s linear infinite -15s' }}
        >
          <Bat width={22} color="#0a0612" flap="0.26s" />
        </div>

        {over ? (
          <p className="py-16 text-center text-lg text-gray-300">
            Halloween is over for this year.{' '}
            <Link href="/events" className="text-[#ffb35c] hover:underline">
              See what&apos;s on next
            </Link>
          </p>
        ) : failed ? (
          <p className="py-16 text-center text-gray-400">
            The Halloween list is unavailable right now. Please try again shortly.
          </p>
        ) : (
          <>
            {picks.length > 0 && (
              <section className="relative pb-6">
                <LowFog />
                <div className="flex items-center gap-3.5">
                  <span className="relative">
                    <Pumpkin size={58} glow />
                    <Embers style={{ left: 26, top: 10 }} />
                  </span>
                  <div>
                    <h2
                      className={`${creepster.className} m-0 text-[34px] tracking-wide text-[#ff9a3c] sm:text-[42px]`}
                    >
                      {weekendHeading}
                    </h2>
                    <p className="mt-0.5 text-gray-400">
                      {longDay(bigStart)} and {longDay(halloweenDate)} ·{' '}
                      {family ? 'best first' : 'wildest first'}
                    </p>
                  </div>
                </div>
                <div className="mt-9 flex flex-wrap gap-[26px]">
                  {columns.map((column, c) => (
                    <div key={c} className="flex min-w-0 flex-[1_1_220px] flex-col gap-[34px]">
                      {column.map((event, i) => (
                        <WallPoster key={event.id} event={event} index={i * 4 + c} />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {picks.length > 0 && beforeDays.length > 0 && (
              <div className="relative">
                <SkullDivider />
                <BatSwarm style={{ left: '50%', top: 20 }} />
              </div>
            )}

            {beforeDays.length > 0 && (
              <section className="relative">
                <FloatingCandles style={{ right: '4%', top: -10 }} />
                <h2
                  className={`${creepster.className} m-0 text-[32px] tracking-wide text-violet-300 sm:text-[38px]`}
                >
                  Before the big night
                </h2>
                <p className="mb-7 mt-0.5 text-gray-400">
                  {family
                    ? 'The best family Halloween events until then'
                    : 'The wildest Halloween events until then'}
                </p>
                <div className="relative flex flex-col gap-9">
                  <CrawlingSpider />
                  {beforeDays.map(([day, list]) => (
                    <div key={day} className="flex flex-wrap gap-4 sm:gap-[18px]">
                      <Tombstone date={list[0].startDate} />
                      <div className="flex min-w-0 flex-[1_1_600px] flex-col gap-3.5">
                        {list.map((event, i) => (
                          <EventCard key={event.id} event={event} index={i} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {picks.length === 0 && beforeDays.length === 0 && (
              <p className="py-16 text-center text-gray-400">No Halloween events are listed yet.</p>
            )}
          </>
        )}
      </div>

      <Graveyard />
      <footer className="border-t border-gray-800 py-8 text-center text-sm text-gray-400">
        <div
          className="mx-auto mb-2.5 w-fit opacity-75"
          style={{ animation: 'hw-bob 4s ease-in-out infinite' }}
        >
          <SheetGhost size={40} />
        </div>
        <FooterCredit />
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
