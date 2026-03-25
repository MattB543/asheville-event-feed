import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { matchingProfiles, matchingQuestions, matchingAnswers } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { isRecord, isString, isStringArray } from '@/lib/utils/validation';
import { parseMatchingQuestionConfig } from '@/lib/matching/questions';
import {
  getSafeProgram,
  getDefaultDisplayName,
  getMatchingProfileForUser,
} from '@/lib/matching/utils';
import type { MatchingProgram } from '@/lib/matching/programs';
import type { User } from '@supabase/supabase-js';
import { toAbsoluteUrl } from '@/lib/matching/pipeline/source';

type IncomingAnswer = {
  questionId: string;
  answerText?: string;
  answerJson?: unknown;
};

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function normalizeUrlValue(value: string): string | null {
  return toAbsoluteUrl(value.trim());
}

function normalizeUrlList(values: string[]): { urls: string[] } {
  const urls = Array.from(
    new Set(
      values
        .map((value) => normalizeUrlValue(value))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );
  return { urls };
}

function normalizeTextList(values: string[], maxLength: number): { items: string[] } {
  const items = Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => value.slice(0, maxLength))
    )
  );
  return { items };
}

function normalizeChoiceList(
  values: string[],
  allowedValues: Set<string>,
  maxItems: number
): { items: string[] } {
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || !allowedValues.has(normalized) || deduped.includes(normalized)) {
      continue;
    }

    deduped.push(normalized);
    if (deduped.length >= maxItems) break;
  }

  return { items: deduped };
}

