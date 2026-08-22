import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  type ScoreOverride,
  type AdminOverride,
  calculateFinalScores,
} from '@/lib/utils/scoreCalculation';
import { isNumber, isRecord, isString } from '@/lib/utils/validation';

interface ScoreOverrideInput {
  rarity?: number;
  unique?: number;
  magnitude?: number;
  reason?: string;
}

function parseOverrides(value: unknown): ScoreOverrideInput | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const overrides: ScoreOverrideInput = {};
  for (const key of ['rarity', 'unique', 'magnitude'] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (!isNumber(raw)) return null;
    overrides[key] = raw;
  }
  const reason = value.reason;
  if (reason !== undefined) {
    if (!isString(reason)) return null;
    overrides.reason = reason;
  }
  return overrides;
}

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin
    if (!isSuperAdmin(user.id)) {
      return NextResponse.json({ error: 'Forbidden - Super admin only' }, { status: 403 });
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const eventId = isString(body.eventId) ? body.eventId : undefined;
    const action = body.action === 'clear' ? 'clear' : body.action === 'set' ? 'set' : undefined;
    const overrides = parseOverrides(body.overrides);

    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
    }

    if (!action) {
      return NextResponse.json({ error: 'action must be "set" or "clear"' }, { status: 400 });
    }

    if (overrides === null) {
      return NextResponse.json({ error: 'Invalid overrides' }, { status: 400 });
    }

    // Fetch current event
    const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Get current score override or create empty one
    const currentOverride = (event.scoreOverride as ScoreOverride | null) || {};

    let newScoreOverride: ScoreOverride;

    if (action === 'clear') {
      // Clear admin overrides but keep curator boosts
      newScoreOverride = {
        ...currentOverride,
        adminOverrides: undefined,
      };
    } else {
      // Set admin overrides
      if (!overrides || Object.keys(overrides).length === 0) {
        return NextResponse.json(
          { error: 'overrides are required for set action' },
          { status: 400 }
        );
      }

      // Validate override values
      if (overrides.rarity !== undefined && (overrides.rarity < 0 || overrides.rarity > 10)) {
        return NextResponse.json({ error: 'rarity must be 0-10' }, { status: 400 });
      }
      if (overrides.unique !== undefined && (overrides.unique < 0 || overrides.unique > 10)) {
        return NextResponse.json({ error: 'unique must be 0-10' }, { status: 400 });
      }
      if (
        overrides.magnitude !== undefined &&
        (overrides.magnitude < 0 || overrides.magnitude > 10)
      ) {
        return NextResponse.json({ error: 'magnitude must be 0-10' }, { status: 400 });
      }

      const adminOverride: AdminOverride = {
        setBy: user.id,
        setAt: new Date().toISOString(),
      };

      if (overrides.rarity !== undefined) adminOverride.rarity = overrides.rarity;
      if (overrides.unique !== undefined) adminOverride.unique = overrides.unique;
      if (overrides.magnitude !== undefined) adminOverride.magnitude = overrides.magnitude;
      if (overrides.reason) adminOverride.reason = overrides.reason;

      newScoreOverride = {
        ...currentOverride,
        adminOverrides: adminOverride,
      };
    }

    // Calculate new total score
    const aiScores = {
      rarity: event.scoreRarity ?? 0,
      unique: event.scoreUnique ?? 0,
      magnitude: event.scoreMagnitude ?? 0,
    };
    const finalScores = calculateFinalScores(aiScores, newScoreOverride);

    // Update event
    await db
      .update(events)
      .set({
        scoreOverride: newScoreOverride,
        score: finalScores.total,
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId));

    return NextResponse.json({
      success: true,
      eventId,
      scoreOverride: newScoreOverride,
      score: finalScores.total,
      finalScores,
    });
  } catch (error) {
    console.error('Error updating event score:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
