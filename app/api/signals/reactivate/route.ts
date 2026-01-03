import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { userPreferences } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isRecord, isString } from '@/lib/utils/validation';

interface PositiveSignal {
  eventId: string;
  signalType: 'favorite' | 'calendar' | 'share' | 'viewSource';
  timestamp: string;
  active: boolean;
}

interface NegativeSignal {
  eventId: string;
  timestamp: string;
  active: boolean;
}

// POST /api/signals/reactivate - Re-activate an old signal
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

    // Validate input
    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json({ error: 'Invalid eventId' }, { status: 400 });
    }

    // Fetch existing preferences
    const existingPrefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    if (existingPrefs.length === 0) {
      return NextResponse.json({ error: 'No preferences found' }, { status: 404 });
    }

    const prefs = existingPrefs[0];
    const positiveSignals = (prefs.positiveSignals as PositiveSignal[]) ?? [];
    const negativeSignals = (prefs.negativeSignals as NegativeSignal[]) ?? [];

    // Find the signal in either positive or negative signals
    const positiveSignalIndex = positiveSignals.findIndex((s) => s.eventId === eventId);
    const negativeSignalIndex = negativeSignals.findIndex((s) => s.eventId === eventId);

    if (positiveSignalIndex === -1 && negativeSignalIndex === -1) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    // Re-activate the signal by setting active: true
    if (positiveSignalIndex !== -1) {
      const updatedPositiveSignals = [...positiveSignals];
      updatedPositiveSignals[positiveSignalIndex] = {
        ...updatedPositiveSignals[positiveSignalIndex],
        active: true,
      };

      // Update preferences and invalidate centroid
      await db
        .update(userPreferences)
        .set({
          positiveSignals: updatedPositiveSignals,
          positiveCentroid: null,
          centroidUpdatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.userId, user.id));

      return NextResponse.json({
        success: true,
        signal: updatedPositiveSignals[positiveSignalIndex],
      });
    } else {
      const updatedNegativeSignals = [...negativeSignals];
      updatedNegativeSignals[negativeSignalIndex] = {
        ...updatedNegativeSignals[negativeSignalIndex],
        active: true,
      };

      // Update preferences and invalidate centroid
      await db
        .update(userPreferences)
        .set({
          negativeSignals: updatedNegativeSignals,
          negativeCentroid: null,
          centroidUpdatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(userPreferences.userId, user.id));

      return NextResponse.json({
        success: true,
        signal: updatedNegativeSignals[negativeSignalIndex],
      });
    }
  } catch (error) {
    console.error('Error reactivating signal:', error);
    return NextResponse.json({ error: 'Failed to reactivate signal' }, { status: 500 });
  }
}
