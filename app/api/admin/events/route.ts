/**
 * Admin edits to one event. GET `?eventId=` reads what the admin panel shows. POST JSON: `{eventId, hidden}`, `{eventId, edit: {title?,
 * location?, price?}}` or `{eventId, undo: true}`; multipart (`eventId`, `poster` file) for a poster.
 * Edited fields are recorded in `edited_fields` so the scrape leaves them alone.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/utils/admin';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { invalidateEventsCache } from '@/lib/cache/invalidation';
import { editedList, LOCKED_FIELDS, TEXT_EDIT_FIELDS, type LockedField } from '@/lib/events/edits';
import { normalizeImage } from '@/lib/posters/processUpload';
import { uploadEventImage } from '@/lib/supabase/storage';
import { isRecord } from '@/lib/utils/validation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The host's own request limit is about 4.5 MB; the page shrinks photos before sending
const MAX_POSTER_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 300;

const COLUMNS = {
  title: events.title,
  location: events.location,
  price: events.price,
  imageUrl: events.imageUrl,
} as const;

/** Saves each field's current value as its baseline, unless an earlier edit already did. */
function withBaselines(fields: LockedField[]): SQL {
  const pairs = fields.map((field) => sql`${field}::text, to_jsonb(${COLUMNS[field]})`);
  return sql`jsonb_build_object(${sql.join(pairs, sql`, `)}) || ${events.editedFields}`;
}

const RETURNING = {
  title: events.title,
  location: events.location,
  price: events.price,
  imageUrl: events.imageUrl,
  hidden: events.hidden,
  editedFields: events.editedFields,
};

/** The 401 or 403 to send, or null for an admin. */
async function refuseNonAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  if (!isAdmin(user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

// The event preview pop-up has no server render to read this from
export async function GET(request: NextRequest) {
  const refusal = await refuseNonAdmin();
  if (refusal) return refusal;

  const eventId = request.nextUrl.searchParams.get('eventId');
  if (!eventId || !UUID_PATTERN.test(eventId)) {
    return NextResponse.json({ error: 'Unknown event' }, { status: 400 });
  }
  try {
    const [row] = await db
      .select({
        ...RETURNING,
        score: events.score,
        scoreRarity: events.scoreRarity,
        scoreUnique: events.scoreUnique,
        scoreMagnitude: events.scoreMagnitude,
        scoreReason: events.scoreReason,
        scoreOverride: events.scoreOverride,
      })
      .from(events)
      .where(eq(events.id, eventId));
    if (!row) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    return NextResponse.json({
      values: { title: row.title, location: row.location, price: row.price },
      hidden: row.hidden === true,
      edited: editedList(row.editedFields),
      // For the score panel, which the event page fills from its own render
      scores:
        row.score === null
          ? null
          : {
              aiScores: {
                rarity: row.scoreRarity,
                unique: row.scoreUnique,
                magnitude: row.scoreMagnitude,
              },
              scoreReason: row.scoreReason,
              scoreOverride: row.scoreOverride,
            },
    });
  } catch (error) {
    console.error('[AdminEvents] Read failed:', error);
    return NextResponse.json({ error: 'Could not load that event' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const refusal = await refuseNonAdmin();
  if (refusal) return refusal;

  try {
    let eventId: string;
    let set: PgUpdateSetSource<typeof events>;

    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const id = form.get('eventId');
      const poster = form.get('poster');
      if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
        return NextResponse.json({ error: 'Unknown event' }, { status: 400 });
      }
      if (!(poster instanceof File) || poster.size === 0) {
        return NextResponse.json({ error: 'Choose an image to upload' }, { status: 400 });
      }
      if (poster.size > MAX_POSTER_BYTES) {
        return NextResponse.json({ error: 'That image is too large to upload' }, { status: 400 });
      }
      const image = await normalizeImage(Buffer.from(await poster.arrayBuffer()));
      if (!image.ok) return NextResponse.json({ error: image.message }, { status: 400 });
      const url = await uploadEventImage(image.buffer, id, 'image/jpeg', 'admin');
      eventId = id;
      // A new upload keeps the same path, so the query string makes browsers fetch it fresh
      set = { editedFields: withBaselines(['imageUrl']), imageUrl: `${url}?v=${Date.now()}` };
    } else {
      const body: unknown = await request.json().catch(() => null);
      if (!isRecord(body) || typeof body.eventId !== 'string' || !UUID_PATTERN.test(body.eventId)) {
        return NextResponse.json({ error: 'Unknown event' }, { status: 400 });
      }
      eventId = body.eventId;

      if (typeof body.hidden === 'boolean') {
        set = { hidden: body.hidden };
      } else if (body.undo === true) {
        // Each edited field goes back to its baseline; the next scrape then refreshes it
        set = { editedFields: sql`'{}'::jsonb` };
        for (const field of LOCKED_FIELDS) {
          const column = COLUMNS[field];
          // An empty baseline is stored as JSON null, so `->` still finds it and `->>` restores NULL
          set[field] =
            sql`CASE WHEN ${events.editedFields} -> ${field}::text IS NOT NULL THEN ${events.editedFields} ->> ${field}::text ELSE ${column} END`;
        }
      } else if (isRecord(body.edit)) {
        const edit = body.edit;
        const changes: { title?: string; location?: string | null; price?: string | null } = {};
        for (const field of TEXT_EDIT_FIELDS) {
          const value = edit[field];
          if (value === undefined) continue;
          if (typeof value !== 'string' || value.length > MAX_TEXT) {
            return NextResponse.json({ error: `That ${field} isn't valid` }, { status: 400 });
          }
          const trimmed = value.trim();
          if (field === 'title') {
            if (!trimmed) {
              return NextResponse.json({ error: 'The title can’t be empty' }, { status: 400 });
            }
            changes.title = trimmed;
          } else {
            changes[field] = trimmed || null;
          }
        }
        const fields = Object.keys(changes) as LockedField[];
        if (fields.length === 0) {
          return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
        }
        set = { ...changes, editedFields: withBaselines(fields) };
      } else {
        return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
      }
    }

    const [row] = await db
      .update(events)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(events.id, eventId))
      .returning(RETURNING);
    if (!row) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    invalidateEventsCache();
    return NextResponse.json({ ok: true, event: row });
  } catch (error) {
    console.error('[AdminEvents] Update failed:', error);
    return NextResponse.json({ error: 'Could not save that change' }, { status: 500 });
  }
}
