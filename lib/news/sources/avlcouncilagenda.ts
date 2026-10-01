/**
 * Asheville City Council agendas - what council will vote on, and what it did.
 *
 * Emits one article per council meeting in a window around today:
 *  - Upcoming meetings: the City Clerk's "Draft Council 8-Week Planning
 *    Calendar", a public Google Doc linked from the agenda page and updated
 *    every Tuesday. It lists consent items, public hearings and new business
 *    per meeting date, weeks before the formal agenda exists - the most
 *    forward-looking civic signal in the city. Once the clerk attaches the
 *    formal agenda doc to the meeting, that replaces the draft.
 *  - Past meetings: the "Action Agenda" Google Doc attached to the meeting
 *    record, which records every resolution and how it was decided.
 *
 * Meeting records come from the city's WordPress `meetings` post type (ACF
 * fields carry the date and the agenda doc link). Google Docs are read with
 * the public `export?format=txt` endpoint (robots.txt allows /document).
 *
 * Agendas are forward-dated and rewritten in place, unlike articles: sourceId
 * is stable per meeting (`council-2026-10-13-agenda`) so a re-scrape updates
 * rather than duplicates, and `publishedAt` is when the current version was
 * posted, never the (future) meeting date.
 */

import type { NewsSourceModule, ScrapedArticle } from '../types';
import { canonicalizeUrl, fetchNewsText } from '../feeds';
import { decodeHtmlEntities } from '../../utils/parsers';
import { HttpResponseError, isTransientStatus } from '../../utils/retry';
import { parseAsEastern } from '../../utils/timezone';

const SITE = 'https://www.ashevillenc.gov';
const AGENDA_PAGE = `${SITE}/government/city-council-agenda/`;
const COUNCIL_CATEGORY_ID = '1417';
const LABEL = 'AvlCouncilAgenda';
const SOURCE = 'AVL_COUNCIL_AGENDA';

const LOOKBACK_DAYS = 14;
const LOOKAHEAD_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_GAP_MS = 1000;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** Google Docs' txt export starts with a byte-order mark. */
const BOM = new RegExp('^\\uFEFF');

const DATE_HEADING = new RegExp(`^(${MONTHS.join('|')})\\s+(\\d{1,2}),\\s+(\\d{4})$`);

/** Header paragraphs every action agenda repeats. */
const ACTION_AGENDA_BOILERPLATE = [
  /^City of Asheville Logo$/i,
  /^The action agenda is intended/i,
  /^This Action Agenda Is For Information Only/i,
  /^Please call the City Clerk/i,
];

interface MeetingPost {
  id: number;
  link: string;
  title: { rendered: string };
  acf?: {
    meeting_date?: string;
    meeting_agenda?: string;
  };
}

interface Meeting {
  /** YYYY-MM-DD, Eastern. */
  day: string;
  start: Date;
  link: string;
  agendaDocId?: string;
}

