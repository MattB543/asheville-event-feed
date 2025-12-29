import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Signal types
type PositiveSignalType = 'favorite' | 'calendar' | 'share' | 'viewSource';
type SignalType = PositiveSignalType | 'hide';

interface PositiveSignal {
  eventId: string;
  signalType: PositiveSignalType;
  timestamp: string;
  active: boolean;
}

interface NegativeSignal {
  eventId: string;
  timestamp: string;
  active: boolean;
}

// POST /api/signals - Add a signal
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { eventId, signalType } = body as { eventId?: string; signalType?: SignalType };

    // Validate inputs
    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json(
        { error: "Invalid eventId" },
        { status: 400 }
      );
    }

    const validSignalTypes: SignalType[] = ['favorite', 'calendar', 'share', 'viewSource', 'hide'];
    if (!signalType || !validSignalTypes.includes(signalType)) {
      return NextResponse.json(
        { error: "Invalid signalType. Must be one of: favorite, calendar, share, viewSource, hide" },
        { status: 400 }
      );
    }

    // Fetch existing preferences or create empty structure
    const existingPrefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    const timestamp = new Date().toISOString();

    // Determine which signals array to update
    const isNegativeSignal = signalType === 'hide';

    if (isNegativeSignal) {
      // Add to negative signals
      const existingNegativeSignals = (existingPrefs[0]?.negativeSignals as NegativeSignal[]) ?? [];

      // Check if signal already exists
      const signalExists = existingNegativeSignals.some(s => s.eventId === eventId);
      if (signalExists) {
        return NextResponse.json(
          { error: "Signal already exists" },
          { status: 400 }
        );
      }

      const newNegativeSignal: NegativeSignal = {
        eventId,
        timestamp,
        active: true,
      };

      const updatedNegativeSignals = [...existingNegativeSignals, newNegativeSignal];

      // Upsert preferences with new signal and invalidate centroid
      await db
        .insert(userPreferences)
        .values({
          userId: user.id,
          negativeSignals: updatedNegativeSignals,
          negativeCentroid: null,
          centroidUpdatedAt: null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            negativeSignals: updatedNegativeSignals,
            negativeCentroid: null,
            centroidUpdatedAt: null,
            updatedAt: new Date(),
          },
        });

      return NextResponse.json({ success: true, signal: newNegativeSignal });
    } else {
      // Add to positive signals
      const existingPositiveSignals = (existingPrefs[0]?.positiveSignals as PositiveSignal[]) ?? [];

      // Check if signal already exists
      const signalExists = existingPositiveSignals.some(
        s => s.eventId === eventId && s.signalType === signalType
      );
      if (signalExists) {
        return NextResponse.json(
          { error: "Signal already exists" },
          { status: 400 }
        );
      }

      const newPositiveSignal: PositiveSignal = {
        eventId,
        signalType: signalType as PositiveSignalType,
        timestamp,
        active: true,
      };

      const updatedPositiveSignals = [...existingPositiveSignals, newPositiveSignal];

      // Upsert preferences with new signal and invalidate centroid
      await db
        .insert(userPreferences)
        .values({
          userId: user.id,
          positiveSignals: updatedPositiveSignals,
          positiveCentroid: null,
          centroidUpdatedAt: null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            positiveSignals: updatedPositiveSignals,
            positiveCentroid: null,
            centroidUpdatedAt: null,
            updatedAt: new Date(),
          },
        });

      return NextResponse.json({ success: true, signal: newPositiveSignal });
    }
  } catch (error) {
    console.error("Error adding signal:", error);
    return NextResponse.json(
      { error: "Failed to add signal" },
      { status: 500 }
    );
  }
}

// DELETE /api/signals - Remove a signal
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { eventId, signalType } = body as { eventId?: string; signalType?: SignalType };

    // Validate inputs
    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json(
        { error: "Invalid eventId" },
        { status: 400 }
      );
    }

    const validSignalTypes: SignalType[] = ['favorite', 'calendar', 'share', 'viewSource', 'hide'];
    if (!signalType || !validSignalTypes.includes(signalType)) {
      return NextResponse.json(
        { error: "Invalid signalType. Must be one of: favorite, calendar, share, viewSource, hide" },
        { status: 400 }
      );
    }

    // Fetch existing preferences
    const existingPrefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    if (existingPrefs.length === 0) {
      return NextResponse.json(
        { error: "No preferences found" },
        { status: 404 }
      );
    }

    const isNegativeSignal = signalType === 'hide';

    if (isNegativeSignal) {
      // Remove from negative signals
      const existingNegativeSignals = (existingPrefs[0].negativeSignals as NegativeSignal[]) ?? [];
      const updatedNegativeSignals = existingNegativeSignals.filter(
        s => s.eventId !== eventId
      );

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

      return NextResponse.json({ success: true });
    } else {
      // Remove from positive signals
      const existingPositiveSignals = (existingPrefs[0].positiveSignals as PositiveSignal[]) ?? [];
      const updatedPositiveSignals = existingPositiveSignals.filter(
        s => !(s.eventId === eventId && s.signalType === signalType)
      );

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

      return NextResponse.json({ success: true });
    }
  } catch (error) {
    console.error("Error removing signal:", error);
    return NextResponse.json(
      { error: "Failed to remove signal" },
      { status: 500 }
    );
  }
}
