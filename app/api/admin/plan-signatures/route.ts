/**
 * Super-admin review of public signatures on the /plan letter: approve or reject one.
 * Body: `{ id, status: 'approved' | 'rejected', revision }`, where `revision` is the one
 * the admin was shown; a signature edited since then answers 409 instead.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { setSignatureStatus } from '@/lib/db/queries/letterSignatures';
import { isRecord, isString } from '@/lib/utils/validation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isReviewStatus = (value: unknown): value is 'approved' | 'rejected' =>
  value === 'approved' || value === 'rejected';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isSuperAdmin(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    !isString(body.id) ||
    !UUID_PATTERN.test(body.id) ||
    !isReviewStatus(body.status) ||
    !Number.isInteger(body.revision)
  ) {
    return NextResponse.json({ error: 'Unknown signature or status' }, { status: 400 });
  }

  try {
    const applied = await setSignatureStatus(body.id, body.status, body.revision as number);
    if (!applied) {
      return NextResponse.json(
        { error: 'This signature changed or was removed. Refresh to see it now.' },
        { status: 409 }
      );
    }
  } catch (error) {
    console.error('[Plan] Review failed:', error);
    return NextResponse.json({ error: 'Could not save that change' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
