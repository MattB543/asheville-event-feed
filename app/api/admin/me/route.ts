/**
 * Whether the signed-in viewer is an admin, so the account menu can show the admin pages.
 * SUPER_ADMIN is server-only, so the browser has to ask.
 */

import { NextResponse } from 'next/server';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/utils/admin';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  // Supabase being unreachable is not "not an admin": the menu keeps the answer for the visit
  if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)) {
    return NextResponse.json({ error: 'Could not check' }, { status: 503 });
  }
  return NextResponse.json(
    { admin: isAdmin(user?.id) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
