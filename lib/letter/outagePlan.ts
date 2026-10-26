/**
 * The open letter at /plan: residents sign with an AVL GO account (so the email is
 * already verified), publicly or privately. Shared by the page, its API routes and
 * the signature queries.
 */

/** The `letter` column value, so a later letter can share the table */
export const LETTER = 'outage-plan';

/** Signing (and editing a signature) closes at the end of this day, Eastern */
export const SIGNING_CLOSES_AT = new Date('2027-01-01T05:00:00Z');

export const NAME_MAX = 80;
export const NEIGHBORHOOD_MAX = 80;
export const ROLE_MAX = 80;

/**
 * pending: a public signature waiting for the super admin's review (counted, not shown).
 * approved: shown if public; private signatures are approved as soon as they're made.
 * rejected: neither counted nor shown.
 */
export type SignatureStatus = 'pending' | 'approved' | 'rejected';

/** What the page shows for one public, approved signer */
export interface PublicSigner {
  name: string;
  neighborhood: string | null;
  role: string | null;
}

export interface LetterPageData {
  /** Every signature that isn't rejected, public or private */
  total: number;
  /** Public and approved, oldest first */
  shown: PublicSigner[];
}

/** The signed-in visitor's own signature */
export interface OwnSignature {
  name: string;
  neighborhood: string | null;
  role: string | null;
  isPublic: boolean;
  wantsUpdates: boolean;
  status: SignatureStatus;
  /** ISO timestamp */
  createdAt: string;
}

/** One public signature in the super admin's review list */
export interface ReviewRow {
  id: string;
  name: string;
  neighborhood: string | null;
  role: string | null;
  status: SignatureStatus;
  /** ISO timestamp */
  createdAt: string;
  /** Sent back with a review, which is refused if the signature has changed since */
  revision: number;
}

export interface ReviewQueue {
  pending: ReviewRow[];
  approved: ReviewRow[];
  rejected: ReviewRow[];
}

/** POST /api/plan/sign body */
export interface SignRequest {
  name: string;
  neighborhood?: string;
  role?: string;
  isPublic: boolean;
  /** Must be true: "I live in the Asheville metro area" */
  resident: boolean;
  wantsUpdates: boolean;
}

export function isSigningOpen(now: Date = new Date()): boolean {
  return now < SIGNING_CLOSES_AT;
}
