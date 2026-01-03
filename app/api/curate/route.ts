import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateCuratorProfile,
  getUserCurations,
  addCuration,
  removeCuration,
} from '@/lib/supabase/curatorProfile';
import { isRecord, isString } from '@/lib/utils/validation';

// GET - Get current user's curations
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const curations = await getUserCurations(user.id);
    return NextResponse.json({ curations });
  } catch (error) {
    console.error('Error fetching curations:', error);
    return NextResponse.json({ error: 'Failed to fetch curations' }, { status: 500 });
  }
}

// POST - Add or remove a curation
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const eventId = isString(parsed.eventId) ? parsed.eventId : undefined;
    const action = isString(parsed.action) ? parsed.action : undefined;
    const note = isString(parsed.note) ? parsed.note : undefined;

    if (!eventId || !action) {
      return NextResponse.json({ error: 'Missing eventId or action' }, { status: 400 });
    }

    // Ensure curator profile exists
    await getOrCreateCuratorProfile(user.id, user.email || '');

    if (action === 'add') {
      await addCuration(user.id, eventId, note);
      return NextResponse.json({ success: true });
    } else if (action === 'remove') {
      await removeCuration(user.id, eventId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error updating curation:', error);
    return NextResponse.json({ error: 'Failed to update curation' }, { status: 500 });
  }
}
