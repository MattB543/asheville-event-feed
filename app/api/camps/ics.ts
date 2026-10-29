/**
 * Registration reminders as iCalendar (01 §4.4), for one camp's download and for the saved-camps
 * feed. Not lib/utils/icsGenerator.ts: that one has random UIDs, a 2-hour default and no date-only
 * events. Rules:
 *
 * - Only dates the camp has announced to the day (isRemindable): "expected mid-December" or a
 *   month alone never becomes an event, since it would invent the day (N14).
 * - A stated time is a timed event (sent in UTC, the same instant as Eastern) with two alarms: the
 *   day before and 15 minutes before.
 * - A date with no time is an all-day event titled "(time not stated)", alarmed at 9 a.m. the day
 *   before. A time is never invented.
 * - The UID is camp + season + milestone kind + audience + date (+ time, when two dates of one kind
 *   and audience fall on the same day), so a members' opening stays separate from the public one
 *   and a date that doesn't change keeps its event however the camp's other dates move. Lottery
 *   and deadline dates say so in the title.
 */

import type { Milestone } from '@/lib/camps/contract';
import {
  AI_NOTICE,
  TARGET_SEASON,
  isRemindable,
  isUnconfirmed,
  milestoneLabel,
} from '@/lib/camps/display';
import type { CampListing } from '@/lib/db/queries/camps';
import { SITE_URL } from '@/lib/seo/site';
import { parseAsEastern } from '@/lib/utils/timezone';

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 lines are at most 75 octets; longer ones continue on lines starting with a space. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75
    if (size + bytes > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** YYYYMMDD, `days` after a YYYY-MM-DD date. */
function dayValue(date: string, days = 0): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
}

function alarm(trigger: string, text: string): string[] {
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(text)}`,
    `TRIGGER:${trigger}`,
    'END:VALARM',
  ];
}

function campUrl(camp: CampListing): string {
  return `${SITE_URL}/camps/${camp.slug}`;
}

/**
 * One VEVENT per remindable registration date of a camp, out of `milestones` (the caller picks
 * which: those still ahead for a download, all of them for the feed).
 */
export function milestoneEvents(camp: CampListing, milestones: Milestone[], now: Date): string[][] {
  const { card } = camp;
  const remindable = card.registration.filter(isRemindable);
  const day = (milestone: Milestone) =>
    `${milestone.kind}-${milestone.audience}-${milestone.date.replace(/-/g, '')}`;
  const uidOf = (milestone: Milestone) => {
    // Three returning-family openings an hour apart on one day: the time tells them apart
    const shared =
      remindable.filter((other) => day(other) === day(milestone)).length > 1 && milestone.time;
    return `camp-${camp.id}-${milestone.year}-${day(milestone)}${shared ? `-${milestone.time!.replace(':', '')}` : ''}@avlgo.com`;
  };
  const emitted = new Set<string>();

  return milestones.filter(isRemindable).flatMap((milestone) => {
    const uid = uidOf(milestone);
    if (emitted.has(uid)) return [];
    emitted.add(uid);
    const label = milestoneLabel(milestone).toLowerCase();
    const timed = milestone.precision === 'datetime' && !!milestone.time;
    const summary = `${card.name}: ${label}${timed ? '' : ' (time not stated)'}`;
    const description = [
      `“${milestone.text}”`,
      isUnconfirmed(milestone, camp.confirmed) ? 'This date is not confirmed yet.' : null,
      `Registration: ${card.registration_url ?? milestone.url}`,
      `Camp on AVL GO: ${campUrl(camp)}`,
      AI_NOTICE,
    ]
      .filter(Boolean)
      .join('\n\n');

    const when = timed
      ? (() => {
          const start = parseAsEastern(milestone.date, `${milestone.time}:00`);
          return [
            `DTSTART:${utcStamp(start)}`,
            `DTEND:${utcStamp(new Date(start.getTime() + 30 * 60 * 1000))}`,
            ...alarm('-P1D', `Tomorrow: ${summary}`),
            ...alarm('-PT15M', `In 15 minutes: ${summary}`),
          ];
        })()
      : [
          `DTSTART;VALUE=DATE:${dayValue(milestone.date)}`,
          `DTEND;VALUE=DATE:${dayValue(milestone.date, 1)}`,
          // 9 a.m. the day before: 15 hours before the all-day event's midnight start
          ...alarm('-PT15H', `Tomorrow: ${summary}`),
        ];

    return [
      [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${utcStamp(now)}`,
        ...when.slice(0, 2),
        `SUMMARY:${escapeText(summary)}`,
        `DESCRIPTION:${escapeText(description)}`,
        `URL:${campUrl(camp)}`,
        'TRANSP:TRANSPARENT',
        ...when.slice(2),
        'END:VEVENT',
      ],
    ];
  });
}

/** The camp's first day, once its 2027 dates are posted. */
export function seasonStartEvent(camp: CampListing, now: Date): string[] | null {
  const { season } = camp.card;
  if (season.year !== TARGET_SEASON || !season.start) return null;
  return [
    'BEGIN:VEVENT',
    `UID:camp-${camp.id}-${season.year}-season-start@avlgo.com`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;VALUE=DATE:${dayValue(season.start)}`,
    `DTEND;VALUE=DATE:${dayValue(season.start, 1)}`,
    `SUMMARY:${escapeText(`${camp.card.name} starts`)}`,
    `DESCRIPTION:${escapeText(`Camp on AVL GO: ${campUrl(camp)}\n\n${AI_NOTICE}`)}`,
    `URL:${campUrl(camp)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

/** A whole calendar file; `refresh` marks a subscribed feed and how often to re-fetch it. */
export function calendarFile(name: string, events: string[][], refresh?: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AVL GO//avlgo.com camps//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:America/New_York',
    ...(refresh
      ? [`REFRESH-INTERVAL;VALUE=DURATION:${refresh}`, `X-PUBLISHED-TTL:${refresh}`]
      : []),
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
