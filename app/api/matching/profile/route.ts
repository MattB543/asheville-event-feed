import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { matchingProfiles, matchingAnswers, userPreferences } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isBoolean, isRecord, isString } from '@/lib/utils/validation';
import { getSafeProgram, getDefaultDisplayName, getLatestQuestions } from '@/lib/matching/utils';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const program = getSafeProgram(new URL(request.url).searchParams.get('program'));
    const { version, questions } = await getLatestQuestions(program);

    const [profile] = await db
      .select()
      .from(matchingProfiles)
      .where(eq(matchingProfiles.userId, user.id))
      .limit(1);

    const answers = profile
      ? await db.select().from(matchingAnswers).where(eq(matchingAnswers.profileId, profile.id))
      : [];

    return NextResponse.json({ profile: profile ?? null, answers, questions, version });
  } catch (error) {
    console.error('Error fetching matching profile:', error);
    return NextResponse.json({ error: 'Failed to load matching profile' }, { status: 500 });
  }
}

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

    const program = getSafeProgram(isString(parsed.program) ? parsed.program : null);
    const displayName = isString(parsed.displayName) ? parsed.displayName.trim() : undefined;

    if (displayName && displayName.length > 50) {
      return NextResponse.json(
        { error: 'Display name must be 50 characters or fewer' },
        { status: 400 }
      );
    }

    const aiMatching = isBoolean(parsed.aiMatching) ? parsed.aiMatching : undefined;
    const consentVersion = isString(parsed.consentVersion) ? parsed.consentVersion : undefined;
    const source = isString(parsed.source) ? parsed.source.trim().slice(0, 80) : undefined;

    const [existing] = await db
      .select()
      .from(matchingProfiles)
      .where(eq(matchingProfiles.userId, user.id))
      .limit(1);

    if (existing && !existing.allowEditing) {
      return NextResponse.json({ error: 'Profile editing is locked' }, { status: 403 });
    }

    const now = new Date();
    const nextDisplayName = displayName || existing?.displayName || getDefaultDisplayName(user);
    const nextAiMatching = aiMatching ?? existing?.aiMatching ?? false;
    const nextConsentAt = nextAiMatching ? (existing?.consentAt ?? now) : null;
    const nextConsentVersion = nextAiMatching
      ? consentVersion || existing?.consentVersion || null
      : null;
    const nextSource = source || existing?.source || null;

    let profile = existing ?? null;

    if (!profile) {
      const [inserted] = await db
        .insert(matchingProfiles)
        .values({
          userId: user.id,
          program,
          displayName: nextDisplayName,
          email: user.email || null,
          source: nextSource,
          aiMatching: nextAiMatching,
          consentAt: nextConsentAt,
          consentVersion: nextConsentVersion,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      profile = inserted;
    } else {
      const [updated] = await db
        .update(matchingProfiles)
        .set({
          program,
          displayName: nextDisplayName,
          email: user.email || profile.email,
          source: nextSource,
          aiMatching: nextAiMatching,
          consentAt: nextConsentAt,
          consentVersion: nextConsentVersion,
          updatedAt: now,
        })
        .where(eq(matchingProfiles.id, profile.id))
        .returning();
      profile = updated;
    }

    await db
      .insert(userPreferences)
      .values({
        userId: user.id,
        aiMatching: nextAiMatching,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          aiMatching: nextAiMatching,
          updatedAt: now,
        },
      });

    return NextResponse.json({ profile });
  } catch (error) {
    console.error('Error saving matching profile:', error);
    return NextResponse.json({ error: 'Failed to save matching profile' }, { status: 500 });
  }
}
