import { db } from '@/lib/db';
import { matchingProfiles, matchingQuestions } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { User } from '@supabase/supabase-js';
import { DEFAULT_PROGRAM, isMatchingProgram, type MatchingProgram } from '@/lib/matching/programs';

export function getSafeProgram(value: string | null): MatchingProgram {
  const normalized = value?.trim().toLowerCase() ?? '';
  return isMatchingProgram(normalized) ? normalized : DEFAULT_PROGRAM;
}

export function getDefaultDisplayName(user: User): string {
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const fullName =
    (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
    (typeof metadata.name === 'string' && metadata.name.trim());
  if (fullName) return fullName;
  if (user.email) return user.email.split('@')[0];
  return 'AVL GO User';
}

export async function getLatestQuestions(program: MatchingProgram) {
  const rows = await db
    .select()
    .from(matchingQuestions)
    .where(and(eq(matchingQuestions.program, program), eq(matchingQuestions.active, true)))
    .orderBy(desc(matchingQuestions.version), matchingQuestions.order);

  if (rows.length === 0) {
    return { version: null as string | null, questions: [] };
  }

  const latestVersion = rows[0].version;
  const questions = rows
    .filter((row) => row.version === latestVersion)
    .sort((a, b) => a.order - b.order);

  return { version: latestVersion, questions };
}

export async function getMatchingProfileForUser(userId: string, program: MatchingProgram) {
  const [profile] = await db
    .select()
    .from(matchingProfiles)
    .where(and(eq(matchingProfiles.userId, userId), eq(matchingProfiles.program, program)))
    .limit(1);

  return profile ?? null;
}

export async function listMatchingProfilesForUser(userId: string) {
  return db
    .select()
    .from(matchingProfiles)
    .where(eq(matchingProfiles.userId, userId))
    .orderBy(desc(matchingProfiles.updatedAt));
}
