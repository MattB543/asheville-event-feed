/**
 * Shared checks for the government-calendar test scripts (test-cityofasheville.ts,
 * test-buncombecounty.ts). Each mirrors something downstream that would silently lose or mangle
 * an event: the non-NC filter, the feed's online/virtual exclusion, the url/sourceId uniqueness
 * the upsert relies on, and rule-based dedup merging two different meetings.
 */

import { isNonNCEvent } from '../../lib/utils/geo';
import { countSharedTitleWords } from '../../lib/utils/deduplication';
import { getDayBoundariesEastern, getTodayStringEastern } from '../../lib/utils/timezone';
import type { ScrapedEvent } from '../../lib/scrapers/types';

const HORIZON_DAYS = 60;

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Prints a CHECKS block and returns one line per problem (empty when the scrape looks healthy). */
export function checkEvents(events: ScrapedEvent[]): string[] {
  const problems: string[] = [];
  const add = (label: string, list: ScrapedEvent[], detail = (e: ScrapedEvent) => e.title) => {
    console.log(`  ${label.padEnd(34)}${list.length}`);
    for (const e of list) problems.push(`${label} ${detail(e)}`);
  };

  const startOfToday = getDayBoundariesEastern(getTodayStringEastern()).start;
  const horizon = new Date(startOfToday.getTime() + (HORIZON_DAYS + 1) * 86400000);
  const countBy = (key: (e: ScrapedEvent) => string) => {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
    return events.filter((e) => (counts.get(key(e)) ?? 0) > 1);
  };

  console.log('CHECKS:');
  if (events.length === 0) problems.push('No events returned');
  add(
    'Bad title or start date:',
    events.filter((e) => !e.title || isNaN(e.startDate.getTime()))
  );
  add(
    'Outside today..horizon:',
    events.filter((e) => e.startDate < startOfToday || e.startDate > horizon),
    (e) => `${e.title} @ ${e.startDate.toISOString()}`
  );
  add(
    'Dropped by isNonNCEvent:',
    events.filter((e) => isNonNCEvent(e.title, e.location))
  );
  add(
    'Hidden by feed online/virtual:',
    events.filter((e) => /online|virtual/i.test(e.location ?? '')),
    (e) => `${e.title} | ${e.location}`
  );
  add(
    'Missing location:',
    events.filter((e) => !e.location)
  );
  add(
    'Missing description:',
    events.filter((e) => !e.description)
  );
  add(
    'Duplicate URL:',
    countBy((e) => e.url),
    (e) => e.url
  );
  add(
    'Duplicate sourceId:',
    countBy((e) => e.sourceId),
    (e) => e.sourceId
  );

  // Dedup method A: same organizer (each source uses one) + same start + 2+ shared title words
  const risks: string[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const [a, b] = [events[i], events[j]];
      if (a.startDate.getTime() !== b.startDate.getTime()) continue;
      if (countSharedTitleWords(a.title, b.title) >= 2) {
        risks.push(`"${a.title}" vs "${b.title}" at ${formatDate(a.startDate)}`);
      }
    }
  }
  console.log(`  ${'Dedup would merge:'.padEnd(34)}${risks.length}`);
  problems.push(...risks.map((r) => `Dedup would merge: ${r}`));
  console.log();
  return problems;
}

/** Print the problems and exit nonzero when there are any. */
export function exitOnProblems(problems: string[]): void {
  if (problems.length === 0) {
    console.log('RESULT: no problems found');
    return;
  }
  console.error(`RESULT: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
