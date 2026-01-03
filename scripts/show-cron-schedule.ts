#!/usr/bin/env tsx
/**
 * Display cron job schedules in a table
 * Fetches live data from the cron-status API
 *
 * Usage:
 *   npx tsx scripts/show-cron-schedule.ts
 *   npm run cron:schedule
 */

// Import types from the API
import type { CronStatusResponse } from '@/app/api/cron-status/route';
import { formatDateEastern } from '@/lib/utils/parsers';

// Convert UTC cron schedule to EST display times
function getEstTimes(schedule: string): string {
  const [, hour] = schedule.split(' ');
  const fmt = (h: number) => {
    const p = h >= 12 ? 'pm' : 'am';
    const d = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${d}${p}`;
  };

  // Helper to convert UTC hour to EST using proper timezone handling
  const utcToEst = (utcHour: number): number => {
    // Create a date with the given UTC hour (using today's date)
    // Note: Uses current date to reflect active DST offset (EST vs EDT)
    // This is intentional - shows when jobs actually run in local time right now
    const date = new Date();
    date.setUTCHours(utcHour, 0, 0, 0);

    // Format in Eastern timezone and extract the hour
    const estHourStr = formatDateEastern(date, { hour: 'numeric', hour12: false });
    return parseInt(estHourStr);
  };

  if (hour === '*/6') {
    // Every 6 hours: 0,6,12,18 UTC
    return [0, 6, 12, 18].map(h => fmt(utcToEst(h))).join(', ');
  }
  if (hour.includes(',')) {
    // Multiple specific hours
    const hours = hour.split(',').map(Number).map(utcToEst).sort((a, b) => a - b);
    return `${fmt(hours[0])}–${fmt(hours[hours.length - 1])}`;
  }
  // Single hour
  return fmt(utcToEst(parseInt(hour)));
}

// Format next run time in EST
function formatNextRun(isoString: string, relative: string): string {
  const date = new Date(isoString);

  // Use formatDateEastern for proper timezone conversion
  const estTime = formatDateEastern(date, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).toLowerCase().replace(' ', '');

  // Remove "in" and "about" for more compact display
  const cleanRelative = relative.replace('in ', '').replace('about ', '');

  return `${estTime} (${cleanRelative})`;
}

// Build MySQL-style table border
function buildBorder(columnWidths: number[]): string {
  return '+' + columnWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
}

// Format and print a table row
function printRow(values: string[], columnWidths: number[]): void {
  const cells = values.map((val, i) => ` ${val.padEnd(columnWidths[i])} `).join('|');
  console.log(`|${cells}|`);
}

async function main() {
  try {
    // Try localhost first, fall back to production
    let response: Response;
    try {
      response = await fetch('http://localhost:3000/api/cron-status');
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`Error: Local API returned ${response.status}: ${errorText}`);
        process.exit(1);
      }
    } catch (localError) {
      console.log('Local dev server not available, trying production...\n');
      response = await fetch('https://avlgo.com/api/cron-status');
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`Error: Production API returned ${response.status}: ${errorText}`);
        process.exit(1);
      }
    }

    const data: CronStatusResponse = await response.json();

    if (!data.success) {
      const errorMsg = 'error' in data ? `: ${data.error}` : '';
      console.error(`Error: API returned unsuccessful response${errorMsg}`);
      process.exit(1);
    }

    console.log('Cron Job Schedule (EST)\n');

    // Define job relationships
    const jobMeta: Record<string, { type: 'pipeline' | 'independent'; order?: number }> = {
      'Scraping': { type: 'pipeline', order: 1 },
      'Verify': { type: 'pipeline', order: 2 },
      'AI Processing': { type: 'pipeline', order: 3 },
      'Cleanup': { type: 'independent' },
      'AI Dedup': { type: 'independent' },
      'Email Digest': { type: 'independent' },
    };

    // Calculate column widths
    const columnWidths = [
      Math.max('Job'.length, ...data.jobs.map(j => j.displayName.length)),
      Math.max('Type'.length, 'Pipeline #1'.length), // "Pipeline #X" or "Independent"
      Math.max('Times (EST)'.length, ...data.jobs.map(j => getEstTimes(j.schedule).length)),
      Math.max('Next Run'.length, ...data.jobs.map(j => formatNextRun(j.nextRun.at, j.nextRun.atRelative).length)),
      Math.max('Description'.length, ...data.jobs.map(j => j.description.length)),
    ];

    const border = buildBorder(columnWidths);

    // Print header
    console.log(border);
    printRow(['Job', 'Type', 'Times (EST)', 'Next Run', 'Description'], columnWidths);
    console.log(border);

    // Print rows
    data.jobs.forEach((job) => {
      const meta = jobMeta[job.displayName];
      const typeLabel = meta?.type === 'pipeline' ? `Pipeline #${meta.order}` : 'Independent';
      const times = getEstTimes(job.schedule);
      const nextRun = formatNextRun(job.nextRun.at, job.nextRun.atRelative);
      printRow([job.displayName, typeLabel, times, nextRun, job.description], columnWidths);
    });

    console.log(border);
    console.log('\nPipeline: Jobs run sequentially every 6 hours (Scraping → Verify → AI Processing)');
    console.log('Independent: Jobs run on their own schedule, not dependent on pipeline\n');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
