import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { CalendarDays, Candy, Moon, Skull, Star, type LucideIcon } from 'lucide-react';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import Sky from '@/components/halloween/Sky';
import Poster from '@/components/halloween/Poster';
import HeartButton, { FavoritesSync } from '@/components/halloween/HeartButton';
import AdminControls from '@/components/halloween/AdminControls';
import AdminWallSearch from '@/components/halloween/AdminWallSearch';
import { getSeasonPicks, type SeasonPick } from '@/lib/db/queries/seasonPicks';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import {
  BatSwarm,
  BloodDrips,
  CrawlingSpider,
  Embers,
  FloatingCandles,
  LeafGust,
  LowFog,
  Cobweb,
  DripLetter,
  Eyes,
  Graveyard,
  Pumpkin,
  SheetGhost,
  SkullDivider,
  Spider,
  Specter,
  Bat,
} from '@/components/halloween/Decor';
import { creepster, fraunces } from '@/components/halloween/fonts';
import {
  getCachedHalloweenEvents,
  getEventsForWall,
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
  getTodayStringEastern,
} from '@/lib/utils/timezone';
import { venueLine } from '@/lib/utils/venueName';
import { SITE_URL } from '@/lib/seo/site';
import { currentSeason } from '@/lib/seasons';
import './halloween.css';

const title = 'Halloween in Asheville';
const description =
  'The strangest, spookiest things to do in Asheville before Halloween: goth proms, drag, burlesque, horror screenings and haunted storytelling.';

// The year is in the search title, since that's how people search for this
export function generateMetadata(): Metadata {
  const year = getTodayStringEastern().slice(0, 4);
  return {
    title: `${title} ${year}: Events & Things to Do`,
    description,
    alternates: { canonical: `${SITE_URL}/halloween` },
    openGraph: {
      title: `${title} ${year}`,
      description,
      url: `${SITE_URL}/halloween`,
      siteName: 'AVL GO',
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title: `${title} ${year}`, description },
  };
}

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
const image = (e: HalloweenEvent) => (hasLoadableEventImage(e.imageUrl) ? e.imageUrl : null);
const price = (e: HalloweenEvent) =>
  e.price && e.price !== 'Unknown' ? formatPriceDisplay(e.price) : null;
const time = (e: HalloweenEvent) =>
  e.timeUnknown ? null : formatDateEastern(e.startDate, { hour: 'numeric', minute: '2-digit' });

function WallPoster({
  event,
  index,
  controls,
}: {
  event: HalloweenEvent;
  index: number;
  controls?: ReactNode;
}) {
  const day = formatDateEastern(event.startDate, { weekday: 'short' });
  const when = time(event) ? `${day} ${time(event)}` : day;
  const cost = price(event);
  return (
    <div className="group relative">
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
            sizes="(min-width: 1024px) 280px, (min-width: 768px) 22vw, 45vw"
            flyerTextClass="text-[20px] sm:text-[28px]"
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
      {controls}
    </div>
  );
}

