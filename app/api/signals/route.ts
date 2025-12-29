import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { isRecord, isString } from "@/lib/utils/validation";

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

const VALID_SIGNAL_TYPES: SignalType[] = [
  'favorite',
  'calendar',
  'share',
  'viewSource',
  'hide',
];

function parseSignalRequest(
  value: unknown
): { eventId: string; signalType: SignalType } | null {
  if (!isRecord(value)) return null;
  const eventId = isString(value.eventId) ? value.eventId : undefined;
  const signalType = isString(value.signalType) && VALID_SIGNAL_TYPES.includes(value.signalType as SignalType)
    ? (value.signalType as SignalType)
    : undefined;

  if (!eventId || !signalType) return null;
  return { eventId, signalType };
}

// POST /api/signals - Add a signal
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    console.log("[Signals API] POST request, user:", user?.id ?? "none");

    if (!user) {
      console.log("[Signals API] Unauthorized - no user session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed: unknown = await request.json();
    const parsedBody = parseSignalRequest(parsed);

    // Validate inputs
    if (!parsedBody) {
      console.log("[Signals API] Invalid request body:", parsed);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { eventId, signalType } = parsedBody;
    console.log("[Signals API] Adding signal:", signalType, "for event:", eventId);
    const timestamp = new Date().toISOString();
    const isNegativeSignal = signalType === 'hide';

    if (isNegativeSignal) {
      const newNegativeSignal: NegativeSignal = {
        eventId,
        timestamp,
        active: true,
      };

      // Use atomic JSONB append to avoid race conditions
      // First, ensure user preferences row exists
      await db
        .insert(userPreferences)
        .values({
          userId: user.id,
          negativeSignals: [],
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      // Then atomically append the new signal (only if it doesn't already exist)
      await db.execute(sql`
        UPDATE user_preferences
        SET
          negative_signals = (
            CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(negative_signals, '[]'::jsonb)) elem
                WHERE elem->>'eventId' = ${eventId}
              )
              THEN COALESCE(negative_signals, '[]'::jsonb) || ${JSON.stringify(newNegativeSignal)}::jsonb
              ELSE negative_signals
            END
          ),
          negative_centroid = NULL,
          centroid_updated_at = NULL,
          updated_at = NOW()
        WHERE user_id = ${user.id}
      `);

      return NextResponse.json({ success: true, signal: newNegativeSignal });
    } else {
      const newPositiveSignal: PositiveSignal = {
        eventId,
        signalType,
        timestamp,
        active: true,
      };

      // Use atomic JSONB append to avoid race conditions
      // First, ensure user preferences row exists
      await db
        .insert(userPreferences)
        .values({
          userId: user.id,
          positiveSignals: [],
          updatedAt: new Date(),
        })
        .onConflictDoNothing();

      // Then atomically append the new signal (only if it doesn't already exist for this eventId+signalType)
      await db.execute(sql`
        UPDATE user_preferences
        SET
          positive_signals = (
            CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(positive_signals, '[]'::jsonb)) elem
                WHERE elem->>'eventId' = ${eventId} AND elem->>'signalType' = ${signalType}
              )
              THEN COALESCE(positive_signals, '[]'::jsonb) || ${JSON.stringify(newPositiveSignal)}::jsonb
              ELSE positive_signals
            END
          ),
          positive_centroid = NULL,
          centroid_updated_at = NULL,
          updated_at = NOW()
        WHERE user_id = ${user.id}
      `);

      console.log("[Signals API] Signal added successfully:", signalType, eventId);
      return NextResponse.json({ success: true, signal: newPositiveSignal });
    }
  } catch (error) {
    console.error("[Signals API] Error adding signal:", error);
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

    const parsed: unknown = await request.json();
    const parsedBody = parseSignalRequest(parsed);

    // Validate inputs
    if (!parsedBody) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { eventId, signalType } = parsedBody;
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
