/**
 * A season's settings (admins only): `{key, start, end, short, banner, enabled, color, fade,
 * icon}` to save (checked by checkSeasonSettings), `{key, reset: true}` for its defaults.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/utils/admin';
import { SEASONS, checkSeasonSettings, type SeasonKey } from '@/lib/seasons';
import { SEASONS_TAG, saveSeasonSettings } from '@/lib/db/queries/seasonSettings';
import { isRecord } from '@/lib/utils/validation';

const isSeasonKey = (value: unknown): value is SeasonKey => SEASONS.some((s) => s.key === value);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isAdmin(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !isSeasonKey(body.key)) {
    return NextResponse.json({ error: 'Unknown season' }, { status: 400 });
  }
  let settings = null;
  if (body.reset !== true) {
    const checked = checkSeasonSettings(body);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    settings = checked.settings;
  }

  try {
    await saveSeasonSettings(body.key, settings);
    // Expired at once, so the admin's next page already has the new dates
    revalidateTag(SEASONS_TAG, { expire: 0 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Seasons] Update failed:', error);
    return NextResponse.json({ error: 'Could not save that change' }, { status: 500 });
  }
}
