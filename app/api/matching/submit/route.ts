import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { matchingProfiles, matchingAnswers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isRecord, isString } from '@/lib/utils/validation';
import { getSafeProgram, getLatestQuestions, DEFAULT_PROGRAM } from '@/lib/matching/utils';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed: unknown = await request.json().catch(() => null);
    const program =
      isRecord(parsed) && isString(parsed.program)
        ? getSafeProgram(parsed.program)
        : DEFAULT_PROGRAM;

    const [profile] = await db
      .select()
      .from(matchingProfiles)
      .where(eq(matchingProfiles.userId, user.id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'No matching profile found' }, { status: 404 });
    }

    if (!profile.allowEditing && profile.status === 'submitted') {
      return NextResponse.json({ success: true, profile });
    }

    if (!profile.allowEditing) {
      return NextResponse.json({ error: 'Profile editing is locked' }, { status: 403 });
    }

    if (!profile.displayName || !profile.displayName.trim()) {
      return NextResponse.json(
        { error: 'Display name is required before submitting' },
        { status: 400 }
      );
    }

    if (!profile.aiMatching || !profile.consentAt) {
      return NextResponse.json({ error: 'Consent required before submitting' }, { status: 400 });
    }

    const { questions, version } = await getLatestQuestions(program);
    if (!version) {
      return NextResponse.json({ error: 'No active questions found' }, { status: 400 });
    }

    const answers = await db
      .select()
      .from(matchingAnswers)
      .where(eq(matchingAnswers.profileId, profile.id));

    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));
    const missingRequired: string[] = [];
    let answeredSurveyCount = 0;

    for (const question of questions) {
      const answer = answerMap.get(question.id);
      const hasAnswer = (() => {
        if (!answer) return false;

        if (question.inputType === 'multi_url' || question.inputType === 'multi_text') {
          const list = Array.isArray(answer.answerJson) ? answer.answerJson : [];
          return list.length > 0;
        }

        const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
        return text.length > 0;
      })();

      if (question.section === 'survey' && hasAnswer) {
        answeredSurveyCount += 1;
      }

      if (!question.required) continue;
      if (!hasAnswer) {
        missingRequired.push(question.id);
      }
    }

    if (missingRequired.length > 0) {
      return NextResponse.json(
        { error: 'Missing required answers', missing: missingRequired },
        { status: 400 }
      );
    }

    if (answeredSurveyCount < 1) {
      return NextResponse.json(
        { error: 'Please answer at least one question before submitting' },
        { status: 400 }
      );
    }

    const now = new Date();
    const [updated] = await db
      .update(matchingProfiles)
      .set({
        status: 'submitted',
        submittedAt: profile.submittedAt || now,
        updatedAt: now,
        consentVersion: profile.consentVersion || version,
      })
      .where(eq(matchingProfiles.id, profile.id))
      .returning();

    return NextResponse.json({ success: true, profile: updated });
  } catch (error) {
    console.error('Error submitting matching profile:', error);
    return NextResponse.json({ error: 'Failed to submit profile' }, { status: 500 });
  }
}
