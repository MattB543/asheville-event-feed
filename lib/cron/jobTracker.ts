import { db } from '@/lib/db';
import { cronJobRuns } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';

export type CronJobName = 'scrape' | 'ai' | 'cleanup' | 'dedup' | 'email-digest' | 'verify';
export type CronJobStatus = 'running' | 'success' | 'failed';

/**
 * Start tracking a cron job run
 * @returns The run ID to use when completing the job
 */
export async function startCronJob(jobName: CronJobName): Promise<string> {
  const [run] = await db
    .insert(cronJobRuns)
    .values({
      jobName,
      status: 'running',
      startedAt: new Date(),
    })
    .returning({ id: cronJobRuns.id });

  return run.id;
}

/**
 * Mark a cron job as successfully completed
 */
export async function completeCronJob(
  runId: string,
  result?: Record<string, unknown>
): Promise<void> {
  const completedAt = new Date();

  // Get the start time to calculate duration
  const [run] = await db
    .select({ startedAt: cronJobRuns.startedAt })
    .from(cronJobRuns)
    .where(eq(cronJobRuns.id, runId));

  const durationMs = run ? completedAt.getTime() - run.startedAt.getTime() : null;

  await db
    .update(cronJobRuns)
    .set({
      status: 'success',
      completedAt,
      durationMs,
      result: result ?? null,
    })
    .where(eq(cronJobRuns.id, runId));
}

/**
 * Mark a cron job as failed
 */
export async function failCronJob(
  runId: string,
  error: unknown
): Promise<void> {
  const completedAt = new Date();

  // Get the start time to calculate duration
  const [run] = await db
    .select({ startedAt: cronJobRuns.startedAt })
    .from(cronJobRuns)
    .where(eq(cronJobRuns.id, runId));

  const durationMs = run ? completedAt.getTime() - run.startedAt.getTime() : null;

  await db
    .update(cronJobRuns)
    .set({
      status: 'failed',
      completedAt,
      durationMs,
      result: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    })
    .where(eq(cronJobRuns.id, runId));
}

/**
 * Get the latest run for each job
 */
export async function getLatestJobRuns(): Promise<
  Array<{
    jobName: CronJobName;
    status: CronJobStatus;
    startedAt: Date;
    completedAt: Date | null;
    durationMs: number | null;
    result: Record<string, unknown> | null;
  }>
> {
  const jobNames: CronJobName[] = ['scrape', 'ai', 'cleanup', 'dedup', 'email-digest', 'verify'];

  const results = await Promise.all(
    jobNames.map(async (jobName) => {
      const [latest] = await db
        .select()
        .from(cronJobRuns)
        .where(eq(cronJobRuns.jobName, jobName))
        .orderBy(desc(cronJobRuns.startedAt))
        .limit(1);

      return latest;
    })
  );

  return results
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => ({
      jobName: r.jobName as CronJobName,
      status: r.status as CronJobStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      durationMs: r.durationMs,
      result: r.result as Record<string, unknown> | null,
    }));
}

/**
 * Clean up old job runs (keep last 100 per job)
 */
export async function cleanupOldRuns(): Promise<number> {
  const jobNames: CronJobName[] = ['scrape', 'ai', 'cleanup', 'dedup', 'email-digest', 'verify'];
  let totalDeleted = 0;

  for (const jobName of jobNames) {
    // Get IDs of runs to keep (latest 100)
    const runsToKeep = await db
      .select({ id: cronJobRuns.id })
      .from(cronJobRuns)
      .where(eq(cronJobRuns.jobName, jobName))
      .orderBy(desc(cronJobRuns.startedAt))
      .limit(100);

    const keepIds = runsToKeep.map((r) => r.id);

    if (keepIds.length === 100) {
      // Only delete if we have more than 100
      const allRuns = await db
        .select({ id: cronJobRuns.id })
        .from(cronJobRuns)
        .where(eq(cronJobRuns.jobName, jobName));

      const deleteIds = allRuns
        .map((r) => r.id)
        .filter((id) => !keepIds.includes(id));

      if (deleteIds.length > 0) {
        const { sql } = await import('drizzle-orm');
        await db.delete(cronJobRuns).where(
          and(
            eq(cronJobRuns.jobName, jobName),
            sql`${cronJobRuns.id} = ANY(${deleteIds})`
          )
        );
        totalDeleted += deleteIds.length;
      }
    }
  }

  return totalDeleted;
}
