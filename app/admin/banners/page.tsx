/**
 * Season dates, banners and on/off for the admins, linked from an admin's account menu.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import AdminNav from '@/components/admin/AdminNav';
import SeasonAdmin from '@/components/seasonal/admin/SeasonAdmin';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/utils/admin';
import { loadSeasons } from '@/lib/db/queries/seasonSettings';
import { getTodayStringEastern } from '@/lib/utils/timezone';

export const metadata: Metadata = {
  title: 'Banners',
  robots: { index: false, follow: false },
};

// A save has to show on the very next request
export const dynamic = 'force-dynamic';

export default async function AdminBannersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.id)) redirect('/');

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="flex-grow w-full max-w-3xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
        <AdminNav current="/admin/banners" />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          While a season runs, every page shows its banner. Where two overlap, the one higher up
          wins.
        </p>
        <SeasonAdmin seasons={await loadSeasons()} today={getTodayStringEastern()} />
      </div>
    </main>
  );
}