interface AgendaSection {
  heading: string;
  items: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string, accept: string): Promise<string> {
  return fetchNewsText(url, LABEL, { Accept: accept });
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function shortDate(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function googleDocId(link: string | undefined): string | undefined {
  return link?.match(/docs\.google\.com\/document\/d\/([\w-]+)/)?.[1];
}

function docExportUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/export?format=txt`;
}

function docViewUrl(id: string): string {
  return `https://docs.google.com/document/d/${id}/edit`;
}

/**
 * Regular and special council business meetings. Agenda briefings, closed
 * sessions and cancelled meetings never carry an agenda of their own.
 */
function isBusinessMeeting(title: string): boolean {
  return (
    /City Council (Meeting|Work ?Session)/i.test(title) &&
    !/closed session|canceled|cancelled|agenda briefing/i.test(title)
  );
}

async function fetchMeetings(): Promise<Meeting[]> {
  const query = new URLSearchParams({
    meeting_categories: COUNCIL_CATEGORY_ID,
    per_page: '100',
    _fields: 'id,link,title,acf',
  });
  const posts = JSON.parse(
    await fetchText(`${SITE}/wp-json/wp/v2/meetings?${query}`, 'application/json')
  ) as MeetingPost[];
  const meetings: Meeting[] = [];
  for (const post of posts) {
    const title = decodeHtmlEntities(post.title.rendered);
    const when = post.acf?.meeting_date?.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
    if (!when || !isBusinessMeeting(title)) continue;
    meetings.push({
      day: when[1],
      start: parseAsEastern(when[1], when[2]),
      link: canonicalizeUrl(post.link),
      agendaDocId: googleDocId(post.acf?.meeting_agenda),
    });
  }
  return meetings;
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Resolve an "M-D" shorthand to the next such date on or after `from`. */
function nearestDay(month: number, day: number, from: Date): string {
  const year = from.getUTCFullYear();
  for (const y of [year, year + 1]) {
    const candidate = `${y}-${pad(month)}-${pad(day)}`;
    if (parseAsEastern(candidate, '23:59:59').getTime() >= from.getTime()) return candidate;
  }
  return `${year + 1}-${pad(month)}-${pad(day)}`;
}

/**
 * The draft calendar is a plain-text list: a date heading per meeting, then
 * "* Consent" / "* Public Hearing" style section bullets with numbered items
 * (long items wrap onto unnumbered lines). A trailing "Upcoming Agenda items"
 * block holds further-out items prefixed "12-8-".
 */
export function parseDraftCalendar(text: string, now: Date): Map<string, AgendaSection[]> {
  const meetings = new Map<string, AgendaSection[]>();
  let sections: AgendaSection[] | null = null;
  let section: AgendaSection | null = null;
  let inUpcoming = false;

  for (const raw of text.replace(BOM, '').split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line) continue;

    if (/^_{4,}$/.test(line)) {
      sections = null;
      section = null;
      continue;
    }
    if (/^Upcoming Agenda items/i.test(line)) {
      inUpcoming = true;
      sections = null;
      section = null;
      continue;
    }

    const heading = line.match(DATE_HEADING);
    if (heading) {
      const day = `${heading[3]}-${pad(MONTHS.indexOf(heading[1]) + 1)}-${pad(Number(heading[2]))}`;
      sections = [];
      section = null;
      inUpcoming = false;
      meetings.set(day, sections);
      continue;
    }

    if (inUpcoming) {
      const upcoming = line.match(/^(\d{1,2})-(\d{1,2})-\s*(.+?);?$/);
      if (upcoming) {
        const day = nearestDay(
          Number(upcoming[1]),
          Number(upcoming[2]),
          new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)
        );
        const target = meetings.get(day) ?? [];
        meetings.set(day, target);
        let bucket = target.find((s) => s.heading === 'Upcoming');
        if (!bucket) {
          bucket = { heading: 'Upcoming', items: [] };
          target.push(bucket);
        }
        bucket.items.push(upcoming[3]);
      }
      continue;
    }

    if (!sections) continue;

    const bullet = line.match(/^\*\s*(.+)$/);
    if (bullet) {
      section = { heading: bullet[1], items: [] };
      sections.push(section);
      continue;
    }

    const item = line.match(/^\d+\.\s*(.+)$/);
    if (item && section) {
      section.items.push(item[1]);
    } else if (section?.items.length) {
      section.items[section.items.length - 1] += ` ${line}`;
    }
  }

  for (const [day, parsed] of meetings) {
    const kept = parsed.filter((s) => s.items.length > 0);
    if (kept.length === 0 || parsed.some((s) => /^no meeting/i.test(s.heading)))
      meetings.delete(day);
    else meetings.set(day, kept);
  }
  return meetings;
}

function renderSections(sections: AgendaSection[]): string {
  return sections
    .map((s) => `${s.heading}:\n${s.items.map((i) => `- ${i}`).join('\n')}`)
    .join('\n\n');
}

/** Lead with the items that make news; consent items are mostly routine contracts. */
function summarizeSections(day: string, sections: AgendaSection[]): string {
  const ranked = [...sections].sort(
    (a, b) => Number(/consent/i.test(a.heading)) - Number(/consent/i.test(b.heading))
  );
  const highlights = ranked
    .flatMap((s) => s.items.map((i) => i.replace(/^Tentative\s*-\s*/i, '')))
    .slice(0, 3);
  const count = sections.reduce((n, s) => n + s.items.length, 0);
  return `${count} item${count === 1 ? '' : 's'} tentatively scheduled for the ${longDate(day)} meeting, including: ${highlights.join('; ')}.`;
}

/** Google Docs text export -> plain text, minus the action agenda's standing header. */
function cleanDocText(text: string): string {
  return text
    .replace(BOM, '')
    .split(/\r?\n/)
    .map((line) => cleanLine(line).replace(/^\*\s+/, '- '))
    .filter(
      (line) => !/^_{4,}$/.test(line) && !ACTION_AGENDA_BOILERPLATE.some((re) => re.test(line))
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstDecisions(text: string): string | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^Summary\/Action:?$/i.test(l));
  const decisions = lines.slice(start + 1).filter((l) => l && !l.startsWith('- '));
  if (!decisions.length) return undefined;
  // Long items wrap across lines in the export, so count nothing - just quote the first two.
  const first = decisions.slice(0, 2).map((d) => (d.length > 160 ? `${d.slice(0, 157)}...` : d));
  return `Council actions include: ${first.join('; ')}`;
}

