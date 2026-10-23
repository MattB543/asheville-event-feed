/**
 * Super-admin hand edits to a holiday page: add an event to the weekend wall, hide one,
 * or give it a poster. JSON to add/hide; multipart (`season`, `eventId`, `poster` file) for a poster.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { SEASONS } from '@/lib/seasons';
import { SEASON_PICKS_TAG, setSeasonPick } from '@/lib/db/queries/seasonPicks';
import { normalizeImage } from '@/lib/posters/processUpload';
import { uploadEventImage } from '@/lib/supabase/storage';
import { isRecord } from '@/lib/utils/validation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The host's own request limit is about 4.5 MB; the page shrinks photos before sending
const MAX_POSTER_BYTES = 4 * 1024 * 1024;

const isSeason = (value: unknown): value is string =>
  SEASONS.some((season) => season.key === value);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isSuperAdmin(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const season = form.get('season');
      const eventId = form.get('eventId');
      const poster = form.get('poster');
      if (!isSeason(season) || typeof eventId !== 'string' || !UUID_PATTERN.test(eventId)) {
        return NextResponse.json({ error: 'Unknown season or event' }, { status: 400 });
      }
      if (!(poster instanceof File) || poster.size === 0 || poster.size > MAX_POSTER_BYTES) {
        return NextResponse.json({ error: 'That image is too large to upload' }, { status: 400 });
      }
      const image = await normalizeImage(Buffer.from(await poster.arrayBuffer()));
      if (!image.ok) return NextResponse.json({ error: image.message }, { status: 400 });
      const url = await uploadEventImage(image.buffer, eventId, 'image/jpeg', `seasons/${season}`);
      // A new upload keeps the same path, so the query string makes browsers fetch it fresh
      await setSeasonPick(season, eventId, { posterUrl: `${url}?v=${Date.now()}` });
    } else {
      const body: unknown = await request.json();
      if (
        !isRecord(body) ||
        !isSeason(body.season) ||
        typeof body.eventId !== 'string' ||
        !UUID_PATTERN.test(body.eventId)
      ) {
        return NextResponse.json({ error: 'Unknown season or event' }, { status: 400 });
      }
      const change: { added?: boolean; hidden?: boolean; posterUrl?: null } = {};
      if (typeof body.added === 'boolean') change.added = body.added;
      if (typeof body.hidden === 'boolean') change.hidden = body.hidden;
      if (body.clearPoster === true) change.posterUrl = null;
      if (Object.keys(change).length === 0) {
        return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
      }
      await setSeasonPick(body.season, body.eventId, change);
    }
    revalidateTag(SEASON_PICKS_TAG, 'default');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[SeasonPicks] Update failed:', error);
    return NextResponse.json({ error: 'Could not save that change' }, { status: 500 });
  }
}
