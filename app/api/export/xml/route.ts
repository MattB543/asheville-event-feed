import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { asc, gte } from 'drizzle-orm';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';

export const dynamic = 'force-dynamic';

function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getImageUrl(imageUrl: string | null | undefined): string {
  // Filter out base64 data URLs (AI-generated images) - they're too large
  if (!imageUrl || imageUrl.startsWith('data:')) return '';
  return imageUrl;
}

function parsePrice(priceStr: string | null | undefined): number {
  if (!priceStr) return 0;
  const lower = priceStr.toLowerCase();
  if (lower.includes('free') || lower.includes('donation')) return 0;
  const matches = priceStr.match(/(\d+(\.\d+)?)/);
  if (matches) return parseFloat(matches[0]);
  return 0;
}

function isToday(date: Date): boolean {
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.toDateString() === tomorrow.toDateString();
}

function isThisWeekend(date: Date): boolean {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  // If today is Sunday (0), Saturday was yesterday (-1)
  const daysUntilSaturday = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
  const saturday = new Date(today);
  saturday.setDate(today.getDate() + daysUntilSaturday);
  saturday.setHours(0, 0, 0, 0);
  const sundayEnd = new Date(saturday);
  sundayEnd.setDate(saturday.getDate() + 1);
  sundayEnd.setHours(23, 59, 59, 999);
  return date >= saturday && date <= sundayEnd;
}

function isInDateRange(date: Date, start: string, end?: string): boolean {
  const eventDate = new Date(date);
  eventDate.setHours(0, 0, 0, 0);
  const startDate = new Date(start);
  startDate.setHours(0, 0, 0, 0);

  if (end) {
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);
    return eventDate >= startDate && eventDate <= endDate;
  }
  return eventDate.toDateString() === startDate.toDateString();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.toLowerCase();
    const dateFilter = searchParams.get('dateFilter');
    const dateStart = searchParams.get('dateStart');
    const dateEnd = searchParams.get('dateEnd');
    const priceFilter = searchParams.get('priceFilter');
    const maxPrice = searchParams.get('maxPrice');
    const tagsParam = searchParams.get('tags');
    const selectedTags = tagsParam ? tagsParam.split(',') : [];

    // Get start of today in Eastern timezone (Asheville, NC)
    const startOfToday = getStartOfTodayEastern();

    let allEvents = await db
      .select()
      .from(events)
      .where(gte(events.startDate, startOfToday))
      .orderBy(asc(events.startDate));

    // Apply filters
    allEvents = allEvents.filter(event => {
      // Search filter
      if (search) {
        const searchText = `${event.title} ${event.description || ''} ${event.organizer || ''} ${event.location || ''}`.toLowerCase();
        if (!searchText.includes(search)) return false;
      }

      // Date filter
      const eventDate = new Date(event.startDate);
      if (dateFilter === 'today' && !isToday(eventDate)) return false;
      if (dateFilter === 'tomorrow' && !isTomorrow(eventDate)) return false;
      if (dateFilter === 'weekend' && !isThisWeekend(eventDate)) return false;
      if (dateFilter === 'custom' && dateStart && !isInDateRange(eventDate, dateStart, dateEnd || undefined)) return false;

      // Price filter
      if (priceFilter && priceFilter !== 'any') {
        const price = parsePrice(event.price);
        const priceStr = event.price?.toLowerCase() || '';
        const isFree = priceStr.includes('free') || priceStr.includes('donation') || price === 0;

        if (priceFilter === 'free' && !isFree) return false;
        if (priceFilter === 'under20' && price > 20) return false;
        if (priceFilter === 'under100' && price > 100) return false;
        if (priceFilter === 'custom' && maxPrice && price > parseFloat(maxPrice)) return false;
      }

      // Tag filter (OR logic)
      if (selectedTags.length > 0) {
        const eventTags = event.tags || [];
        if (!selectedTags.some(tag => eventTags.includes(tag))) return false;
      }

      return true;
    });

    const eventItems = allEvents.map(event => {
      const tagsXml = (event.tags || [])
        .map((t: string) => `        <tag>${escapeXml(t)}</tag>`)
        .join('\n');

      return `  <event>
    <id>${escapeXml(event.id)}</id>
    <sourceId>${escapeXml(event.sourceId)}</sourceId>
    <source>${escapeXml(event.source)}</source>
    <title>${escapeXml(event.title)}</title>
    <description>${escapeXml(event.description)}</description>
    <startDate>${event.startDate.toISOString()}</startDate>
    <location>${escapeXml(event.location)}</location>
    <organizer>${escapeXml(event.organizer)}</organizer>
    <price>${escapeXml(event.price)}</price>
    <url>${escapeXml(event.url)}</url>
    <imageUrl>${escapeXml(getImageUrl(event.imageUrl))}</imageUrl>
    <tags>
${tagsXml}
    </tags>
    <createdAt>${event.createdAt?.toISOString() || ''}</createdAt>
  </event>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<events count="${allEvents.length}" generated="${new Date().toISOString()}">
${eventItems}
</events>`;

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[XML Export] Error:', error);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<error>Failed to generate XML feed</error>`,
      {
        status: 500,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      }
    );
  }
}
