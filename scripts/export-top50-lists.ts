import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { and, or, gte, lte, asc, desc, isNull, isNotNull, sql } from 'drizzle-orm';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Inline the timezone helpers to avoid module resolution issues with tsx
function getStartOfTodayEastern(): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayEastern = formatter.format(now);
  const nowOffset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value;
  const offset = nowOffset?.includes('-4') ? '-04:00' : '-05:00';
  return new Date(`${todayEastern}T00:00:00${offset}`);
}

function getTodayStringEastern(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function getEasternOffset(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(`${dateStr}T12:00:00`) : dateStr;
  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  return offsetPart?.includes('-4') ? '-04:00' : '-05:00';
}

function parseAsEastern(dateStr: string, timeStr: string = '19:00:00'): Date {
  const offset = getEasternOffset(dateStr);
  return new Date(`${dateStr}T${timeStr}${offset}`);
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// notIlike isn't available as a standalone import in all drizzle versions,
// so use sql template for the location filter
function notIlikeSql(column: typeof events.location, pattern: string) {
  return sql`${column} NOT ILIKE ${pattern}`;
}

const LIMIT = 50;

const selectFields = {
  id: events.id,
  sourceId: events.sourceId,
  source: events.source,
  title: events.title,
  description: events.description,
  startDate: events.startDate,
  location: events.location,
  zip: events.zip,
  organizer: events.organizer,
  price: events.price,
  url: events.url,
  tags: events.tags,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
  lastSeenAt: events.lastSeenAt,
  lastVerifiedAt: events.lastVerifiedAt,
  hidden: events.hidden,
  interestedCount: events.interestedCount,
  goingCount: events.goingCount,
  timeUnknown: events.timeUnknown,
  recurringType: events.recurringType,
  recurringEndDate: events.recurringEndDate,
  favoriteCount: events.favoriteCount,
  aiSummary: events.aiSummary,
  score: events.score,
  scoreRarity: events.scoreRarity,
  scoreUnique: events.scoreUnique,
  scoreMagnitude: events.scoreMagnitude,
  scoreReason: events.scoreReason,
  scoreOverride: events.scoreOverride,
  scoreAshevilleWeird: events.scoreAshevilleWeird,
  scoreSocial: events.scoreSocial,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatEvent(event: any, rank: number): string {
  const lines: string[] = [];

  // Title with rank
  lines.push(`## #${rank} — ${event.title}`);
  lines.push('');

  // Date & Time
  const dateStr = event.startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
  if (event.timeUnknown) {
    lines.push(`**Date:** ${dateStr} *(time not specified)*`);
  } else {
    const timeStr = event.startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
    lines.push(`**Date:** ${dateStr} at ${timeStr}`);
  }

  // Location & Zip
  if (event.location) {
    const locationLine = event.zip ? `${event.location} (${event.zip})` : event.location;
    lines.push(`**Location:** ${locationLine}`);
  }

  // Organizer
  if (event.organizer) {
    lines.push(`**Organizer:** ${event.organizer}`);
  }

  // Price
  if (event.price) {
    lines.push(`**Price:** ${event.price}`);
  }

  // URL
  if (event.url) {
    lines.push(`**URL:** ${event.url}`);
  }

  // Source
  lines.push(`**Source:** ${event.source} (ID: ${event.sourceId})`);

  // Tags
  if (event.tags && event.tags.length > 0) {
    lines.push(`**Tags:** ${event.tags.join(', ')}`);
  }

  // Recurring
  if (event.recurringType) {
    const endStr = event.recurringEndDate
      ? ` until ${event.recurringEndDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
      : '';
    lines.push(`**Recurring:** ${event.recurringType}${endStr}`);
  }

  // Engagement
  const engagement: string[] = [];
  if (event.interestedCount != null && event.interestedCount > 0) {
    engagement.push(`${event.interestedCount} interested`);
  }
  if (event.goingCount != null && event.goingCount > 0) {
    engagement.push(`${event.goingCount} going`);
  }
  if (event.favoriteCount != null && event.favoriteCount > 0) {
    engagement.push(`${event.favoriteCount} favorited`);
  }
  if (engagement.length > 0) {
    lines.push(`**Engagement:** ${engagement.join(', ')}`);
  }

  lines.push('');

  // Scores
  if (event.score != null) {
    lines.push('### Scores');
    lines.push('');
    lines.push(`| Dimension | Score |`);
    lines.push(`|-----------|-------|`);
    lines.push(`| **Total** | **${event.score}/30** |`);
    lines.push(`| Rarity & Urgency | ${event.scoreRarity ?? '-'}/10 |`);
    lines.push(`| Cool & Unique | ${event.scoreUnique ?? '-'}/10 |`);
    lines.push(`| Magnitude & Caliber | ${event.scoreMagnitude ?? '-'}/10 |`);
    lines.push(`| Asheville Weird | ${event.scoreAshevilleWeird ?? '-'}/10 |`);
    lines.push(`| Social / Meet People | ${event.scoreSocial ?? '-'}/10 |`);
    lines.push('');
    if (event.scoreReason) {
      lines.push(`**Score Reasoning:** ${event.scoreReason}`);
      lines.push('');
    }
    if (event.scoreOverride) {
      lines.push(`**Score Override:** \`${JSON.stringify(event.scoreOverride)}\``);
      lines.push('');
    }
  }

  // AI Summary
  if (event.aiSummary) {
    lines.push(`**AI Summary:** ${event.aiSummary}`);
    lines.push('');
  }

  // Description
  if (event.description) {
    lines.push('<details>');
    lines.push('<summary>Full Description</summary>');
    lines.push('');
    const desc =
      event.description.length > 3000
        ? event.description.slice(0, 3000) + '...'
        : event.description;
    lines.push(desc);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // Metadata
  lines.push('<details>');
  lines.push('<summary>Metadata</summary>');
  lines.push('');
  lines.push(`- **Event ID:** ${event.id}`);
  if (event.createdAt) {
    lines.push(
      `- **Created:** ${event.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
  }
  if (event.updatedAt) {
    lines.push(
      `- **Updated:** ${event.updatedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
  }
  if (event.lastSeenAt) {
    lines.push(
      `- **Last Seen:** ${event.lastSeenAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
  }
  if (event.lastVerifiedAt) {
    lines.push(
      `- **Last Verified:** ${event.lastVerifiedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
    );
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

function buildMarkdownFile(
  title: string,
  subtitle: string,
  sortDescription: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventList: any[],
  generatedAt: Date
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> ${subtitle}`);
  lines.push('');
  lines.push(
    `*Generated: ${generatedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET*`
  );
  lines.push(`*Ranking: ${sortDescription}*`);
  lines.push(`*Events: ${eventList.length} (next 30 days, scored, non-virtual)*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  eventList.forEach((event, i) => {
    lines.push(formatEvent(event, i + 1));
  });

  return lines.join('\n');
}

async function exportTop50Lists() {
  const startOfToday = getStartOfTodayEastern();
  const todayStr = getTodayStringEastern();
  const thirtyDaysLaterStr = addDaysToDateString(todayStr, 30);
  const thirtyDaysLater = parseAsEastern(thirtyDaysLaterStr, '23:59:59');
  const now = new Date();

  console.log(`Fetching top ${LIMIT} lists...`);
  console.log(`Date range: ${todayStr} to ${thirtyDaysLaterStr}`);

  const baseWhere = and(
    gte(events.startDate, startOfToday),
    lte(events.startDate, thirtyDaysLater),
    isNotNull(events.score),
    or(isNull(events.hidden), sql`${events.hidden} = false`),
    or(
      isNull(events.location),
      and(notIlikeSql(events.location, '%online%'), notIlikeSql(events.location, '%virtual%'))
    )
  );

  // Fetch all three lists in parallel
  const [topOverall, topWeird, topSocial] = await Promise.all([
    db
      .select(selectFields)
      .from(events)
      .where(baseWhere)
      .orderBy(desc(events.score), asc(events.startDate), asc(events.id))
      .limit(LIMIT),
    db
      .select(selectFields)
      .from(events)
      .where(and(baseWhere, isNotNull(events.scoreAshevilleWeird)))
      .orderBy(desc(events.scoreAshevilleWeird), desc(events.score), asc(events.startDate))
      .limit(LIMIT),
    db
      .select(selectFields)
      .from(events)
      .where(and(baseWhere, isNotNull(events.scoreSocial)))
      .orderBy(desc(events.scoreSocial), desc(events.score), asc(events.startDate))
      .limit(LIMIT),
  ]);

  console.log(
    `Fetched: ${topOverall.length} overall, ${topWeird.length} weird, ${topSocial.length} social`
  );

  // Create output directory
  const outDir = join(process.cwd(), 'exports', 'top50');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  // Generate markdown files
  const overallMd = buildMarkdownFile(
    'Top 50 Events — Overall',
    'Ranked by total score (Rarity + Uniqueness + Magnitude)',
    'Total Score DESC, then by date ASC',
    topOverall,
    now
  );

  const weirdMd = buildMarkdownFile(
    'Top 50 Events — Asheville Weird',
    'Ranked by the "Asheville Weird" dimension — the weirder, the better',
    'Asheville Weird DESC, then Total Score DESC, then date ASC',
    topWeird,
    now
  );

  const socialMd = buildMarkdownFile(
    'Top 50 Events — Meet People',
    'Ranked by the "Social / Meet People" dimension — best for meeting new people',
    'Social Score DESC, then Total Score DESC, then date ASC',
    topSocial,
    now
  );

  // Write files
  const overallPath = join(outDir, 'top50-overall.md');
  const weirdPath = join(outDir, 'top50-weird.md');
  const socialPath = join(outDir, 'top50-social.md');

  writeFileSync(overallPath, overallMd, 'utf-8');
  writeFileSync(weirdPath, weirdMd, 'utf-8');
  writeFileSync(socialPath, socialMd, 'utf-8');

  console.log(`\nExported to ${outDir}/`);
  console.log(
    `  top50-overall.md (${(Buffer.byteLength(overallMd, 'utf-8') / 1024).toFixed(1)} KB)`
  );
  console.log(`  top50-weird.md   (${(Buffer.byteLength(weirdMd, 'utf-8') / 1024).toFixed(1)} KB)`);
  console.log(
    `  top50-social.md  (${(Buffer.byteLength(socialMd, 'utf-8') / 1024).toFixed(1)} KB)`
  );
}

exportTop50Lists()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
