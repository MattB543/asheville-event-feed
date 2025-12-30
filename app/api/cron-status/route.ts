import { NextResponse } from 'next/server';
import { getLatestJobRuns, type CronJobName, type CronJobStatus } from '@/lib/cron/jobTracker';

// Job descriptions and schedules
const JOB_INFO: Record<CronJobName, { description: string; schedule: string }> = {
  scrape: {
    description: 'Scrapes 10+ event sources (AVL Today, Eventbrite, Meetup, etc.) and upserts to database.',
    schedule: '0 */6 * * *', // Every 6 hours at :00
  },
  verify: {
    description: 'Fetches event source URLs via Jina Reader and uses AI to verify/update/hide events.',
    schedule: '5 */6 * * *', // Every 6 hours at :05 (after scrape)
  },
  ai: {
    description: 'Generates AI tags, summaries, embeddings, and scores for new events.',
    schedule: '20 */6 * * *', // Every 6 hours at :20 (after verify)
  },
  cleanup: {
    description: 'Removes dead links, non-NC events, cancelled events, and duplicates.',
    schedule: '30 1,4,7,10,13,16,19,22 * * *', // 8x daily
  },
  dedup: {
    description: 'Uses AI to find semantic duplicates that rule-based dedup might miss.',
    schedule: '0 10 * * *', // Daily at 5 AM ET (10:00 UTC)
  },
  'email-digest': {
    description: 'Sends daily/weekly email digests to subscribed users.',
    schedule: '0 12 * * *', // Daily at 7 AM ET (12:00 UTC)
  },
};

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
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format relative time (e.g., "2 hours ago", "in 30 minutes")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isPast = diffMs < 0;

  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let value: string;
  if (days > 0) {
    value = `${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    value = `${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    value = `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    value = 'less than a minute';
  }

  return isPast ? `${value} ago` : `in ${value}`;
}

interface CronJobStatusResponse {
  name: CronJobName;
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

export async function GET() {
  try {
    const latestRuns = await getLatestJobRuns();

    // Build response for each job
    const jobs: CronJobStatusResponse[] = (Object.keys(JOB_INFO) as CronJobName[]).map((name) => {
      const info = JOB_INFO[name];
      const latestRun = latestRuns.find((r) => r.jobName === name);
      const nextRunTime = getNextRunTime(info.schedule);

      return {
        name,
        description: info.description,
        schedule: info.schedule,
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

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      jobs,
    });
  } catch (error) {
    console.error('[Cron Status] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
