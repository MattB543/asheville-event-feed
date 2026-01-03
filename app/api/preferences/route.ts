import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { userPreferences } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isRecord, isString, isStringArray } from '@/lib/utils/validation';

export interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

export interface UserPreferencesData {
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: HiddenEventFingerprint[];
  favoritedEventIds: string[];
}

function parseHiddenEvents(value: unknown): HiddenEventFingerprint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !isString(entry.title) || !isString(entry.organizer)) {
      return [];
    }
    return [{ title: entry.title, organizer: entry.organizer }];
  });
}

// GET /api/preferences - Get current user's preferences
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({ preferences: null });
    }

    const row = result[0];
    const preferences: UserPreferencesData = {
      blockedHosts: row.blockedHosts ?? [],
      blockedKeywords: row.blockedKeywords ?? [],
      hiddenEvents: (row.hiddenEvents as HiddenEventFingerprint[]) ?? [],
      favoritedEventIds: row.favoritedEventIds ?? [],
    };

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }
}

// POST /api/preferences - Save current user's preferences
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
    if (!isRecord(parsed) || !isRecord(parsed.preferences)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const prefs = parsed.preferences;
    const blockedHosts = isStringArray(prefs.blockedHosts) ? prefs.blockedHosts : [];
    const blockedKeywords = isStringArray(prefs.blockedKeywords) ? prefs.blockedKeywords : [];
    const hiddenEvents = parseHiddenEvents(prefs.hiddenEvents);
    const favoritedEventIds = isStringArray(prefs.favoritedEventIds) ? prefs.favoritedEventIds : [];

    await db
      .insert(userPreferences)
      .values({
        userId: user.id,
        blockedHosts,
        blockedKeywords,
        hiddenEvents,
        favoritedEventIds,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          blockedHosts,
          blockedKeywords,
          hiddenEvents,
          favoritedEventIds,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving preferences:', error);
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }
}
