import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { matchingProfiles, matchingQuestions, matchingAnswers } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { isRecord, isString, isStringArray } from '@/lib/utils/validation';
import { getSafeProgram, getDefaultDisplayName } from '@/lib/matching/utils';
import type { User } from '@supabase/supabase-js';

type IncomingAnswer = {
  questionId: string;
  answerText?: string;
  answerJson?: unknown;
};

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeUrlList(values: string[]): { urls: string[] } {
  const trimmed = values.map((value) => value.trim()).filter((value) => value.length > 0);
  const urls = Array.from(new Set(trimmed.filter((value) => isValidUrl(value))));
  return { urls };
}

async function getOrCreateProfile(user: User, program: string) {
  const [existing] = await db
    .select()
    .from(matchingProfiles)
    .where(eq(matchingProfiles.userId, user.id))
    .limit(1);

  if (existing) {
    return existing;
  }

  const now = new Date();
  const displayName = getDefaultDisplayName(user);
  const [inserted] = await db
    .insert(matchingProfiles)
    .values({
      userId: user.id,
      program,
      displayName,
      email: user.email || null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return inserted;
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
    if (!isRecord(parsed) || !Array.isArray(parsed.answers)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const program = getSafeProgram(isString(parsed.program) ? parsed.program : null);
    const version = isString(parsed.version) ? parsed.version : null;
    if (!version) {
      return NextResponse.json({ error: 'Missing survey version' }, { status: 400 });
    }

    const answers = parsed.answers as IncomingAnswer[];
    if (answers.length === 0) {
      return NextResponse.json({ error: 'No answers provided' }, { status: 400 });
    }

    const questionIds = answers
      .map((answer) => (typeof answer.questionId === 'string' ? answer.questionId : ''))
      .filter((value) => value.length > 0);

    if (questionIds.length === 0) {
      return NextResponse.json({ error: 'Invalid question IDs' }, { status: 400 });
    }

    const questionRows = await db
      .select()
      .from(matchingQuestions)
      .where(
        and(
          eq(matchingQuestions.program, program),
          eq(matchingQuestions.version, version),
          eq(matchingQuestions.active, true),
          inArray(matchingQuestions.id, questionIds)
        )
      );

    const questionMap = new Map(questionRows.map((row) => [row.id, row]));

    const missingQuestions = questionIds.filter((id) => !questionMap.has(id));
    if (missingQuestions.length > 0) {
      return NextResponse.json(
        { error: 'Unknown questions', missing: missingQuestions },
        { status: 400 }
      );
    }

    const profile = await getOrCreateProfile(user, program);
    if (profile.status === 'submitted') {
      return NextResponse.json({ error: 'Profile already submitted' }, { status: 403 });
    }

    const now = new Date();

    for (const answer of answers) {
      const question = questionMap.get(answer.questionId);
      if (!question) continue;

      let answerText: string | null = null;
      let answerJson: unknown = null;
      let shouldDelete = false;

      if (question.inputType === 'long_text' || question.inputType === 'short_text') {
        const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
        if (!text) {
          shouldDelete = true;
        } else if (question.maxLength && text.length > question.maxLength) {
          return NextResponse.json(
            { error: `Answer for ${question.id} exceeds max length` },
            { status: 400 }
          );
        } else {
          answerText = text;
        }
      } else if (question.inputType === 'file_markdown') {
        const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
        const maxLen = question.maxLength || 20000;
        if (!text) {
          shouldDelete = true;
        } else if (text.length > maxLen) {
          return NextResponse.json(
            { error: `Answer for ${question.id} exceeds max length` },
            { status: 400 }
          );
        } else {
          answerText = text;
        }
      } else if (question.inputType === 'url') {
        const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
        if (!text) {
          shouldDelete = true;
        } else if (!isValidUrl(text)) {
          // Silently treat incomplete/invalid URLs as empty during draft autosave
          // so users don't see "Autosave failed" while still typing a URL
          shouldDelete = true;
        } else {
          answerText = text;
        }
      } else if (question.inputType === 'multi_url') {
        const rawList = isStringArray(answer.answerJson)
          ? answer.answerJson
          : typeof answer.answerText === 'string'
            ? answer.answerText.split(/[\n,]+/)
            : [];
        // Filter out incomplete/invalid URLs silently rather than rejecting the
        // whole request -- this prevents autosave failures while users are typing
        const { urls } = normalizeUrlList(rawList);

        if (urls.length === 0) {
          shouldDelete = true;
        } else {
          answerJson = urls;
        }
      } else {
        return NextResponse.json(
          { error: `Unsupported input type for ${question.id}` },
          { status: 400 }
        );
      }

      if (shouldDelete) {
        await db
          .delete(matchingAnswers)
          .where(
            and(
              eq(matchingAnswers.profileId, profile.id),
              eq(matchingAnswers.questionId, question.id)
            )
          );
        continue;
      }

      await db
        .insert(matchingAnswers)
        .values({
          profileId: profile.id,
          questionId: question.id,
          answerText,
          answerJson,
          updatedAt: now,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [matchingAnswers.profileId, matchingAnswers.questionId],
          set: {
            answerText,
            answerJson,
            updatedAt: now,
          },
        });
    }

    await db
      .update(matchingProfiles)
      .set({ updatedAt: now })
      .where(eq(matchingProfiles.id, profile.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving matching answers:', error);
    return NextResponse.json({ error: 'Failed to save answers' }, { status: 500 });
  }
}
