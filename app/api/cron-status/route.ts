import { NextResponse } from 'next/server';
import { getLatestJobRuns, type CronJobName, type CronJobStatus } from '@/lib/cron/jobTracker';
import { formatDistanceToNow, intervalToDuration } from 'date-fns';
import { readFileSync } from 'fs';
import { join } from 'path';

// Job display metadata (descriptions and display names)
const JOB_METADATA: Record<CronJobName, { displayName: string; description: string }> = {
  scrape: {
    displayName: 'Scraping',
    description: 'Scrapes 10+ event sources (AVL Today, Eventbrite, Meetup, etc.) and upserts to database.',
  },
  verify: {
    displayName: 'Verify',
    description: 'Fetches event source URLs via Jina Reader and uses AI to verify/update/hide events.',
  },
  ai: {
    displayName: 'AI Processing',
    description: 'Generates AI tags, summaries, embeddings, and scores for new events.',
  },
  cleanup: {
    displayName: 'Cleanup',
    description: 'Removes dead links, non-NC events, cancelled events, and duplicates.',
  },
  dedup: {
    displayName: 'AI Dedup',
    description: 'Uses AI to find semantic duplicates that rule-based dedup might miss.',
  },
  'email-digest': {
    displayName: 'Email Digest',
    description: 'Sends daily/weekly email digests to subscribed users.',
  },
};

// Read actual cron schedules from vercel.json (single source of truth)
function getCronSchedules(): Record<string, string> {
  const vercelConfigPath = join(process.cwd(), 'vercel.json');
  const vercelConfig = JSON.parse(readFileSync(vercelConfigPath, 'utf-8'));

  const schedules: Record<string, string> = {};
  for (const cron of vercelConfig.crons || []) {
    // Extract job name from path: /api/cron/scrape -> scrape
    const jobName = cron.path.split('/').pop();
    schedules[jobName] = cron.schedule;
  }

  return schedules;
}

/**
 * Parse a cron schedule and calculate the next run time
 */
function getNextRunTime(schedule: string): Date {
  const now = new Date();
  const [minute, hour] = schedule.split(' ');

  // Helper to parse cron field values
  const parseField = (field: string, max: number): number[] => {
    if (field === '*') return Array.from({ length: max + 1 }, (_, i) => i);
    if (field.includes('/')) {
      const [, step] = field.split('/');
      return Array.from({ length: Math.ceil((max + 1) / parseInt(step)) }, (_, i) => i * parseInt(step));
    }
    if (field.includes(',')) {
      return field.split(',').map(Number);
    }
    return [parseInt(field)];
  };

  const minutes = parseField(minute, 59);
  const hours = parseField(hour, 23);

  // Find the next valid time
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);

  // Try up to 48 hours ahead
  for (let i = 0; i < 48 * 60; i++) {
    const m = candidate.getMinutes();
    const h = candidate.getHours();

    if (minutes.includes(m) && hours.includes(h) && candidate > now) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  // Fallback: return 6 hours from now
  return new Date(now.getTime() + 6 * 60 * 60 * 1000);
}

/**
 * Format duration in human-readable form using date-fns
 */
function formatDuration(ms: number): string {
  const duration = intervalToDuration({ start: 0, end: ms });
  const parts: string[] = [];

  if (duration.hours) parts.push(`${duration.hours}h`);
  if (duration.minutes) parts.push(`${duration.minutes}m`);
  if (duration.seconds && !duration.hours) parts.push(`${duration.seconds}s`);

  return parts.length > 0 ? parts.join(' ') : '< 1s';
}

/**
 * Format relative time using date-fns (without "about")
 */
function formatRelativeTime(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true, includeSeconds: false })
    .replace('about ', '');
}

export interface CronJobStatusResponse {
  name: CronJobName;
  displayName: string;
  description: string;
  schedule: string;
  lastRun: {
    startedAt: string;
    startedAtRelative: string;
    status: CronJobStatus;
    durationMs: number | null;
    durationFormatted: string | null;
    result: Record<string, unknown> | null;
  } | null;
  nextRun: {
    at: string;
    atRelative: string;
  };
}

export interface CronStatusResponse {
  success: boolean;
  generatedAt: string;
  jobs: CronJobStatusResponse[];
}

export async function GET() {
  try {
    const latestRuns = await getLatestJobRuns();
    const cronSchedules = getCronSchedules();

    // Build response for each job
    const jobs: CronJobStatusResponse[] = (Object.keys(JOB_METADATA) as CronJobName[]).map((name) => {
      const metadata = JOB_METADATA[name];
      const schedule = cronSchedules[name];
      const latestRun = latestRuns.find((r) => r.jobName === name);
      const nextRunTime = getNextRunTime(schedule);

      return {
        name,
        displayName: metadata.displayName,
        description: metadata.description,
        schedule,
        lastRun: latestRun
          ? {
              startedAt: latestRun.startedAt.toISOString(),
              startedAtRelative: formatRelativeTime(latestRun.startedAt),
              status: latestRun.status,
              durationMs: latestRun.durationMs,
              durationFormatted: latestRun.durationMs ? formatDuration(latestRun.durationMs) : null,
              result: latestRun.result,
            }
          : null,
        nextRun: {
          at: nextRunTime.toISOString(),
          atRelative: formatRelativeTime(nextRunTime),
        },
      };
    });

    const response: CronStatusResponse = {
      success: true,
      generatedAt: new Date().toISOString(),
      jobs,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Cron Status] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
