import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { letterSignatures } from '@/lib/db/schema';
import {
  LETTER,
  type LetterPageData,
  type OwnSignature,
  type ReviewQueue,
  type ReviewRow,
  type SignatureStatus,
} from '@/lib/letter/outagePlan';

/** A validated signature from the sign route (trimmed; empty optional fields are null) */
export interface SignatureInput {
  name: string;
  neighborhood: string | null;
  role: string | null;
  isPublic: boolean;
  wantsUpdates: boolean;
}

type SignatureRow = typeof letterSignatures.$inferSelect;

/** The name left on a rejected signature its owner removed (the row stays as a marker) */
const REMOVED_NAME = '';

function toOwnSignature(row: SignatureRow): OwnSignature {
  return {
    name: row.name,
    neighborhood: row.neighborhood,
    role: row.role,
    isPublic: row.isPublic,
    wantsUpdates: row.wantsUpdates,
    status: row.status as SignatureStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The page's count and public names. Only public, approved signers' names are read,
 * so a private name can never reach the page's props. Deliberately uncached: a cache
 * fill that started before someone switched to private could finish after the tag
 * expired and keep serving their name.
 */
export async function getLetterPageData(): Promise<LetterPageData> {
  const [[totalRow], shown] = await Promise.all([
    db
      .select({ total: count() })
      .from(letterSignatures)
      .where(and(eq(letterSignatures.letter, LETTER), ne(letterSignatures.status, 'rejected'))),
    db
      .select({
        name: letterSignatures.name,
        neighborhood: letterSignatures.neighborhood,
        role: letterSignatures.role,
      })
      .from(letterSignatures)
      .where(
        and(
          eq(letterSignatures.letter, LETTER),
          eq(letterSignatures.isPublic, true),
          eq(letterSignatures.status, 'approved')
        )
      )
      .orderBy(asc(letterSignatures.createdAt), asc(letterSignatures.id)),
  ]);
  return { total: totalRow?.total ?? 0, shown };
}

/** The signed-in visitor's own signature, if they've signed */
export async function getOwnSignature(userId: string): Promise<OwnSignature | null> {
  const [row] = await db
    .select()
    .from(letterSignatures)
    .where(and(eq(letterSignatures.letter, LETTER), eq(letterSignatures.userId, userId)))
    .limit(1);
  // A removed rejection is only a marker; to its owner it reads as not signed
  if (!row || (row.status === 'rejected' && row.name === REMOVED_NAME)) return null;
  return toOwnSignature(row);
}

/** Public signatures for the super admin: pending oldest first, the rest newest first */
export async function getReviewQueue(): Promise<ReviewQueue> {
  const rows = await db
    .select({
      id: letterSignatures.id,
      name: letterSignatures.name,
      neighborhood: letterSignatures.neighborhood,
      role: letterSignatures.role,
      status: letterSignatures.status,
      createdAt: letterSignatures.createdAt,
      revision: letterSignatures.revision,
    })
    .from(letterSignatures)
    .where(and(eq(letterSignatures.letter, LETTER), eq(letterSignatures.isPublic, true)))
    .orderBy(asc(letterSignatures.createdAt));

  const queue: ReviewQueue = { pending: [], approved: [], rejected: [] };
  for (const row of rows) {
    const status = row.status as SignatureStatus;
    const reviewRow: ReviewRow = { ...row, status, createdAt: row.createdAt.toISOString() };
    queue[status]?.push(reviewRow);
  }
  queue.approved.reverse();
  queue.rejected.reverse();
  return queue;
}

/** Public signatures waiting for review, for the Slack ping */
export async function countPendingPublic(): Promise<number> {
  const [row] = await db
    .select({ pending: count() })
    .from(letterSignatures)
    .where(
      and(
        eq(letterSignatures.letter, LETTER),
        eq(letterSignatures.isPublic, true),
        eq(letterSignatures.status, 'pending')
      )
    );
  return row?.pending ?? 0;
}

/**
 * The status a signature takes when it's made or edited. A rejection sticks, so editing
 * can't escape it. Private is approved at once. Public waits for review, unless it was
 * already public and its name, neighborhood and role are unchanged.
 */
function nextStatus(existing: SignatureRow | undefined, input: SignatureInput): SignatureStatus {
  if (existing?.status === 'rejected') return 'rejected';
  if (!input.isPublic) return 'approved';
  if (
    existing?.isPublic &&
    existing.name === input.name &&
    existing.neighborhood === input.neighborhood &&
    existing.role === input.role
  ) {
    return existing.status as SignatureStatus;
  }
  return 'pending';
}

/**
 * Sign, or edit an existing signature (one per user per letter). `becamePendingPublic`
 * is true when a public signature has just joined the review queue.
 */
export async function upsertSignature(
  userId: string,
  input: SignatureInput
): Promise<{ signature: OwnSignature; becamePendingPublic: boolean }> {
  return db.transaction(async (tx) => {
    // A first signature is inserted outright. A second request racing it waits on the
    // unique index, does nothing, and then edits the committed row like any other edit
    const [created] = await tx
      .insert(letterSignatures)
      .values({ letter: LETTER, userId, ...input, status: nextStatus(undefined, input) })
      .onConflictDoNothing({ target: [letterSignatures.letter, letterSignatures.userId] })
      .returning();
    if (created) {
      return {
        signature: toOwnSignature(created),
        becamePendingPublic: created.status === 'pending',
      };
    }

    // Locked, so two edits at once can't both read the old status
    const [existing] = await tx
      .select()
      .from(letterSignatures)
      .where(and(eq(letterSignatures.letter, LETTER), eq(letterSignatures.userId, userId)))
      .for('update');
    if (!existing) throw new Error('Signature was removed while being edited');

    const status = nextStatus(existing, input);
    const becamePendingPublic = status === 'pending' && existing.status !== 'pending';
    // What the admin reviews; the updates opt-in alone doesn't make a review stale
    const reviewedFieldsChanged =
      existing.isPublic !== input.isPublic ||
      existing.name !== input.name ||
      existing.neighborhood !== input.neighborhood ||
      existing.role !== input.role;

    const [row] = await tx
      .update(letterSignatures)
      .set({
        ...input,
        status,
        updatedAt: sql`now()`,
        ...(reviewedFieldsChanged ? { revision: sql`${letterSignatures.revision} + 1` } : {}),
        // Back in the queue: the last review was of a different signature
        ...(becamePendingPublic ? { reviewedAt: null } : {}),
      })
      .where(eq(letterSignatures.id, existing.id))
      .returning();

    return { signature: toOwnSignature(row), becamePendingPublic };
  });
}

/** Remove the user's signature; false when there was none */
export async function deleteSignature(userId: string): Promise<boolean> {
  const own = and(eq(letterSignatures.letter, LETTER), eq(letterSignatures.userId, userId));
  // A rejected signature is emptied rather than deleted: the name goes, but the rejection
  // stays as a marker, so removing it and signing again can't get the account counted
  const emptied = await db
    .update(letterSignatures)
    .set({
      name: REMOVED_NAME,
      neighborhood: null,
      role: null,
      isPublic: false,
      wantsUpdates: false,
      updatedAt: sql`now()`,
      revision: sql`${letterSignatures.revision} + 1`,
    })
    .where(and(own, eq(letterSignatures.status, 'rejected')))
    .returning({ id: letterSignatures.id });
  const deleted = await db
    .delete(letterSignatures)
    .where(and(own, ne(letterSignatures.status, 'rejected')))
    .returning({ id: letterSignatures.id });
  return emptied.length + deleted.length > 0;
}

/**
 * The super admin's review of a public signature, applied only if it is still the
 * version they saw (`revision`) and still public. False when it has changed or gone,
 * so an Approve clicked on an old name never publishes a newer, unreviewed one.
 */
export async function setSignatureStatus(
  id: string,
  status: Exclude<SignatureStatus, 'pending'>,
  revision: number
): Promise<boolean> {
  const updated = await db
    .update(letterSignatures)
    .set({ status, reviewedAt: sql`now()`, revision: sql`${letterSignatures.revision} + 1` })
    .where(
      and(
        eq(letterSignatures.id, id),
        eq(letterSignatures.letter, LETTER),
        eq(letterSignatures.isPublic, true),
        eq(letterSignatures.revision, revision)
      )
    )
    .returning({ id: letterSignatures.id });
  return updated.length > 0;
}
