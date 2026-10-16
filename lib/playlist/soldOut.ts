import { env } from '@/lib/config/env';
import type { PlaylistEvent } from './match';
import { fetchWithRetry } from '@/lib/utils/retry';
import { decodeHtmlEntities } from '@/lib/utils/parsers';

// Both venues run the same WordPress plugin (RHP), so one parser reads both
const VENUE_SCHEDULE_URLS: Record<string, string> = {
  ORANGE_PEEL: 'https://theorangepeel.net',
  GREY_EAGLE: 'https://thegreyeagle.com',
};
const EVENTBRITE_ID_RE = /eventbrite\.com\/e\/[^/?#]*?-(\d+)/;

const normalizeTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// "Thu, Jun 04", the venues' own date format
function venueDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('month')} ${get('day')}`;
}

function parseVenueSchedule(html: string): { date: string; title: string; soldOut: boolean }[] {
  return html
    .split('rhpSingleEvent py-4')
    .slice(1)
    .flatMap((block) => {
      const chunk = block.slice(0, 6000);
      const title = chunk.match(/rhp-event__title--list[^>]*>\s*([^<]+)\s*</)?.[1];
      const date = chunk.match(/singleEventDate[^>]*>\s*([^<]+)\s*</)?.[1];
      if (!title || !date) return [];
      return [
        {
          date: date.trim(),
          title: decodeHtmlEntities(title).trim(),
          soldOut: /sold[-_ ]?out/i.test(chunk),
        },
      ];
    });
}

async function eventbriteSoldOut(events: PlaylistEvent[]): Promise<Set<string>> {
  const sold = new Set<string>();
  if (!env.EVENTBRITE_API_TOKEN) return sold;
  for (const event of events) {
    const id = event.url.match(EVENTBRITE_ID_RE)?.[1];
    if (!id) continue;
    try {
      const response = await fetchWithRetry(
        `https://www.eventbriteapi.com/v3/events/${id}/?expand=ticket_availability`,
        { headers: { Authorization: `Bearer ${env.EVENTBRITE_API_TOKEN}` } },
        { maxRetries: 1 }
      );
      const data = (await response.json()) as { ticket_availability?: { is_sold_out?: boolean } };
      if (data.ticket_availability?.is_sold_out) sold.add(event.id);
    } catch (error) {
      console.warn(`[Playlist] Eventbrite sold-out check skipped for ${id}:`, error);
    }
  }
  return sold;
}

/** Ids of the given events that their venue or Eventbrite lists as sold out. */
export async function findSoldOut(events: PlaylistEvent[]): Promise<Set<string>> {
  const sold = await eventbriteSoldOut(events);
  const sources = new Set(events.map((e) => e.source).filter((s) => s in VENUE_SCHEDULE_URLS));
  for (const source of sources) {
    let listings: ReturnType<typeof parseVenueSchedule>;
    try {
      const response = await fetchWithRetry(
        VENUE_SCHEDULE_URLS[source],
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        },
        { maxRetries: 2 }
      );
      listings = parseVenueSchedule(await response.text());
    } catch (error) {
      console.warn(`[Playlist] Sold-out check skipped for ${source}:`, error);
      continue;
    }
    for (const event of events) {
      if (event.source !== source) continue;
      const dateKey = venueDateKey(event.startDate);
      const title = normalizeTitle(event.title);
      // Either title can contain the other: "Coheed and Cambria" vs the listing
      // "Coheed and Cambria Cicada Rhythm"
      const match = listings.some((l) => {
        const listed = normalizeTitle(l.title);
        return (
          l.soldOut && l.date === dateKey && (listed.includes(title) || title.includes(listed))
        );
      });
      if (match) sold.add(event.id);
    }
  }
  return sold;
}
