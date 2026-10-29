/**
 * Camp review for the super admin (docs/camps/04-v2-plan.md §1.2). Unlisted by design - there is
 * no nav link to it. Confirm, hide or fix the camps short of high confidence, and pin the sites
 * the geocoder couldn't place.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import CampAdmin, { type CampAdminData } from '@/components/camps/admin/CampAdmin';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { reviewQueue, sitesWithoutPin } from '@/lib/db/queries/camps';
import { CAMP_CARD_KEYS, hiddenCamps, orsPinnedSites } from '@/lib/db/queries/campsAdmin';

export const metadata: Metadata = {
  title: 'Camp review',
  robots: { index: false, follow: false },
};

// Every decision has to show on the very next request.
export const dynamic = 'force-dynamic';

export default async function AdminCampsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isSuperAdmin(user?.id)) {
    redirect('/');
  }

  let data: CampAdminData | null = null;
  try {
    const [queue, unpinned, orsPins, hidden] = await Promise.all([
      reviewQueue(),
      sitesWithoutPin(),
      orsPinnedSites(),
      hiddenCamps(),
    ]);
    data = { queue, unpinned, orsPins, hidden };
  } catch (error) {
    console.error('[Camps] Failed to load the admin page:', error);
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="flex-grow w-full max-w-4xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Camp review</h1>

        {data ? (
          <CampAdmin {...data} cardKeys={CAMP_CARD_KEYS} />
        ) : (
          <div className="mt-6 p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            <p className="text-gray-600 dark:text-gray-400">
              The camps could not be loaded. Please try again shortly.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
