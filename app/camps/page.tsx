import type { Metadata } from 'next';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import CampDirectory from '@/components/camps/CampDirectory';
import { toCardData } from '@/lib/camps/display';
import { campsDataInfo, getCampListings } from '@/lib/camps/pilotData';
import { SITE_URL } from '@/lib/seo/site';

const pageUrl = `${SITE_URL}/camps`;
const description =
  'Kids’ summer camps near Asheville for 2027: ages, dates, prices, drive times and when registration opens.';

export const metadata: Metadata = {
  title: 'Summer camps near Asheville, 2027',
  description,
  alternates: { canonical: pageUrl },
  // Pilot data, not hand-checked: keep it out of search until launch (~Dec 1).
  robots: { index: false, follow: false },
};

export default async function CampsPage() {
  // Per request: the registration line depends on the clock ("opens" turns into "opened").
  await connection();
  const listings = getCampListings();
  const cards = listings.map(toCardData);
  const { generatedAt, attribution } = campsDataInfo();
  const providers = new Set(listings.map((listing) => listing.providerKey)).size;
  const checked = new Date(generatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10">
          <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            Summer camps near Asheville, 2027
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Ages, dates, prices and when registration opens, read from each camp’s own pages. Where
            a camp hasn’t posted 2027 yet, you’ll see its 2026 details, labeled 2026.
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            {cards.length} camps from {providers} providers · last checked {checked}
          </p>

          <div
            role="note"
            className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
          >
            Pilot: 20 providers, extracted by AI and checked against each camp’s page by code. No
            date here has been checked by a person yet. Always confirm on the camp’s site.
          </div>

          <div className="mt-6">
            <CampDirectory camps={cards} />
          </div>

          <p className="mt-8 text-xs text-gray-500 dark:text-gray-500">
            Drive times from Pack Square, no traffic: {attribution}
          </p>
        </div>
      </div>

      <footer className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 mt-8 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        <FooterCredit />
        <p>© {new Date().getFullYear()} AVL GO.</p>
      </footer>
    </main>
  );
}
