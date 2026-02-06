import { db } from '@/lib/db';
import { matchingQuestions } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { User } from '@supabase/supabase-js';

export const DEFAULT_PROGRAM = 'tedx';

export function getSafeProgram(value: string | null): string {
  return value && value.trim() ? value.trim() : DEFAULT_PROGRAM;
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

export async function getLatestQuestions(program: string) {
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
