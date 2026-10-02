import type { Metadata } from 'next';
import { connection } from 'next/server';
import Header from '@/components/Header';
import FooterCredit from '@/components/FooterCredit';
import GroupDirectory from '@/components/groups/GroupDirectory';
import { getGroupDirectory, type GroupDirectoryEntry } from '@/lib/db/queries/groups';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';
const pageUrl = `${siteUrl}/groups`;
const description =
  'Clubs, circles, jams and crews around Asheville that meet again and again, with their upcoming events.';

export const metadata: Metadata = {
  title: 'Groups',
  description,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'website',
    url: pageUrl,
    title: 'Groups',
    description,
    siteName: 'AVL GO',
    locale: 'en_US',
    images: [{ url: '/avlgo-og.png', width: 1200, height: 630, alt: 'AVL GO' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Groups',
    description,
    images: ['/avlgo-og.png'],
    creator: '@mattbrooksxyz',
  },
};

export default async function GroupsPage() {
  // Render per request so the page never outlives the data cache: the directory query is cached
  // per Eastern date (and refreshed by the `events` tag after every scrape), so after midnight a
  // fresh render picks up a fresh entry, and a transient DB error is never cached as the page.
  await connection();

  let groups: GroupDirectoryEntry[] = [];
  let failed = false;

  try {
    groups = await getGroupDirectory();
  } catch (error) {
    console.error('[Groups] Failed to fetch the group directory:', error);
    failed = true;
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header activeTab="groups" />

      <div className="flex-grow">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-6 pb-10">
          <h1 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Groups</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Clubs, circles, jams and crews around Asheville that meet again and again.
            {groups.length > 0 && (
              <span className="text-gray-500 dark:text-gray-500"> {groups.length} groups.</span>
            )}
          </p>

          <div className="mt-6">
            {groups.length === 0 ? (
              <div className="p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
                <p className="text-gray-600 dark:text-gray-400">
                  {failed
                    ? 'The group directory is unavailable right now. Please try again shortly.'
                    : 'No groups listed yet.'}
                </p>
              </div>
            ) : (
              <GroupDirectory groups={groups} shuffleSeed={crypto.randomUUID()} />
            )}
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
