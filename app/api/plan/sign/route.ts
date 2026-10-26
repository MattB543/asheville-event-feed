/**
 * Sign the open letter at /plan, edit your signature, or remove it. Signing needs an
 * AVL GO account, so the email is already verified and nothing is emailed here.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  countPendingPublic,
  deleteSignature,
  upsertSignature,
  type SignatureInput,
} from '@/lib/db/queries/letterSignatures';
import { isSigningOpen, NAME_MAX, NEIGHBORHOOD_MAX, ROLE_MAX } from '@/lib/letter/outagePlan';
import { sendLetterSignatureNotification } from '@/lib/notifications/slack';
import { isRateLimited } from '@/lib/utils/rate-limit';
import { isRecord, isString } from '@/lib/utils/validation';

type Field = 'name' | 'neighborhood' | 'role' | 'isPublic' | 'resident';

const invalid = (error: string, field: Field) =>
  NextResponse.json({ error, field }, { status: 400 });

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');

async function getSignedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Optional text: missing or blank is null, too long is an error */
function optionalText(value: unknown, max: number): string | null | false {
  if (value === undefined || value === null) return null;
  if (!isString(value)) return false;
  const text = clean(value);
  if (text.length > max) return false;
  return text || null;
}

export async function POST(request: NextRequest) {
  const user = await getSignedInUser();
  if (!user) return NextResponse.json({ error: 'Sign in to sign the letter' }, { status: 401 });
  if (!isSigningOpen()) {
    return NextResponse.json({ error: 'Signing has closed' }, { status: 403 });
  }
  if (isRateLimited(`plan-sign:${user.id}`, 20)) {
    return NextResponse.json({ error: 'Too many changes, try again later' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const name = isString(body.name) ? clean(body.name) : '';
  if (name.length < 2) return invalid('Enter your name', 'name');
  if (name.length > NAME_MAX) return invalid(`Keep your name under ${NAME_MAX} characters`, 'name');

  const neighborhood = optionalText(body.neighborhood, NEIGHBORHOOD_MAX);
  if (neighborhood === false) {
    return invalid(`Keep your neighborhood under ${NEIGHBORHOOD_MAX} characters`, 'neighborhood');
  }
  const role = optionalText(body.role, ROLE_MAX);
  if (role === false) return invalid(`Keep your role under ${ROLE_MAX} characters`, 'role');

  if (typeof body.isPublic !== 'boolean') {
    return invalid('Choose whether to show your name', 'isPublic');
  }
  if (body.resident !== true) {
    return invalid('Confirm that you live in the Asheville metro area', 'resident');
  }

  const input: SignatureInput = {
    name,
    neighborhood,
    role,
    isPublic: body.isPublic,
    wantsUpdates: body.wantsUpdates === true,
  };

  let result: Awaited<ReturnType<typeof upsertSignature>>;
  try {
    result = await upsertSignature(user.id, input);
  } catch (error) {
    console.error('[Plan] Saving a signature failed:', error);
    return NextResponse.json({ error: 'Could not save your signature' }, { status: 500 });
  }

  if (result.becamePendingPublic) {
    // The signature is saved either way; a failed ping only means a later review
    try {
      await sendLetterSignatureNotification({
        name,
        neighborhood,
        role,
        pendingCount: await countPendingPublic(),
      });
    } catch (error) {
      console.error('[Plan] Signature notification failed:', error);
    }
  }

  return NextResponse.json({ ok: true, signature: result.signature });
}

export async function DELETE() {
  const user = await getSignedInUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  try {
    await deleteSignature(user.id);
  } catch (error) {
    console.error('[Plan] Removing a signature failed:', error);
    return NextResponse.json({ error: 'Could not remove your signature' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
