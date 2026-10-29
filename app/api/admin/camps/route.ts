/**
 * Super-admin actions for /admin/camps (docs/camps/04-v2-plan.md §1.2). Body: `{ action, ... }`:
 *
 * - `confirm`: `{ id, hash }`, the cardHash of the card the page showed; 409 when the camp has
 *   changed since, so Confirm never approves a card Matt didn't see
 * - `hide` | `unhide` | `clear_override`: `{ id }`
 * - `override`: `{ id, key, value }`, one top-level CampCard field, kept alongside the camp's
 *   other fixes; `value` must have the shape Sol's extraction schema gives that field
 * - `pin`: `{ siteId, lat, lng }`, a point pasted from Google Maps
 *
 * The query functions expire the `camps` cache tag themselves.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { setCampHidden, setOverride, setSitePin } from '@/lib/db/queries/camps';
import {
  confirmCampRevision,
  isCampCardKey,
  overrideProblem,
  setOverrideField,
} from '@/lib/db/queries/campsAdmin';
import { kmBetween, PACK_SQUARE } from '@/lib/camps/geo';
import { isNumber, isRecord, isString } from '@/lib/utils/validation';

// A pin waits on ORS for its drive minutes, which can retry past 30s
export const maxDuration = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Farther than this from Pack Square is a typo or swapped numbers (the geocoder's own bound). */
const MAX_PIN_KM = 200;

const isUuid = (value: unknown): value is string => isString(value) && UUID_PATTERN.test(value);

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

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
    return badRequest('Invalid JSON body');
  }
  if (!isRecord(body)) return badRequest('Invalid request body');
  const { action } = body;

  try {
    let found: boolean;
    if (action === 'pin') {
      const { siteId, lat, lng } = body;
      if (!isUuid(siteId) || !isNumber(lat) || !isNumber(lng)) {
        return badRequest('A pin needs siteId, lat and lng');
      }
      if (kmBetween(PACK_SQUARE, { lat, lng }) > MAX_PIN_KM) {
        return badRequest(`${lat}, ${lng} is over ${MAX_PIN_KM} km from Asheville`);
      }
      found = await setSitePin(siteId, lat, lng);
    } else {
      const { id } = body;
      if (!isUuid(id)) return badRequest('Unknown camp id');
      switch (action) {
        case 'confirm': {
          const { hash } = body;
          if (!isString(hash) || !HASH_PATTERN.test(hash)) return badRequest('No card hash');
          const result = await confirmCampRevision(id, hash);
          if (result === 'changed') {
            const error = 'This camp changed since you loaded the page; reload to see it.';
            return NextResponse.json({ error }, { status: 409 });
          }
          found = result === 'confirmed';
          break;
        }
        case 'hide':
        case 'unhide':
          found = await setCampHidden(id, action === 'hide');
          break;
        case 'clear_override':
          found = await setOverride(id, null);
          break;
        case 'override': {
          const { key, value } = body;
          if (!isCampCardKey(key)) return badRequest('Not a camp card field');
          if (value === undefined) return badRequest('A fix needs a value');
          const problem = overrideProblem(key, value);
          if (problem) return badRequest(problem);
          found = await setOverrideField(id, key, value);
          break;
        }
        default:
          return badRequest('Unknown action');
      }
    }

    if (!found) {
      return NextResponse.json(
        { error: action === 'pin' ? 'No such site' : 'No such camp' },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Camps] Admin action failed:', error);
    return NextResponse.json({ error: 'Could not save that change' }, { status: 500 });
  }
}
