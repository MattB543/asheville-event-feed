'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import ShareButton from '@/components/ShareButton';
import {
  NAME_MAX,
  NEIGHBORHOOD_MAX,
  ROLE_MAX,
  type OwnSignature,
  type SignRequest,
} from '@/lib/letter/outagePlan';

const LETTER_TITLE =
  'An open letter to Asheville leaders: We need Water and Food Plans for Long Outages';
const SIGN_PATH = '/plan#sign';

type Field = 'name' | 'neighborhood' | 'role' | 'isPublic' | 'resident';
type FieldErrors = Partial<Record<Field, string>>;

const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1';
const hintClass = 'mt-1 text-xs text-gray-500 dark:text-gray-400';
const errorClass = 'mt-1 text-sm text-red-600 dark:text-red-400';
const primaryButton =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButton =
  'inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

function inputClass(invalid: boolean) {
  return `w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 ${
    invalid ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
  }`;
}

/** Joins the ids of whichever hint and error are on screen, for aria-describedby */
function describedBy(...ids: (string | false)[]) {
  return ids.filter(Boolean).join(' ') || undefined;
}

function metadataName(user: User): string {
  const meta = user.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
  const name = meta?.full_name ?? meta?.name;
  return typeof name === 'string' ? name.slice(0, NAME_MAX) : '';
}

function statusLine(signature: OwnSignature) {
  if (signature.status === 'rejected') {
    return (
      <>
        Your signature isn&apos;t counted or shown. Questions:{' '}
        <a href="mailto:plan@avlgo.com" className="underline hover:no-underline">
          plan@avlgo.com
        </a>
      </>
    );
  }
  if (!signature.isPublic) return "You're counted; your name isn't published.";
  return signature.status === 'approved'
    ? 'Your name is listed below.'
    : 'Your name will appear after a quick review.';
}

/** How the signature reads, for the confirmation card and the closed note */
function SignatureSummary({ signature }: { signature: OwnSignature }) {
  const detail = [signature.neighborhood, signature.role].filter(Boolean).join(' · ');
  return (
    <div className="text-sm">
      <p className="font-semibold text-gray-900 dark:text-gray-100 break-words">{signature.name}</p>
      {detail && <p className="text-gray-600 dark:text-gray-400 break-words">{detail}</p>}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {signature.isPublic ? 'Public signature' : 'Private signature'}
      </p>
    </div>
  );
}

interface SignatureFormProps {
  user: User;
  existing: OwnSignature | null;
  onSaved: (signature: OwnSignature) => void;
  onCancel?: () => void;
}

