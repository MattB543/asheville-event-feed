import { Suspense } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import AiNotice from '@/components/camps/AiNotice';
import CampDirectory from '@/components/camps/CampDirectory';
import CampExportLinks from '@/components/camps/CampExportLinks';
import { toCardData, type CampCardData } from '@/lib/camps/display';
import { ORS_ATTRIBUTION } from '@/lib/camps/geo';
import { campsLastChecked, listLiveCamps } from '@/lib/db/queries/camps';
import { SITE_URL } from '@/lib/seo/site';

const pageUrl = `${SITE_URL}/camps`;
const title = 'Summer camps near Asheville, 2027';
const description =
  'Kids’ summer camps near Asheville for 2027: ages, weeks, prices, drive times and when registration opens, with reminders.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'website',
    url: pageUrl,
    title,
    description,
    siteName: 'AVL GO',
    locale: 'en_US',
    images: [{ url: '/avlgo-og.png', width: 1200, height: 630, alt: 'AVL GO' }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/avlgo-og.png'],
    creator: '@mattbrooksxyz',
  },
};

export default async function CampsPage() {
  // Per request: the registration line depends on the clock ("opens" turns into "opened"), and
  // the camp list is cached per Eastern date under the `camps` tag.
  await connection();

  let cards: CampCardData[] = [];
  let providers = 0;
  let checked: string | null = null;
  let failed = false;
  try {
    const [camps, lastChecked] = await Promise.all([listLiveCamps(), campsLastChecked()]);
    const now = new Date();
    cards = camps.map((camp) => toCardData(camp, now));
    providers = new Set(camps.map((camp) => camp.providerKey)).size;
    checked =
      lastChecked &&
      new Date(lastChecked).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      });
  } catch (error) {
    console.error('[Camps] Failed to load the camp directory:', error);
    failed = true;
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="camps" />

      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10">
          <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            {title}
          </h1>
          {/* Shorter on a phone, so the first camps show on the first screen */}
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            <span className="hidden sm:inline">
              When registration opens, plus ages, weeks, prices and drive times, read from each
              camp’s own site.{' '}
            </span>
            Where a camp hasn’t posted 2027 yet, you’ll see its 2026 details, labeled 2026.
          </p>
          {/* One line from sm; on a phone the export links wrap under the counts */}
          {cards.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
              <p>
                {cards.length} camps from {providers} {providers === 1 ? 'provider' : 'providers'}
                {checked && ` · last checked ${checked}`}
              </p>
              <span aria-hidden="true" className="hidden sm:inline">
                ·
              </span>
              <CampExportLinks />
            </div>
          )}

          <AiNotice className="mt-4" />

          <div className="mt-6">
            {cards.length === 0 ? (
              <div className="p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
                <p className="text-gray-600 dark:text-gray-400">
                  {failed
                    ? 'The camp directory is unavailable right now. Please try again shortly.'
                    : 'No camps listed yet. Check back soon.'}
                </p>
              </div>
            ) : (
              <Suspense fallback={null}>
                <CampDirectory camps={cards} />
              </Suspense>
            )}
          </div>

          <p className="mt-8 text-xs text-gray-500 dark:text-gray-400">
            Drive times from Pack Square, without traffic: {ORS_ATTRIBUTION}
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
