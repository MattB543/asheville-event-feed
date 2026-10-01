/**
 * Buncombe County Board of Commissioners agendas, from the county's CivicClerk
 * portal (buncombeconc.portal.civicclerk.com).
 *
 * CivicClerk's public OData API returns the full agenda tree as JSON - section
 * headings (CONSENT, PUBLIC HEARINGS, NEW BUSINESS...) with numbered items -
 * so each meeting becomes one article whose body is the item list. Agendas
 * are posted the Wednesday before a meeting; meetings with nothing published
 * yet are skipped. Unlike buncombenc.gov itself, the API host is not behind
 * Cloudflare and plain fetch works.
 *
 * sourceId is stable per meeting (`boc-3613`), so a re-posted agenda updates
 * the same article.
 */

import type { NewsSourceModule, ScrapedArticle } from '../types';
import { NEWS_USER_AGENT } from '../feeds';
import { fetchWithRetry } from '../../utils/retry';
import { decodeHtmlEntities } from '../../utils/parsers';
import { parseAsEastern } from '../../utils/timezone';

const API = 'https://buncombeconc.api.civicclerk.com/v1';
const PORTAL = 'https://buncombeconc.portal.civicclerk.com';
const LABEL = 'BuncombeCommission';
const SOURCE = 'BUNCOMBE_COMMISSION_AGENDA';

const LOOKBACK_DAYS = 14;
const LOOKAHEAD_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_GAP_MS = 1000;
/** The Meetings payload is ~140KB of agenda tree and has taken 3-20s to arrive. */
const API_TIMEOUT_MS = 45_000;

/** Procedural items that never make news. */
const ROUTINE_ITEM = /^Approval of .*minutes$/i;

interface CivicClerkFile {
  type: string;
  /** Eastern wall-clock time despite the trailing Z. */
  publishOn: string;
}

interface CivicClerkEvent {
  id: number;
  eventName: string;
  startDateTime: string;
  agendaId: number;
  agendaName?: string;
  categoryName?: string;
  eventLocation?: { address1?: string; address2?: string; city?: string };
  publishedFiles?: CivicClerkFile[];
}

interface CivicClerkItem {
  agendaObjectItemOutlineNumber?: string;
  agendaObjectItemName?: string;
  agendaObjectItemDescription?: string | null;
  isSection?: number;
  childItems?: CivicClerkItem[];
}

interface CivicClerkMeeting {
  items?: CivicClerkItem[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetchWithRetry directly: fetchEventData does not expose the per-request timeout. */
async function fetchJson<T>(url: string): Promise<T> {
  try {
    const res = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': NEWS_USER_AGENT, Accept: 'application/json' } },
      { timeoutMs: API_TIMEOUT_MS }
    );
    return (await res.json()) as T;
  } catch (error) {
    console.error(`[${LABEL}] Fetch failed for ${url}:`, error);
    throw error;
  }
}

function easternWallClock(value: string): Date | undefined {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return match ? parseAsEastern(match[1], match[2]) : undefined;
}

function formatDay(date: Date, month: 'short' | 'long'): string {
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month,
    day: 'numeric',
    ...(month === 'long' ? { year: 'numeric' } : {}),
  });
}

function itemText(item: CivicClerkItem): string {
  const name = decodeHtmlEntities(item.agendaObjectItemName ?? '');
  const description = decodeHtmlEntities(item.agendaObjectItemDescription ?? '');
  return description ? `${name} - ${description}` : name;
}

/** Agenda tree -> "SECTION:\n1. item" blocks, dropping empty sections and minutes approvals. */
function renderAgenda(items: CivicClerkItem[]): { text: string; highlights: string[] } {
  const blocks: string[] = [];
  const highlights: string[] = [];
  for (const item of items) {
    const children = (item.childItems ?? [])
      .map(itemText)
      .filter((t) => t && !ROUTINE_ITEM.test(t));
    const heading = itemText(item);
    if (children.length === 0) {
      // Standing headings (CALL TO ORDER, PUBLIC COMMENT) carry nothing on their own.
      if (!item.isSection && heading) blocks.push(heading);
      continue;
    }
    blocks.push(`${heading}:\n${children.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);
    if (!/consent|presentation|proclamation|appointment/i.test(heading))
      highlights.push(...children);
  }
  return { text: blocks.join('\n\n'), highlights };
}

function toArticle(
  event: CivicClerkEvent,
  meeting: CivicClerkMeeting,
  now: Date
): ScrapedArticle | null {
  const start = new Date(event.startDateTime);
  const { text, highlights } = renderAgenda(meeting.items ?? []);
  if (!text) return null;

  const agendaFile = event.publishedFiles?.find((f) => f.type === 'Agenda');
  const posted = agendaFile ? easternWallClock(agendaFile.publishOn) : undefined;
  const publishedAt = posted && posted.getTime() <= now.getTime() ? posted : now;

  const isBriefing = /briefing/i.test(event.eventName);
  const kind = isBriefing ? 'briefing agenda' : 'agenda';
  const where = [event.eventLocation?.address1, event.eventLocation?.address2]
    .filter(Boolean)
    .join(', ');
  const when = start.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return {
    source: SOURCE,
    sourceId: `boc-${event.id}`,
    url: `${PORTAL}/event/${event.id}/overview`,
    title: `Buncombe County Commissioners - ${formatDay(start, 'short')} ${kind}`,
    publishedAt,
    summary: highlights.length
      ? `Items before the Buncombe County Board of Commissioners on ${formatDay(start, 'long')} include: ${highlights.slice(0, 3).join('; ')}.`
      : `${isBriefing ? 'Briefing' : 'Meeting'} agenda for the Buncombe County Board of Commissioners on ${formatDay(start, 'long')}.`,
    contentText: `${event.eventName} - ${when}${where ? `, ${where}` : ''}\n\n${text}`,
    categories: [
      event.categoryName || 'Board of Commissioners',
      isBriefing ? 'Briefing' : 'Agenda',
    ],
  };
}

const buncombeCommission: NewsSourceModule = {
  key: SOURCE,
  name: 'Buncombe County Commission Agendas',
  homepage: PORTAL,
  kind: 'government',
  method: 'api',
  async scrape() {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)
      .toISOString()
      .replace(/\.\d+Z$/, 'Z');
    const to = new Date(now.getTime() + LOOKAHEAD_DAYS * DAY_MS)
      .toISOString()
      .replace(/\.\d+Z$/, 'Z');
    const query = new URLSearchParams({
      $filter: `startDateTime ge ${from} and startDateTime le ${to}`,
      $orderby: 'startDateTime',
      $top: '50',
    });
    const { value: events } = await fetchJson<{ value: CivicClerkEvent[] }>(
      `${API}/Events?${query}`
    );

    const articles: ScrapedArticle[] = [];
    for (const event of events) {
      const agendaPublished = event.publishedFiles?.some((f) => f.type === 'Agenda');
      if (!event.agendaId || !agendaPublished) continue;
      await sleep(REQUEST_GAP_MS);
      const meeting = await fetchJson<CivicClerkMeeting>(`${API}/Meetings/${event.agendaId}`);
      const article = toArticle(event, meeting, now);
      if (article) articles.push(article);
    }
    return articles;
  },
};

export default buncombeCommission;
