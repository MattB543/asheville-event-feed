/**
 * Super-admin moderation for a poster upload: approve (publish + create its
 * events) or deny (hide its events + pull the public image).
 *
 * Approve accepts `pending_review`, `published`, or `denied`: the published
 * case is the retry path for a promotion that partly failed, and the denied
 * case undoes a takedown (re-publishing the image and un-hiding its events).
 * Deny accepts the same three, because re-denying re-runs the whole cleanup:
 * it is the way to finish a takedown whose storage delete or state write
 * failed halfway.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { db } from '@/lib/db';
import { events, posterExtractions, posterUploads } from '@/lib/db/schema';
import { promoteExtractions } from '@/lib/posters/promoteExtractions';
import { publishPosterImage, unpublishPosterImage } from '@/lib/supabase/storage';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { isRecord, isString } from '@/lib/utils/validation';

// promoteExtractions runs inline on approve: one embedding call per extraction,
// each of which can wait 30s.
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APPROVABLE_STATUSES = ['pending_review', 'published', 'denied'] as const;
const DENIABLE_STATUSES = ['pending_review', 'published', 'denied'] as const;

/**
 * Hide every event this upload put on the site.
 *
 * The ownership key is the event's `sourceId` (`poster:{extractionId}`, set at
 * insert time by promoteExtractions), not the extraction's recorded `outcome`.
 * Promotion writes the event first and its outcome second, so a row whose
 * writeback failed still owns a live event - keying off `outcome = 'created'`
 * would leave that event up after a takedown.
 *
 * Matching on the poster's own sourceIds also keeps the `matched_existing`
 * safeguard: those extractions point at scraped listings with entirely
 * different sourceIds, so a takedown can never hide somebody else's event. The
 * `source = 'POSTER'` condition is part of the UPDATE's WHERE clause, so
 * nothing can change underneath it.
 */
async function hidePosterEvents(uploadId: string): Promise<number> {
  const extractions = await db
    .select({ id: posterExtractions.id })
    .from(posterExtractions)
    .where(eq(posterExtractions.uploadId, uploadId));

  if (extractions.length === 0) return 0;

  const hidden = await db
    .update(events)
    .set({ hidden: true, updatedAt: new Date() })
    .where(
      and(
        inArray(
          events.sourceId,
          extractions.map((extraction) => `poster:${extraction.id}`)
        ),
        eq(events.source, 'POSTER'),
        or(isNull(events.hidden), eq(events.hidden, false))
      )
    )
    .returning({ id: events.id });

  return hidden.length;
}

/**
 * Undo `hidePosterEvents` when a denial is reversed.
 *
 * Keyed on the same `poster:{extractionId}` sourceIds, so it can only ever
 * un-hide events this upload created - never a scraped listing a
 * `matched_existing` extraction points at, and never an unrelated event an
 * admin hid for their own reasons.
 *
 * Only called on the denied -> approved transition. Running it on an ordinary
 * re-approve would resurrect events hidden by something else entirely.
 */
async function unhidePosterEvents(uploadId: string): Promise<number> {
  const extractions = await db
    .select({ id: posterExtractions.id })
    .from(posterExtractions)
    .where(eq(posterExtractions.uploadId, uploadId));

  if (extractions.length === 0) return 0;

  const restored = await db
    .update(events)
    .set({ hidden: false, updatedAt: new Date() })
    .where(
      and(
        inArray(
          events.sourceId,
          extractions.map((extraction) => `poster:${extraction.id}`)
        ),
        eq(events.source, 'POSTER'),
        eq(events.hidden, true)
      )
    )
    .returning({ id: events.id });

  return restored.length;
}

/**
 * The full takedown, safe to run from any state and safe to repeat.
 *
 * `unpublishPosterImage` runs unconditionally rather than only when the row
 * claims a public URL: an earlier attempt could have published the object and
 * then failed its state write, leaving a public copy the row knows nothing
 * about. Deleting a missing object is a no-op.
 */