function SignatureForm({ user, existing, onSaved, onCancel }: SignatureFormProps) {
  const [name, setName] = useState(existing?.name ?? metadataName(user));
  const [neighborhood, setNeighborhood] = useState(existing?.neighborhood ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  // Nothing is pre-selected on a new signature: public or private is the signer's call
  const [isPublic, setIsPublic] = useState<boolean | null>(existing?.isPublic ?? null);
  // A saved signature already affirmed residency, or it couldn't have been saved
  const [resident, setResident] = useState(existing !== null);
  const [wantsUpdates, setWantsUpdates] = useState(existing?.wantsUpdates ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clearError = (field: Field) =>
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const found: FieldErrors = {};
    if (!name.trim()) found.name = 'Enter your name.';
    if (isPublic === null) found.isPublic = 'Choose whether to publish your name.';
    if (!resident) found.resident = 'Only Asheville-area residents can sign.';
    setErrors(found);
    const first = (['name', 'isPublic', 'resident'] as const).find((field) => found[field]);
    if (first) {
      document.getElementById(`plan-${first}`)?.focus();
      return;
    }

    const body: SignRequest = {
      name: name.trim(),
      neighborhood: neighborhood.trim() || undefined,
      role: role.trim() || undefined,
      isPublic: isPublic === true,
      resident,
      wantsUpdates,
    };

    setSubmitting(true);
    try {
      const response = await fetch('/api/plan/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => null)) as {
        signature?: OwnSignature;
        error?: string;
        field?: Field;
      } | null;

      if (response.ok && data?.signature) {
        onSaved(data.signature);
        return;
      }
      if (response.status === 400 && data?.field) {
        setErrors({ [data.field]: data.error ?? 'Check this field.' });
        document.getElementById(`plan-${data.field}`)?.focus();
      } else if (response.status === 401) {
        setFormError("You've been signed out. Sign in again to add your name.");
      } else if (response.status === 429) {
        setFormError('Too many changes in the last hour. Try again later.');
      } else {
        setFormError(data?.error ?? "Couldn't save your signature. Try again.");
      }
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Editing a public signature (or going public) puts it back in the review queue
  const backToReview = existing !== null && existing.status !== 'rejected' && isPublic === true;

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      className="ph-no-capture space-y-5"
      aria-busy={submitting}
    >
      <div>
        <label htmlFor="plan-name" className={labelClass}>
          Full name <span className="text-red-500">*</span>
        </label>
        <input
          id="plan-name"
          type="text"
          autoComplete="name"
          required
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearError('name');
          }}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy(!!errors.name && 'plan-name-error')}
          className={inputClass(!!errors.name)}
        />
        {errors.name && (
          <p id="plan-name-error" className={errorClass}>
            {errors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="plan-neighborhood" className={labelClass}>
          Neighborhood
        </label>
        <input
          id="plan-neighborhood"
          type="text"
          maxLength={NEIGHBORHOOD_MAX}
          placeholder="West Asheville"
          value={neighborhood}
          onChange={(e) => {
            setNeighborhood(e.target.value);
            clearError('neighborhood');
          }}
          aria-invalid={errors.neighborhood ? true : undefined}
          aria-describedby={describedBy(
            'plan-neighborhood-hint',
            !!errors.neighborhood && 'plan-neighborhood-error'
          )}
          className={inputClass(!!errors.neighborhood)}
        />
        <p id="plan-neighborhood-hint" className={hintClass}>
          Optional.
        </p>
        {errors.neighborhood && (
          <p id="plan-neighborhood-error" className={errorClass}>
            {errors.neighborhood}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="plan-role" className={labelClass}>
          Role
        </label>
        <input
          id="plan-role"
          type="text"
          maxLength={ROLE_MAX}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            clearError('role');
          }}
          aria-invalid={errors.role ? true : undefined}
          aria-describedby={describedBy('plan-role-hint', !!errors.role && 'plan-role-error')}
          className={inputClass(!!errors.role)}
        />
        <p id="plan-role-hint" className={hintClass}>
          Optional. Listed for identification only; you&apos;re signing as a resident.
        </p>
        {errors.role && (
          <p id="plan-role-error" className={errorClass}>
            {errors.role}
          </p>
        )}
      </div>

      <fieldset
        role="radiogroup"
        aria-required="true"
        aria-invalid={errors.isPublic ? true : undefined}
        aria-describedby={describedBy(
          'plan-isPublic-hint',
          !!errors.isPublic && 'plan-isPublic-error'
        )}
      >
        <legend className={labelClass}>
          Your name <span className="text-red-500">*</span>
        </legend>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
            <input
              // Client validation focuses this one when nothing is chosen
              id="plan-isPublic"
              type="radio"
              name="plan-visibility"
              checked={isPublic === true}
              onChange={() => {
                setIsPublic(true);
                clearError('isPublic');
              }}
              className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer"
            />
            Publish my name with the letter
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
            <input
              type="radio"
              name="plan-visibility"
              checked={isPublic === false}
              onChange={() => {
                setIsPublic(false);
                clearError('isPublic');
              }}
              className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer"
            />
            Count me, but don&apos;t publish my name
          </label>
        </div>
        <p id="plan-isPublic-hint" className={hintClass}>
          Public names appear on this page after a quick review and may be sent to officials with
          the letter. Private signers are counted but never published or sent to officials.
        </p>
        {errors.isPublic && (
          <p id="plan-isPublic-error" role="alert" className={errorClass}>
            {errors.isPublic}
          </p>
        )}
      </fieldset>

      <div className="space-y-3">
        <div>
          <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
            <input
              id="plan-resident"
              type="checkbox"
              required
              checked={resident}
              onChange={(e) => {
                setResident(e.target.checked);
                clearError('resident');
              }}
              aria-invalid={errors.resident ? true : undefined}
              aria-describedby={describedBy(!!errors.resident && 'plan-resident-error')}
              className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer"
            />
            <span>
              I live in the Asheville metro area. <span className="text-red-500">*</span>
            </span>
          </label>
          {errors.resident && (
            <p id="plan-resident-error" className={errorClass}>
              {errors.resident}
            </p>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
          <input
            type="checkbox"
            checked={wantsUpdates}
            onChange={(e) => setWantsUpdates(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer"
          />
          Email me when officials&apos; responses are published.
        </label>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 break-words">
        Signing as {user.email}
      </p>

      {backToReview && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {existing.isPublic
            ? 'Changing your name, neighborhood or role sends your signature back for a quick review before it shows again.'
            : 'Your name will appear after a quick review.'}
        </p>
      )}

      {formError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={submitting} className={primaryButton}>
          {submitting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {existing ? 'Save changes' : 'Add my name'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className={secondaryButton}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

interface SignLetterFormProps {
  /** The signed-in user the page was rendered for (null when signed out) */
  ownerId: string | null;
  initialSignature: OwnSignature | null;
  signingOpen: boolean;
  /** The signatures couldn't be read, so the page doesn't know whether this visitor signed */
  unavailable: boolean;
}

/** The /plan sign-up: sign in, sign (publicly or privately), then edit or remove it */
export default function SignLetterForm({
  ownerId,
  initialSignature,
  signingOpen,
  unavailable,
}: SignLetterFormProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  // What the last write returned, and for whom, shown until the refreshed props arrive
  // (signature null = removed)
  const [saved, setSaved] = useState<{ userId: string; signature: OwnSignature | null } | null>(
    null
  );
  const [prevInitial, setPrevInitial] = useState(initialSignature);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const refreshedFor = useRef<string | null | undefined>(undefined);

  // Fresh server props win over the local copy
  if (initialSignature !== prevInitial) {
    setPrevInitial(initialSignature);
    setSaved(null);
  }

  const userId = user?.id ?? null;
  // The page was rendered for someone else: signed in, out or switched accounts in
  // another tab. Its signature isn't this visitor's, so ask the server again
  const stale = !isLoading && userId !== ownerId;
  useEffect(() => {
    if (!stale || refreshedFor.current === userId) return;
    refreshedFor.current = userId;
    setEditing(false);
    router.refresh();
  }, [stale, userId, router]);

  // Only ever this visitor's own signature: a write's result counts only for the account
  // that made it, and the page's only while it was rendered for this account
  const signature =
    user && saved?.userId === user.id
      ? saved.signature
      : user && user.id === ownerId
        ? initialSignature
        : null;

  const handleSaved = (forUser: string, next: OwnSignature) => {
    setSaved({ userId: forUser, signature: next });
    setEditing(false);
    router.refresh();
  };

  const handleRemove = async () => {
    if (!user || !window.confirm('Remove your signature from the letter?')) return;
    const forUser = user.id;
    setRemoving(true);
    setRemoveError(null);
    try {
      const response = await fetch('/api/plan/sign', { method: 'DELETE' });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setRemoveError(data?.error ?? "Couldn't remove your signature. Try again.");
        return;
      }
      setSaved({ userId: forUser, signature: null });
      setEditing(false);
      router.refresh();
    } catch {
      setRemoveError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setRemoving(false);
    }
  };

  const removeControls = (
    <>
      <button
        type="button"
        onClick={() => void handleRemove()}
        disabled={removing}
        className={`${secondaryButton} !text-red-600 dark:!text-red-400`}
      >
        {removing && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
        Remove my signature
      </button>
      {removeError && (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {removeError}
        </p>
      )}
    </>
  );

  let body;
  if (unavailable) {
    body = (
      <p className="text-gray-600 dark:text-gray-400">
        Signing is unavailable right now. Please try again in a few minutes.
      </p>
    );
  } else if (!signingOpen) {
    body = (
      <div className="space-y-4">
        <p className="text-gray-600 dark:text-gray-400">
          Signing is closed. Thank you to everyone who added their name.
        </p>
        {signature && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">{statusLine(signature)}</p>
            <SignatureSummary signature={signature} />
            {/* Taking a name off stays open after signing closes */}
            <div className="flex flex-wrap gap-3">{removeControls}</div>
          </div>
        )}
      </div>
    );
  } else if (isLoading || stale) {
    // stale: the page is about to refresh for this account, so no form shows meanwhile
    // Roughly the signed-out block's height, so the section doesn't jump when auth resolves
    body = (
      <div className="space-y-4 animate-pulse" role="status">
        <span className="sr-only">Loading</span>
        <div className="h-4 w-full rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-11 w-full max-w-sm rounded bg-gray-200 dark:bg-gray-800" />
        <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-800" />
      </div>
    );
  } else if (!user) {
    body = (
      <div className="space-y-4">
        <p className="text-gray-600 dark:text-gray-400">
          Signing takes an AVL GO account, so every signature is a real, verified email. Your email
          is never shown.
        </p>
        <GoogleSignInButton redirectTo={SIGN_PATH} className="w-full max-w-sm" />
        <Link
          href={`/login?next=${encodeURIComponent(SIGN_PATH)}`}
          className="inline-block text-sm text-brand-700 dark:text-brand-400 underline hover:no-underline"
        >
          Sign in with email instead
        </Link>
      </div>
    );
  } else if (!signature || editing) {
    body = (
      <SignatureForm
        // Remount on each open, so the fields start from the saved values
        // and on an account change, so one account's draft never carries over to another
        key={`${user.id}-${editing ? 'edit' : 'new'}`}
        user={user}
        existing={signature}
        onSaved={(next) => handleSaved(user.id, next)}
        onCancel={editing ? () => setEditing(false) : undefined}
      />
    );
  } else {
    body = (
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4">
        <div className="flex items-start gap-3">
          {signature.status === 'rejected' ? (
            <AlertCircle
              size={20}
              className="mt-0.5 flex-shrink-0 text-gray-400"
              aria-hidden="true"
            />
          ) : (
            <CheckCircle
              size={20}
              className="mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
          )}
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {signature.status === 'rejected' ? 'Signature not counted' : 'You’ve signed.'}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{statusLine(signature)}</p>
          </div>
        </div>
        <SignatureSummary signature={signature} />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setRemoveError(null);
              setEditing(true);
            }}
            disabled={removing}
            className={secondaryButton}
          >
            Edit
          </button>
          {removeControls}
        </div>
        {signature.status !== 'rejected' && (
          <div className="flex items-center gap-2 border-t border-gray-200 dark:border-gray-800 pt-3 text-sm text-gray-600 dark:text-gray-400">
            Share it with neighbors:
            {/* ShareNote positions itself against this wrapper */}
            <div className="relative">
              <ShareButton path="/plan" title={LETTER_TITLE} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">Sign the letter</h2>
      {body}
    </div>
  );
}
