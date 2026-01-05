import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateCuratorProfile,
  getUserCurations,
  addCuration,
  removeCuration,
  isUserVerifiedCurator,
} from '@/lib/supabase/curatorProfile';
import { isRecord, isString, isNumber } from '@/lib/utils/validation';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { db } from '@/lib/db';
import { events, curatedEvents } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import {
  type ScoreOverride,
  type CuratorBoost,
  calculateFinalScores,
} from '@/lib/utils/scoreCalculation';

interface ScoreBoostInput {
  rarity?: number;
  unique?: number;
  magnitude?: number;
}

// GET - Get current user's curations and boost permission
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [curations, isVerified] = await Promise.all([
      getUserCurations(user.id),
      isUserVerifiedCurator(user.id),
    ]);
    const isAdmin = isSuperAdmin(user.id);
    const canBoostScore = isVerified || isAdmin;

    return NextResponse.json({ curations, canBoostScore });
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
    const scoreBoost = isRecord(parsed.scoreBoost)
      ? (parsed.scoreBoost as ScoreBoostInput)
      : undefined;

    if (!eventId || !action) {
      return NextResponse.json({ error: 'Missing eventId or action' }, { status: 400 });
    }

    // Ensure curator profile exists
    await getOrCreateCuratorProfile(user.id, user.email || '');

    if (action === 'add') {
      await addCuration(user.id, eventId, note);

      // Handle score boost if provided
      if (scoreBoost) {
        await handleScoreBoost(user.id, eventId, scoreBoost);
      }

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

// Handle score boost for verified curators and super admin
async function handleScoreBoost(
  userId: string,
  eventId: string,
  scoreBoost: ScoreBoostInput
): Promise<void> {
  // Check if user can boost scores
  const isVerified = await isUserVerifiedCurator(userId);
  const isAdmin = isSuperAdmin(userId);

  if (!isVerified && !isAdmin) {
    // Silently ignore boost from non-verified users
    return;
  }

  // Validate boost values (-2 to +2)
  const rarity = isNumber(scoreBoost.rarity)
    ? Math.max(-2, Math.min(2, scoreBoost.rarity))
    : undefined;
  const unique = isNumber(scoreBoost.unique)
    ? Math.max(-2, Math.min(2, scoreBoost.unique))
    : undefined;
  const magnitude = isNumber(scoreBoost.magnitude)
    ? Math.max(-2, Math.min(2, scoreBoost.magnitude))
    : undefined;

  // Skip if all zeros or undefined
  if (!rarity && !unique && !magnitude) {
    return;
  }

  // Store boost in curatedEvents table
  await db
    .update(curatedEvents)
    .set({
      scoreBoost: { rarity, unique, magnitude },
    })
    .where(and(eq(curatedEvents.userId, userId), eq(curatedEvents.eventId, eventId)));

  // Update events.scoreOverride.curatorBoosts array
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);

  if (!event) return;

  const currentOverride = (event.scoreOverride as ScoreOverride | null) || {};
  const curatorBoosts = currentOverride.curatorBoosts || [];

  // Find existing boost from this curator
  const existingIndex = curatorBoosts.findIndex((b) => b.curatorId === userId);

  const newBoost: CuratorBoost = {
    curatorId: userId,
    rarity,
    unique,
    magnitude,
    boostedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    // Update existing boost
    curatorBoosts[existingIndex] = newBoost;
  } else {
    // Add new boost
    curatorBoosts.push(newBoost);
  }

  const newScoreOverride: ScoreOverride = {
    ...currentOverride,
    curatorBoosts,
  };

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
}