async function runTakedown(uploadId: string, reviewedAt: Date | null): Promise<number> {
  let hiddenCount = 0;

  try {
    hiddenCount = await hidePosterEvents(uploadId);
    await unpublishPosterImage(uploadId);

    await db
      .update(posterUploads)
      .set({
        status: 'denied',
        publicImageUrl: null,
        // Keep the original review time on a repeat run.
        reviewedAt: reviewedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posterUploads.id, uploadId));
  } finally {
    // Hides happen first, so a later failure must not leave the feed caches
    // serving events that are already hidden in the database.
    if (hiddenCount > 0) {
      invalidateEventsCache();
    }
  }

  return hiddenCount;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isSuperAdmin(user.id)) {
      return NextResponse.json({ error: 'Forbidden - Super admin only' }, { status: 403 });
    }

    const { id } = await params;

    // Postgres rejects a malformed uuid outright, so a bad path segment has to
    // be a 400 rather than a 500.
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid upload id' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isRecord(body) || !isString(body.action)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const action = body.action;
    if (action !== 'approve' && action !== 'deny') {
      return NextResponse.json({ error: 'action must be "approve" or "deny"' }, { status: 400 });
    }

    const [upload] = await db
      .select({
        id: posterUploads.id,
        status: posterUploads.status,
        reviewedAt: posterUploads.reviewedAt,
      })
      .from(posterUploads)
      .where(eq(posterUploads.id, id))
      .limit(1);

    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    const allowedStatuses: readonly string[] =
      action === 'approve' ? APPROVABLE_STATUSES : DENIABLE_STATUSES;

    if (!allowedStatuses.includes(upload.status)) {
      return NextResponse.json(
        { error: `Cannot ${action} an upload with status "${upload.status}"` },
        { status: 409 }
      );
    }

    if (action === 'deny') {
      const hiddenCount = await runTakedown(id, upload.reviewedAt);

      return NextResponse.json({ uploadId: id, status: 'denied', hiddenCount });
    }

    // Idempotent by design: re-publishing overwrites the public object, and
    // promoteExtractions leaves settled rows alone while retrying failed ones.
    const wasDenied = upload.status === 'denied';
    const publicImageUrl = await publishPosterImage(id);
    const now = new Date();

    // The status the SELECT above saw can be stale by now (a double-click, a
    // second tab). Re-checking inside the UPDATE is what actually serialises
    // approve against deny, so exactly one of two racing decisions lands.
    const [claimed] = await db
      .update(posterUploads)
      .set({ status: 'published', publicImageUrl, reviewedAt: now, updatedAt: now })
      .where(and(eq(posterUploads.id, id), inArray(posterUploads.status, [...APPROVABLE_STATUSES])))
      .returning({ id: posterUploads.id });

    if (!claimed) {
      // The publish above already put a public copy back; take it away again
      // rather than leaving one behind for an upload we did not approve.
      try {
        await unpublishPosterImage(id);
      } catch (error) {
        console.error(`[Posters] Could not undo publish for ${id}:`, error);
      }

      return NextResponse.json(
        { error: 'Upload changed status during approval; reload the queue' },
        { status: 409 }
      );
    }

    // Reversing a takedown: the events promotion left behind are still hidden,
    // and promoteExtractions will not touch them (their outcomes are settled),
    // so un-hiding is this path's job. Done before promotion so a concurrent
    // deny's takedown still runs last and wins.
    let restoredCount = 0;
    if (wasDenied) {
      restoredCount = await unhidePosterEvents(id);
    }

    // The image is live at this point, so a promotion failure is reported
    // rather than raised - the admin can approve again to retry.
    let promotionFailure: string | null = null;
    let createdCount = 0;
    let failedCount = 0;
    let extractionResults: {
      id: string;
      title: string;
      outcome: string;
      eventSlug: string | null;
    }[] = [];

    try {
      const promotion = await promoteExtractions(id);
      createdCount = promotion.createdCount;
      failedCount = promotion.extractions.filter((item) => item.outcome === 'failed').length;
      extractionResults = promotion.extractions.map((item) => ({
        id: item.extractionId,
        title: item.title,
        outcome: item.outcome,
        eventSlug: item.eventSlug,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Posters] Approve promotion failed for ${id}:`, error);
      promotionFailure = message;

      await db
        .update(posterUploads)
        .set({ errorMessage: `Promotion failed: ${message}`.slice(0, 2000), updatedAt: now })
        .where(eq(posterUploads.id, id));
    }

    invalidateEventsCache();

    // A deny that landed while promotion was running would have hidden the
    // events that existed at that moment, not the ones just inserted.
    const [current] = await db
      .select({ status: posterUploads.status, reviewedAt: posterUploads.reviewedAt })
      .from(posterUploads)
      .where(eq(posterUploads.id, id))
      .limit(1);

    if (current?.status === 'denied') {
      await runTakedown(id, current.reviewedAt);

      return NextResponse.json(
        { error: 'Upload was denied while approving; the takedown has been re-applied' },
        { status: 409 }
      );
    }

    const warning = promotionFailure
      ? 'Published, but its events could not be added. Approve again to retry.'
      : failedCount > 0
        ? `Published — ${failedCount} event${failedCount === 1 ? '' : 's'} failed to add; approve again to retry.`
        : undefined;

    return NextResponse.json({
      uploadId: id,
      status: 'published',
      publicImageUrl,
      createdCount,
      failedCount,
      restoredCount,
      ...(warning ? { warning } : {}),
      extractions: extractionResults,
    });
  } catch (error) {
    console.error('[Posters] Moderation failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