async function getOrCreateProfile(user: User, program: MatchingProgram) {
  const existing = await getMatchingProfileForUser(user.id, program);

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
    if (questionRows.length === 0) {
      return NextResponse.json(
        { error: 'Unknown questions', missing: missingQuestions },
        { status: 400 }
      );
    }

    const validQuestionIds = questionRows.map((row) => row.id);

    const profile = await getOrCreateProfile(user, program);
    if (!profile.allowEditing) {
      return NextResponse.json({ error: 'Profile editing is locked' }, { status: 403 });
    }

    const now = new Date();
    const existingAnswers = await db
      .select()
      .from(matchingAnswers)
      .where(
        and(
          eq(matchingAnswers.profileId, profile.id),
          inArray(matchingAnswers.questionId, validQuestionIds)
        )
      );
    const existingByQuestionId = new Map(existingAnswers.map((row) => [row.questionId, row]));

    // Default max item counts by input type
    const MAX_ITEMS_BY_TYPE: Record<string, (questionId: string) => number> = {
      multi_url: (questionId) => (questionId.includes('links_about_you') ? 5 : 10),
      multi_text: (questionId) => (questionId.includes('links_about_topics') ? 10 : 20),
    };

    await db.transaction(async (tx) => {
      let changedAny = false;

      for (const answer of answers) {
        const question = questionMap.get(answer.questionId);
        if (!question) continue;
        const existing = existingByQuestionId.get(question.id);
        const config = parseMatchingQuestionConfig(question.configJson);

        let answerText: string | null = null;
        let answerJson: unknown = null;
        let shouldDelete = false;

        if (question.inputType === 'long_text' || question.inputType === 'short_text') {
          const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
          if (!text) {
            shouldDelete = true;
          } else if (question.maxLength && text.length > question.maxLength) {
            throw new ValidationError(`Answer for ${question.id} exceeds max length`);
          } else {
            answerText = text;
          }
        } else if (question.inputType === 'file_markdown') {
          const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
          const maxLen = question.maxLength || 20000;
          if (!text) {
            shouldDelete = true;
          } else if (text.length > maxLen) {
            throw new ValidationError(`Answer for ${question.id} exceeds max length`);
          } else {
            answerText = text;
          }
        } else if (question.inputType === 'url') {
          const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
          const normalizedUrl = normalizeUrlValue(text);
          if (!text) {
            shouldDelete = true;
          } else if (!normalizedUrl) {
            // Silently treat incomplete/invalid URLs as empty during draft autosave.
            // Bare domains like github.com/user are normalized to https://... instead.
            shouldDelete = true;
          } else {
            answerText = normalizedUrl;
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
          const maxItems = MAX_ITEMS_BY_TYPE[question.inputType]?.(question.id) ?? 10;
          const limitedUrls = urls.slice(0, maxItems);

          if (limitedUrls.length === 0) {
            shouldDelete = true;
          } else {
            answerJson = limitedUrls;
          }
        } else if (question.inputType === 'multi_text') {
          const rawList = isStringArray(answer.answerJson)
            ? answer.answerJson
            : typeof answer.answerText === 'string'
              ? answer.answerText.split(/\n+/)
              : [];
          const itemMaxLength = question.maxLength || 300;
          const { items } = normalizeTextList(rawList, itemMaxLength);
          const maxItems = MAX_ITEMS_BY_TYPE[question.inputType]?.(question.id) ?? 20;
          const limitedItems = items.slice(0, maxItems);

          if (limitedItems.length === 0) {
            shouldDelete = true;
          } else {
            answerJson = limitedItems;
          }
        } else if (question.inputType === 'single_select') {
          const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
          const allowedValues = new Set(config.options?.map((option) => option.value) ?? []);

          if (!text) {
            shouldDelete = true;
          } else if (allowedValues.size > 0 && !allowedValues.has(text)) {
            throw new ValidationError(`Answer for ${question.id} is not a valid option`);
          } else {
            answerText = text;
          }
        } else if (question.inputType === 'multi_select' || question.inputType === 'ranking') {
          const rawList = isStringArray(answer.answerJson)
            ? answer.answerJson
            : typeof answer.answerText === 'string'
              ? answer.answerText.split(/\n+/)
              : [];
          const allowedValues = new Set(config.options?.map((option) => option.value) ?? []);
          if (allowedValues.size === 0) {
            throw new ValidationError(`Question ${question.id} is missing selectable options`);
          }

          const maxItems =
            config.maxSelections ?? (question.inputType === 'ranking' ? 3 : allowedValues.size);
          const { items } = normalizeChoiceList(rawList, allowedValues, maxItems);

          if (items.length === 0) {
            shouldDelete = true;
          } else {
            answerJson = items;
          }
        } else if (question.inputType === 'multi_image') {
          // multi_image stores the AI-transcribed book list as answerJson
          // (array of strings like "Title - Author")
          const rawList = isStringArray(answer.answerJson) ? answer.answerJson : [];
          const items = rawList.map((value) => value.trim()).filter((value) => value.length > 0);

          if (items.length === 0) {
            shouldDelete = true;
          } else {
            answerJson = items;
          }
        } else if (question.inputType === 'slider') {
          const text = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
          const sliderMin = config.sliderMin ?? 0;
          const sliderMax = config.sliderMax ?? 10;
          const sliderStep = config.sliderStep ?? 1;

          if (!text) {
            shouldDelete = true;
          } else {
            const numericValue = Number(text);
            const stepsFromMin = (numericValue - sliderMin) / sliderStep;

            if (!Number.isFinite(numericValue)) {
              throw new ValidationError(`Answer for ${question.id} must be numeric`);
            }
            if (numericValue < sliderMin || numericValue > sliderMax) {
              throw new ValidationError(`Answer for ${question.id} is out of range`);
            }
            if (!Number.isInteger(stepsFromMin)) {
              throw new ValidationError(`Answer for ${question.id} does not match slider step`);
            }

            answerText = String(numericValue);
          }
        } else {
          throw new ValidationError(`Unsupported input type for ${question.id}`);
        }

        if (shouldDelete) {
          if (existing) {
            await tx
              .delete(matchingAnswers)
              .where(
                and(
                  eq(matchingAnswers.profileId, profile.id),
                  eq(matchingAnswers.questionId, question.id)
                )
              );
            changedAny = true;
          }
          continue;
        }

        const sameText = (existing?.answerText ?? null) === answerText;
        const sameJson =
          JSON.stringify(existing?.answerJson ?? null) === JSON.stringify(answerJson ?? null);
        if (existing && sameText && sameJson) {
          continue;
        }

        await tx
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

        changedAny = true;
      }

      if (changedAny) {
        await tx
          .update(matchingProfiles)
          .set({ updatedAt: now })
          .where(eq(matchingProfiles.id, profile.id));
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error saving matching answers:', error);
    return NextResponse.json({ error: 'Failed to save answers' }, { status: 500 });
  }
}