function EventCard({
  event,
  index,
  controls,
}: {
  event: HalloweenEvent;
  index: number;
  controls?: ReactNode;
}) {
  const cost = price(event);
  return (
    // On phones the poster sits above the text, which then gets the card's full width; a
    // 3-line summary there keeps the long day lists scrollable
    <article className="relative flex flex-col gap-4 rounded-[14px] border border-[#3b2a5c] bg-gradient-to-br from-[#160d22] to-[#0c0912] to-60% p-4 shadow-[0_0_24px_rgba(124,58,237,.12)] sm:flex-row sm:gap-5 sm:px-5">
      <Cobweb size={64} style={{ position: 'absolute', right: 0, top: 0, opacity: 0.4 }} />
      <Link
        href={eventHref(event)}
        tabIndex={-1}
        aria-hidden="true"
        className="w-[170px] shrink-0 self-start bg-[#f3eee2] p-[7px] shadow-[0_10px_20px_rgba(0,0,0,.55)]"
        style={{ transform: `rotate(${index % 2 ? '1.5deg' : '-1.5deg'})` }}
      >
        <Poster src={image(event)} title={event.title} sizes="170px" flyerTextClass="text-[20px]" />
      </Link>
      <div className="flex min-w-0 flex-col gap-1.5 sm:flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {time(event) && <span className="text-sm font-bold text-[#ffb35c]">{time(event)}</span>}
        </div>
        <div className="flex items-start justify-between gap-2">
          <Link
            href={eventHref(event)}
            className="text-xl font-bold leading-tight text-[#f1e7d0] no-underline hover:text-[#ffb35c]"
          >
            {event.title}
          </Link>
        </div>
        <span className="text-sm text-gray-400">{venueLine(event)}</span>
        {event.aiSummary && (
          <p className="mt-1 line-clamp-3 text-[15px] leading-relaxed text-gray-300 sm:line-clamp-none">
            {event.aiSummary}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {cost && (
            <span className="inline-flex h-7 items-center rounded-[5px] border border-[#b4470c] bg-[#2b1405] px-2 text-[13px] font-bold text-[#ffb35c]">
              {cost}
            </span>
          )}
          {(event.tags ?? []).slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex h-7 items-center rounded-[5px] border border-[#4c2f73] bg-[#221433] px-2 text-[13px] text-[#cdb8f5]"
            >
              {tag}
            </span>
          ))}
          <span className="flex-1" />
          {controls}
          <HeartButton eventId={event.id} title={event.title} />
        </div>
      </div>
    </article>
  );
}

function Tombstone({ date }: { date: Date }) {
  return (
    <div className="w-[56px] shrink-0 sm:w-[84px]">
      <div className="flex h-[68px] flex-col items-center justify-center rounded-t-[42px] rounded-b-md border border-[#5d6270] bg-gradient-to-b from-[#4b4f5c] to-[#2c2f38] shadow-[0_6px_0_#14161c] sm:h-[98px]">
        <span className="text-xs font-bold tracking-[.12em] text-[#cfd3dc]">
          {formatDateEastern(date, { weekday: 'short' }).toUpperCase()}
        </span>
        <span
          className={`${creepster.className} text-[26px] leading-none text-gray-100 sm:text-[38px]`}
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

type PillOption = { label: string; href: string; active: boolean; icon?: LucideIcon };

/** The page's choices on one candlelit plaque: who it's for, then the order */
function ChoicePanel({ rows }: { rows: { label: string; options: PillOption[] }[] }) {
  return (
    <div className="relative w-full shrink-0 rounded-2xl border border-[#7a5426]/60 bg-gradient-to-b from-[#24160c] to-[#120a05] p-3 shadow-[inset_0_0_24px_rgba(0,0,0,.7),0_0_28px_rgba(255,138,31,.14)] sm:w-auto">
      <Cobweb size={44} style={{ position: 'absolute', right: -2, top: -2, opacity: 0.35 }} />
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <Fragment key={row.label}>
            {/* The row's question is for screen readers; the icons and words say it on screen */}
            <div
              role="group"
              aria-label={row.label}
              className="flex gap-1 rounded-full bg-black/40 p-1 ring-1 ring-[#7a5426]/50"
            >
              {row.options.map(({ label, href, active, icon: Icon }) => (
                <Link
                  key={label}
                  href={href}
                  scroll={false}
                  aria-current={active ? 'true' : undefined}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition-all ${
                    active
                      ? 'bg-[#ff8a1f] text-[#1a0a00] shadow-[0_0_14px_rgba(255,138,31,.65)]'
                      : 'text-[#e8cfa8] hover:bg-white/10 hover:text-[#ffd7a8]'
                  }`}
                >
                  {Icon && <Icon size={15} aria-hidden="true" />}
                  {label}
                </Link>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export default async function HalloweenPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const audience: HalloweenAudience = params.for === 'family' ? 'family' : 'wild';
  const family = audience === 'family';
  // The picks are always the top-ranked ones; the sort only changes the order they're shown in
  const byDate = params.sort !== 'ranked';
  const pageHref = (forFamily: boolean, ranked: boolean) => {
    const query = new URLSearchParams();
    if (forFamily) query.set('for', 'family');
    if (ranked) query.set('sort', 'ranked');
    const q = query.toString();
    return `/halloween${q ? `?${q}` : ''}`;
  };
  const chronological = (a: HalloweenEvent, b: HalloweenEvent) =>
    a.startDate.getTime() - b.startDate.getTime() || a.id.localeCompare(b.id);
  // Per request: the countdown and "before the big night" move with the date
  await connection();

  const today = getTodayStringEastern();
  const halloween = `${today.slice(0, 4)}-10-31`;
  const eve = addDaysToDateString(halloween, -1);
  // Open through October; the rest of the year it only says when it's back
  const open = currentSeason(today)?.key === 'halloween';
  const over = today > halloween;
  const daysLeft = Math.round(
    (Date.parse(`${halloween}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000
  );

  let events: HalloweenEvent[] = [];
  let failed = false;
  if (open) {
    try {
      events = await getCachedHalloweenEvents(today, audience);
    } catch (error) {
      console.error('[Halloween] Failed to load events:', error);
      failed = true;
    }
  }

  // Hand edits: a missing table or failed read just means none, never a broken page
  const seasonPicks = await getSeasonPicks('halloween').catch((error: unknown) => {
    console.error('[Halloween] Failed to load hand edits:', error);
    return new Map<string, SeasonPick>();
  });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isSuperAdmin(user?.id);
  // Events added to the wall by hand, which may not match the Halloween words at all
  // After dark only: nothing vets a hand-added event as family-friendly
  const addedIds = family
    ? []
    : [...seasonPicks.values()].filter((p) => p.added && !p.hidden).map((p) => p.eventId);
  const handAdded = await getEventsForWall(addedIds).catch((error: unknown) => {
    console.error('[Halloween] Failed to load hand-added events:', error);
    return [] as HalloweenEvent[];
  });
  const withEdits = [...handAdded, ...events.filter((e) => !addedIds.includes(e.id))].map((e) => {
    const posterUrl = seasonPicks.get(e.id)?.posterUrl;
    return posterUrl ? { ...e, imageUrl: posterUrl } : e;
  });
  // Hidden ones come off the page and are only listed for an admin
  const shown = withEdits.filter((e) => !seasonPicks.get(e.id)?.hidden);
  const hiddenHere = withEdits.filter((e) => seasonPicks.get(e.id)?.hidden);
  const controlsFor = (e: HalloweenEvent, variant: 'inline' | 'overlay' = 'inline') =>
    admin ? (
      <AdminControls
        season="halloween"
        eventId={e.id}
        added={addedIds.includes(e.id)}
        hidden={seasonPicks.get(e.id)?.hidden === true}
        variant={variant}
      />
    ) : undefined;

  const bigStart = getDayBoundariesEastern(eve).start;
  const weekendShown = shown.filter((e) => e.startDate >= bigStart);
  // Hand-added events come first and don't use up the ranked spots
  const ranked = [
    ...weekendShown.filter((e) => addedIds.includes(e.id)),
    ...weekendShown.filter((e) => !addedIds.includes(e.id)).slice(0, WEEKEND_PICKS),
  ];
  const picks = byDate ? [...ranked].sort(chronological) : ranked;
  const days = new Map<string, HalloweenEvent[]>();
  for (const e of shown.filter((e) => e.startDate < bigStart)) {
    const key = getDateStringEastern(e.startDate);
    const list = days.get(key) ?? [];
    if (list.length < PER_DAY) days.set(key, [...list, e]);
  }
  const beforeDays = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]): [string, HalloweenEvent[]] => [
      day,
      byDate ? [...list].sort(chronological) : list,
    ]);

  const halloweenDate = getDayBoundariesEastern(halloween).start;
  const weekendHeading = ['Sat', 'Sun'].includes(
    formatDateEastern(halloweenDate, { weekday: 'short' })
  )
    ? 'Halloween weekend'
    : 'Halloween eve and night';
  // The full feed, searched for "halloween" over the same dates (it can't run this page's
  // word list, so it's "more", not "every"); the family view keeps to family events
  const moreHref = `/events?search=halloween&dateFilter=custom&dateStart=${today}&dateEnd=${halloween}${
    family ? '&tagsInclude=Family' : ''
  }`;
  const longDay = (d: Date) =>
    formatDateEastern(d, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <main className="hw-page min-h-screen flex flex-col overflow-x-clip bg-[#030712] text-gray-200">
      <FavoritesSync />
      <Header />
      {!family && <BloodDrips />}

      <Sky>
        <h1
          className={`${fraunces.className} m-0 text-[clamp(40px,6vw,72px)] leading-none text-[#fff4e6] [text-shadow:0_2px_18px_rgba(0,0,0,.7)]`}
        >
          Halloween in Ashevill{family ? 'e' : <DripLetter>e</DripLetter>}
        </h1>
        {open && (
          <p className="mt-3 text-[17px] text-[#d6d0e6]">
            {family
              ? 'Trick-or-treating, costume parades and spooky fun for kids'
              : 'The strangest, spookiest things to do'}{' '}
            from now through {longDay(halloweenDate)}
          </p>
        )}
        {open && (
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

      <div className="relative mx-auto flex w-full max-w-[1180px] flex-grow flex-col gap-16 px-4 pb-4 pt-4 sm:px-6 sm:pb-10 sm:pt-10">
        {/* Things that drift over the content and fade away */}
        <LeafGust top="4%" delay={0} />
        <LeafGust top="52%" delay={-13} />
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

        {!open ? (
          <p className="py-16 text-center text-lg text-gray-300">
            {over
              ? 'Halloween is over for this year.'
              : 'Halloween events show up here on October 1.'}{' '}
            <Link href="/events" className="text-[#ffb35c] hover:underline">
              See what&apos;s on {over ? 'next' : 'now'}
            </Link>
          </p>
        ) : failed ? (
          <p className="py-16 text-center text-gray-400">
            The Halloween list is unavailable right now. Please try again shortly.
          </p>
        ) : (
          <>
            {picks.length > 0 && (
              <section id="weekend" className="relative scroll-mt-4 pb-6">
                <LowFog />
                <div className="flex flex-wrap items-end justify-between gap-4">
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
                        {longDay(bigStart)} and {longDay(halloweenDate)}
                      </p>
                      {/* Says it's a ranked cut, so a missing favorite reads as ranked out, not lost */}
                      <p className="mt-1 text-sm text-gray-500">
                        {family
                          ? `The ${picks.length} top-rated family events of these two days, `
                          : `The ${picks.length} most unusual events of these two days, `}
                        {byDate
                          ? 'shown by start time.'
                          : family
                            ? 'best first.'
                            : 'ranked by how out-there each one is.'}{' '}
                        Everything else is in the full list.
                      </p>
                    </div>
                  </div>
                  <ChoicePanel
                    rows={[
                      {
                        label: "Who's it for?",
                        options: [
                          {
                            label: 'After dark',
                            href: pageHref(false, !byDate),
                            active: !family,
                            icon: Moon,
                          },
                          {
                            label: 'Family',
                            href: pageHref(true, !byDate),
                            active: family,
                            icon: Candy,
                          },
                        ],
                      },
                      {
                        label: 'In what order?',
                        options: [
                          {
                            label: 'By date',
                            href: pageHref(family, false),
                            active: byDate,
                            icon: CalendarDays,
                          },
                          {
                            label: family ? 'Top-rated' : 'Wildest',
                            href: pageHref(family, true),
                            active: !byDate,
                            icon: family ? Star : Skull,
                          },
                        ],
                      },
                    ]}
                  />
                </div>
                {admin && <AdminWallSearch season="halloween" onWall={picks.map((e) => e.id)} />}
                {/* Dealt round-robin into columns so the order reads across: two on phones,
                    four from md. Each layout is its own copy because columns can't re-deal */}
                {[2, 4].map((n) => (
                  <div
                    key={n}
                    className={`mt-9 gap-[26px] ${n === 2 ? 'flex md:hidden' : 'hidden md:flex'}`}
                  >
                    {Array.from({ length: n }, (_, c) => (
                      <div key={c} className="flex min-w-0 flex-1 flex-col gap-[34px]">
                        {picks
                          .filter((_, i) => i % n === c)
                          .map((event, i) => (
                            <WallPoster
                              key={event.id}
                              event={event}
                              index={i * n + c}
                              controls={controlsFor(event, 'overlay')}
                            />
                          ))}
                      </div>
                    ))}
                  </div>
                ))}
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
                <span className="hidden sm:block">
                  <FloatingCandles style={{ right: '4%', top: -10 }} />
                </span>
                <h2
                  className={`${creepster.className} m-0 text-[32px] tracking-wide text-violet-300 sm:text-[38px]`}
                >
                  Before the big night
                </h2>
                <p className="mb-7 mt-0.5 text-gray-400">
                  {family
                    ? `Each day's ${PER_DAY} top-rated family Halloween events until then`
                    : `Each day's ${PER_DAY} most unusual Halloween events until then`}
                </p>
                <p className="-mt-4 mb-7">
                  <Link href={moreHref} className="font-semibold text-[#ffb35c] hover:underline">
                    See more Halloween events →
                  </Link>
                </p>
                <div className="relative flex flex-col gap-9">
                  <CrawlingSpider />
                  {beforeDays.map(([day, list]) => (
                    // On phones the date stands on its own line so the cards get the full width
                    <div key={day} className="flex flex-col gap-3 sm:flex-row sm:gap-[18px]">
                      <Tombstone date={list[0].startDate} />
                      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
                        {list.map((event, i) => (
                          <EventCard
                            key={event.id}
                            event={event}
                            index={i}
                            controls={controlsFor(event)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {picks.length === 0 && beforeDays.length === 0 ? (
              <p className="py-16 text-center text-gray-400">No Halloween events are listed yet.</p>
            ) : (
              // Outside "Before the big night", which is empty on Oct 30 and 31
              <div className="-mt-8 flex flex-col items-center gap-3 text-center">
                <Link href={moreHref} className="font-semibold text-[#ffb35c] hover:underline">
                  See more Halloween events →
                </Link>
                {/* Only worth offering when there's a long list between here and the wall */}
                {picks.length > 0 && beforeDays.length > 0 && (
                  <a
                    href="#weekend"
                    className="hw-climb group mt-2 flex flex-col items-center text-[#ffb35c]"
                  >
                    <span aria-hidden="true" className="hw-climb-spider block">
                      <Spider thread={46} eyes="#ff2b2b" />
                    </span>
                    <span
                      className={`${creepster.className} text-xl tracking-wide group-hover:text-[#ffd7a8]`}
                    >
                      Climb back up to {weekendHeading}
                    </span>
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {admin && hiddenHere.length > 0 && (
        <section className="mx-auto mb-8 w-full max-w-[1180px] px-4 sm:px-6">
          <h2 className="text-lg font-bold text-gray-300">Hidden from this page (admin only)</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {hiddenHere.map((e) => (
              <li key={e.id} className="rounded-lg border border-gray-800 p-3">
                <Link
                  href={eventHref(e)}
                  className="font-semibold text-[#f1e7d0] hover:text-[#ffb35c]"
                >
                  {e.title}
                </Link>
                <span className="ml-2 text-sm text-gray-400">{longDay(e.startDate)}</span>
                {controlsFor(e)}
              </li>
            ))}
          </ul>
        </section>
      )}
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
