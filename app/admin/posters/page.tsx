/**
 * Poster moderation queue. Unlisted by design - there is no nav link to it.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import AdminPosterQueue, { type AdminQueueUpload } from '@/components/posters/AdminPosterQueue';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import {
  queryAllPosters,
  queryFailedPosters,
  queryPosterReviewQueue,
  type AdminPosterUpload,
} from '@/lib/db/queries/posters';
import { getPosterSignedUrls, type PosterImageUrls } from '@/lib/supabase/storage';

export const metadata: Metadata = {
  title: 'Poster moderation',
  robots: { index: false, follow: false },
};

// Moderation decisions have to be visible on the very next request.
export const dynamic = 'force-dynamic';

/**
 * Flagged and failed images live in the private ingress bucket, so rendering
 * them needs a short-lived signed URL. Those are minted in one bulk call by the
 * page and handed in here, rather than per row.
 *
 * When a crop exists the ORIGINAL is shown beside it: the published copy IS the
 * crop, so on its own it would never reveal what was cut away.
 */
function toQueueUpload(upload: AdminPosterUpload, urls: PosterImageUrls): AdminQueueUpload {
  const croppedImageUrl = urls.cropped;
  // With no crop the public copy and the original are the same bytes, so the
  // stable public URL is preferred over one that expires.
  const imageUrl = croppedImageUrl ? urls.original : (upload.publicImageUrl ?? urls.original);

  return {
    id: upload.id,
    status: upload.status,
    safetyReason: upload.safetyReason,
    adultReason: upload.adultReason,
    adult: upload.adult,
    errorMessage: upload.errorMessage,
    rawModelOutputExcerpt: upload.rawModelOutputExcerpt,
    imageUrl,
    croppedImageUrl,
    fileSizeBytes: upload.fileSizeBytes,
    createdAt: upload.createdAt.toISOString(),
    reviewedAt: upload.reviewedAt ? upload.reviewedAt.toISOString() : null,
    extractions: upload.extractions.map((extraction) => ({
      id: extraction.id,
      ordinal: extraction.ordinal,
      title: extraction.title,
      startDate: extraction.startDate ? extraction.startDate.toISOString() : null,
      timeUnknown: extraction.timeUnknown,
      location: extraction.location,
      organizer: extraction.organizer,
      description: extraction.description,
      price: extraction.price,
      rawText: extraction.rawText,
      outcome: extraction.outcome,
      eventSlug: extraction.eventSlug,
    })),
  };
}

export default async function AdminPostersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const showAll = (await searchParams).view === 'all';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isSuperAdmin(user?.id)) {
    redirect('/');
  }

  let pending: AdminQueueUpload[] = [];
  let failed: AdminQueueUpload[] = [];
  let loadFailed = false;

  try {
    // The "all" view is already unfiltered, so its failures are in the main
    // list - loading the failures section again would just duplicate them.
    const [pendingRows, failedRows] = await Promise.all([
      showAll ? queryAllPosters() : queryPosterReviewQueue(),
      showAll ? Promise.resolve([] as AdminPosterUpload[]) : queryFailedPosters(),
    ]);

    // One storage round trip for the whole page, not two per card.
    const signed = await getPosterSignedUrls([...pendingRows, ...failedRows].map((row) => row.id));
    const empty: PosterImageUrls = { original: null, cropped: null };

    pending = pendingRows.map((row) => toQueueUpload(row, signed.get(row.id) ?? empty));
    failed = failedRows.map((row) => toQueueUpload(row, signed.get(row.id) ?? empty));
  } catch (error) {
    console.error('[Posters] Failed to load moderation queue:', error);
    loadFailed = true;
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="flex-grow w-full max-w-4xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Poster moderation</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {showAll
            ? 'Every upload, newest first. Approving publishes the image and adds its events; taking one down hides them and deletes the public image.'
            : 'Uploads flagged by the safety check, plus recent pipeline failures. Approving publishes the image and adds its events; denying hides them and deletes the public image.'}
        </p>

        {/* Plain anchors, not <Link>: the two tabs are the same route segment and
            differ only by search param, so a soft navigation reuses the cached RSC
            payload and the list never changes. A full load always re-queries. */}
        <div className="mt-4 mb-6 flex gap-2">
          <a
            href="/admin/posters"
            className={`px-3 py-1.5 text-sm font-medium rounded-md border ${
              showAll
                ? 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900'
                : 'border-transparent bg-brand-600 text-white'
            }`}
          >
            Needs review
          </a>
          <a
            href="/admin/posters?view=all"
            className={`px-3 py-1.5 text-sm font-medium rounded-md border ${
              showAll
                ? 'border-transparent bg-brand-600 text-white'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900'
            }`}
          >
            All uploads
          </a>
        </div>

        {loadFailed ? (
          <div className="p-8 text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            <p className="text-gray-600 dark:text-gray-400">
              The moderation queue could not be loaded. Please try again shortly.
            </p>
          </div>
        ) : (
          <AdminPosterQueue pending={pending} failed={failed} canModerate showingAll={showAll} />
        )}
      </div>
    </main>
  );
}
