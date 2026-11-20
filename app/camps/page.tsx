import { Suspense } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import AiNotice from '@/components/camps/AiNotice';
import CampDirectory from '@/components/camps/CampDirectory';
import CampExportLinks from '@/components/camps/CampExportLinks';
import { campFacets, firstCampPage, type CampFacets } from '@/lib/camps/directory';
import { formatDate, toCardData, type CampCardData } from '@/lib/camps/display';
import { ORS_ATTRIBUTION } from '@/lib/camps/geo';
import { listLiveCamps } from '@/lib/db/queries/camps';
import { SITE_URL } from '@/lib/seo/site';
import { getDateStringEastern } from '@/lib/utils/timezone';

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

  // Only the first page of cards goes into the HTML; the directory fetches every camp once it's
  // up (lib/camps/directory.ts)
  let firstPage: CampCardData[] = [];
  let total = 0;
  let facets: CampFacets = { towns: [], types: [], categories: [] };
  let checked: string | null = null;
  let failed = false;
  try {
    const camps = await listLiveCamps();
    const now = new Date();
    const cards = camps.map((camp) => toCardData(camp, now));
    firstPage = firstCampPage(cards);
    total = cards.length;
    facets = campFacets(cards);
    // The newest of the listed camps' checks (ISO strings, so the greatest), as an Eastern day
    const newest = camps
      .flatMap((camp) => (camp.checkedAt ? [camp.checkedAt] : []))
      .reduce((a, b) => (a > b ? a : b), '');
    if (newest) checked = `last checked ${formatDate(getDateStringEastern(new Date(newest)))}`;
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
              Registration dates, plus ages, weeks, prices, and drive times, for summer camps near
              Asheville.{' '}
            </span>
            2026 details shown where 2027 details are unknown.
          </p>

          <AiNotice className="mt-4" />

          <div className="mt-6">
            {total === 0 ? (
              <div className="p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
                <p className="text-gray-600 dark:text-gray-400">
                  {failed
                    ? 'The camp directory is unavailable right now. Please try again shortly.'
                    : 'No camps listed yet. Check back soon.'}
                </p>
              </div>
            ) : (
              <Suspense fallback={null}>
                <CampDirectory
                  firstPage={firstPage}
                  total={total}
                  facets={facets}
                  meta={
                    // One line with the count from sm; on a phone the export links go under it
                    <>
                      {checked && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          <span aria-hidden="true">· </span>
                          {checked}
                        </p>
                      )}
                      <div className="flex basis-full items-center gap-x-1.5 text-xs text-gray-500 dark:text-gray-400 sm:basis-auto">
                        <span aria-hidden="true" className="hidden sm:inline">
                          ·
                        </span>
                        <CampExportLinks />
                      </div>
                    </>
                  }
                />
              </Suspense>
            )}
          </div>

          <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
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