function pageModified(html: string): Date | undefined {
  const value =
    html.match(/"dateModified":"([^"]+)"/)?.[1] ||
    html.match(/article:modified_time"\s+content="([^"]+)"/)?.[1];
  const date = value ? new Date(value) : undefined;
  return date && !isNaN(date.getTime()) ? date : undefined;
}

function draftCalendarDocId(html: string): string | undefined {
  const anchor = [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].find(
    ([, , inner]) => /8-week/i.test(inner)
  );
  return googleDocId(anchor?.[1]);
}

const avlCouncilAgenda: NewsSourceModule = {
  key: SOURCE,
  name: 'Asheville City Council Agendas',
  homepage: AGENDA_PAGE,
  kind: 'government',
  method: 'wp-json',
  async scrape({ deadline }) {
    const now = new Date();
    const from = now.getTime() - LOOKBACK_DAYS * DAY_MS;
    const to = now.getTime() + LOOKAHEAD_DAYS * DAY_MS;

    const meetings = (await fetchMeetings()).filter(
      (m) => m.start.getTime() >= from && m.start.getTime() <= to
    );
    const byDay = new Map(meetings.map((m) => [m.day, m]));
    await sleep(REQUEST_GAP_MS);

    const agendaPage = await fetchText(AGENDA_PAGE, 'text/html');
    const posted = pageModified(agendaPage);
    const postedAt = posted && posted.getTime() <= now.getTime() ? posted : now;

    const articles: ScrapedArticle[] = [];
    const covered = new Set<string>();

    // Meetings whose own agenda doc is attached: action agenda once held, formal agenda before.
    for (const meeting of meetings) {
      if (Date.now() > deadline) return articles;
      if (!meeting.agendaDocId) continue;
      let text: string;
      try {
        text = cleanDocText(await fetchText(docExportUrl(meeting.agendaDocId), 'text/plain'));
      } catch (error) {
        // A private or deleted doc (4xx) leaves the meeting to the draft calendar. A
        // transient failure skips it this run instead: the draft shares the formal
        // agenda's URL, so falling back to it would flip the stored article back and forth.
        if (!(error instanceof HttpResponseError) || isTransientStatus(error.status))
          covered.add(meeting.day);
        continue;
      }
      if (!text) continue;
      const held = meeting.start.getTime() <= now.getTime();
      const isActionAgenda = /Action Agenda/i.test(text.slice(0, 300));
      covered.add(meeting.day);
      articles.push({
        source: SOURCE,
        sourceId: `council-${meeting.day}-${isActionAgenda ? 'actions' : 'agenda'}`,
        url: isActionAgenda ? docViewUrl(meeting.agendaDocId) : meeting.link,
        title: isActionAgenda
          ? `Asheville City Council - ${shortDate(meeting.day)} action agenda`
          : `Asheville City Council - ${shortDate(meeting.day)} agenda`,
        publishedAt: held ? meeting.start : postedAt,
        summary: isActionAgenda
          ? firstDecisions(text)
          : `Formal agenda for the ${longDate(meeting.day)} Asheville City Council meeting.`,
        contentText: text,
        categories: ['City Council', isActionAgenda ? 'Action Agenda' : 'Agenda'],
      });
      await sleep(REQUEST_GAP_MS);
    }

    if (Date.now() > deadline) return articles;
    const draftDocId = draftCalendarDocId(agendaPage);
    if (!draftDocId) {
      console.warn(`[${LABEL}] Draft 8-week calendar link not found on ${AGENDA_PAGE}`);
      return articles;
    }
    const draft = parseDraftCalendar(await fetchText(docExportUrl(draftDocId), 'text/plain'), now);

    for (const [day, sections] of draft) {
      const meeting = byDay.get(day);
      // Past dates are covered by the action agenda; unknown dates have no page to link to.
      if (!meeting || covered.has(day) || meeting.start.getTime() < now.getTime()) continue;
      articles.push({
        source: SOURCE,
        sourceId: `council-${day}-agenda`,
        url: meeting.link,
        title: `Asheville City Council - ${shortDate(day)} agenda (draft)`,
        publishedAt: postedAt,
        summary: summarizeSections(day, sections),
        contentText: `Draft agenda items for the ${longDate(day)} Asheville City Council meeting (City Clerk's 8-week planning calendar; items marked Tentative may move).\n\n${renderSections(sections)}`,
        categories: ['City Council', 'Draft Agenda'],
      });
    }

    return articles.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  },
};

export default avlCouncilAgenda;
