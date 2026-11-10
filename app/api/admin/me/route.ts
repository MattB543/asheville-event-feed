/**
 * Whether the signed-in viewer is an admin, so the account menu can show the admin pages.
 * SUPER_ADMIN is server-only, so the browser has to ask.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/utils/admin';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json(
    { admin: isAdmin(user?.id) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
