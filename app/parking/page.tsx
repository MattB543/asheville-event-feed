import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import LiveGarages from '@/components/parking/LiveGarages';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';
const pageUrl = `${siteUrl}/parking`;
const description =
  'Live open spaces in downtown Asheville garages, plus how garages, meters, private lots and free parking work.';

export const metadata: Metadata = {
  title: 'Parking',
  description,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'website',
    url: pageUrl,
    title: 'Parking in downtown Asheville',
    description,
    siteName: 'AVL GO',
    locale: 'en_US',
    images: [{ url: '/avlgo-og.png', width: 1200, height: 630, alt: 'AVL GO' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Parking in downtown Asheville',
    description,
    images: ['/avlgo-og.png'],
    creator: '@mattbrooksxyz',
  },
};

/*
 * Facts checked 2026-10-05 against the city's parking pages (updated 2026-07-02),
 * Buncombe County's public parking page and the city's citation page. Rates
 * change every year or two: re-check the sources at the bottom before editing.
 */

const CITY_GARAGES = [
  { name: 'Wall Street', address: '45 Wall St' },
  { name: "Harrah's Cherokee Center", address: '68 Rankin Ave' },
  { name: 'Rankin Avenue', address: '12 Rankin Ave' },
  { name: 'Biltmore Avenue', address: '61 S Lexington Ave' },
];

const COUNTY_DECKS = [
  { name: 'College Street', address: '164 College St' },
  { name: 'Sears Alley', address: '11 Sears Alley (off Coxe Ave)' },
];

const SOURCES = [
  {
    label: 'City garages and lots',
    href: 'https://www.ashevillenc.gov/service/park-in-a-parking-garage/',
  },
  { label: 'City metered parking', href: 'https://www.ashevillenc.gov/?p=335' },
  {
    label: 'Buncombe County decks',
    href: 'https://nc-buncombecounty.civicplus.com/673/Public-Parking',
  },
  {
    label: 'Pay or appeal a ticket',
    href: 'https://www.ashevillenc.gov/service/pay-or-appeal-a-parking-citation/',
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {children}
      </div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 marker:text-gray-400">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>;
}

function GarageNames({ garages }: { garages: { name: string; address: string }[] }) {
  return (
    <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
      {garages.map((g) => (
        <li key={g.name}>
          <span className="font-medium text-gray-900 dark:text-gray-100">{g.name}</span>{' '}
          <span className="text-gray-500 dark:text-gray-400">· {g.address}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ParkingPage() {
  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="parking" />

      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-6 pb-10">
          <div className="max-w-3xl mx-auto space-y-4">
            <div>
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                Parking in downtown Asheville
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Live garage spaces, and how parking here actually works.
              </p>
            </div>

            <LiveGarages />

            <Section title="Asheville parking summed up">
              <Bullets
                items={[
                  <>
                    <Strong>Under an hour?</Strong> City garages are free if you leave within 60
                    minutes.
                  </>,
                  <>
                    <Strong>Evenings and Sundays:</Strong> street meters are free after 6 p.m. every
                    day, all day Sunday and on city holidays.
                  </>,
                  <>
                    <Strong>All day:</Strong> a city garage tops out at $15, a county deck at $12.
                  </>,
                  <>
                    <Strong>ParkMobile sign = private lot.</Strong> City meters use Flowbird.
                    Private lots usually cost more and tow.
                  </>,
                ]}
              />
            </Section>

            <Section title="City garages">
              <GarageNames garages={CITY_GARAGES} />
              <Bullets
                items={[
                  <>
                    <Strong>Free if you leave within 60 minutes.</Strong> Stay longer and every hour
                    is $2, the first one included (61 minutes = $4).
                  </>,
                  <>$15 daily max (also the lost-ticket fee). Open 24/7.</>,
                  <>Card only: pay at the exit gate or a pay station inside.</>,
                  <>
                    <Strong>Event nights:</Strong> a flat $12 on the way in for Harrah&apos;s
                    Cherokee Center and Thomas Wolfe events, $10 for other events.
                  </>,
                ]}
              />
            </Section>

            <Section title="County decks">
              <GarageNames garages={COUNTY_DECKS} />
              <Bullets
                items={[
                  <>No free period: $2 for the first hour, then $1 an hour.</>,
                  <>$12 daily max, the cheapest all-day option downtown. Open 24/7.</>,
                  <>
                    Biggest decks downtown (650+ spaces each) and EV chargers on the ground level.
                  </>,
                ]}
              />
            </Section>

            <Section title="Street meters">
              <Bullets
                items={[
                  <>
                    <Strong>$2.50 an hour, 2-hour limit.</Strong>
                  </>,
                  <>
                    <Strong>You pay 8 a.m.–6 p.m., Monday–Saturday.</Strong> Free after 6 p.m. every
                    day, all day Sunday, and on city holidays (MLK Day, Good Friday, Memorial Day,
                    July 4, Labor Day, Thanksgiving and the Friday after, and around Christmas).
                  </>,
                  <>
                    Pay at the meter (coins or card), in the <Strong>Flowbird</Strong> app, or by
                    texting your zone (e.g. &ldquo;Z42&rdquo;) to 727563. The zone is on the back of
                    the meter.
                  </>,
                  <>The city never uses QR codes on meters. A QR sticker on one is a scam.</>,
                ]}
              />
            </Section>

            <Section title="Private lots">
              <Bullets
                items={[
                  <>
                    Many downtown surface lots are run by private companies (mostly Preferred
                    Parking and McLaurin), not the city. If the sign says to pay with{' '}
                    <Strong>ParkMobile</Strong>, it&apos;s private.
                  </>,
                  <>
                    Usually pricier than a garage, often a flat rate, and event-night prices go up.
                  </>,
                  <>
                    They tow. Read the sign: it names the tow company, which is who you call if your
                    car is gone (police can&apos;t help with private tows).
                  </>,
                ]}
              />
            </Section>

            <Section title="Free parking">
              <Bullets
                items={[
                  <>Any city garage for up to 60 minutes.</>,
                  <>
                    Every street meter after 6 p.m. every day, all day Sunday, and on city holidays.
                  </>,
                  <>
                    <Strong>Lot 15</Strong>, 130 N Lexington Ave: free for now (the city lists it as
                    temporarily free).
                  </>,
                  <>
                    <Strong>Valley Street</Strong> (55 Valley St) and{' '}
                    <Strong>Marjorie Street</Strong> (17 Marjorie St) city lots: free 5 p.m.–7 a.m.
                    weekdays and all weekend.
                  </>,
                  <>
                    Accessible placard or plate: free with no time limit in non-metered accessible
                    spaces. Metered ones still charge, but with no time limit.
                  </>,
                ]}
              />
            </Section>

            <Section title="Tickets and towing">
              <Bullets
                items={[
                  <>
                    Overtime at a meter is $20 ($40 for a repeat). Loading zone $30, fire lane or
                    hydrant $50, accessible space $250.
                  </>,
                  <>
                    Pay or appeal online at{' '}
                    <a
                      href="https://asheville.rmcpay.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 hover:underline dark:text-brand-400"
                    >
                      asheville.rmcpay.com
                    </a>{' '}
                    or in person at 45 Wall St (weekdays 8:30–5).
                  </>,
                  <>
                    A police-ordered tow is $165 plus $30 a day of storage. Neighborhood streets
                    near downtown can be residential-permit only: check the signs.
                  </>,
                  <>Questions: City Parking Services, (828) 259-5792.</>,
                ]}
              />
            </Section>

            <p className="px-1 text-xs text-gray-500 dark:text-gray-400">
              Last checked October 2026. Rates change, so the posted sign always wins. Sources:{' '}
              {SOURCES.map((s, i) => (
                <span key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    {s.label}
                  </a>
                  {i < SOURCES.length - 1 ? ', ' : '.'}
                </span>
              ))}
            </p>
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
