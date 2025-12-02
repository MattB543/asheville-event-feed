import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import { asc, gte } from 'drizzle-orm';
import { getStartOfTodayEastern } from '@/lib/utils/timezone';

export const dynamic = 'force-dynamic';

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function escapeMarkdown(str: string | null | undefined): string {
  if (!str) return '';
  // Escape special markdown characters in inline text
  return str.replace(/([[\]()])/g, '\\$1');
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

function isDayOfWeek(date: Date, days: number[]): boolean {
  if (days.length === 0) return true;
  return days.includes(date.getDay());
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
    const tagsIncludeParam = searchParams.get('tagsInclude');
    const tagsExcludeParam = searchParams.get('tagsExclude');
    const includeTags = tagsIncludeParam ? tagsIncludeParam.split(',') : [];
    const excludeTags = tagsExcludeParam ? tagsExcludeParam.split(',') : [];
    const daysParam = searchParams.get('days');
    const selectedDays = daysParam ? daysParam.split(',').map(Number) : [];

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
      if (dateFilter === 'dayOfWeek' && !isDayOfWeek(eventDate, selectedDays)) return false;
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

      // Tag filter (include AND exclude)
      const eventTags = event.tags || [];

      // Exclude logic: If event has ANY excluded tag, filter it out
      if (excludeTags.length > 0) {
        if (excludeTags.some(tag => eventTags.includes(tag))) return false;
      }

      // Include logic: If includes are set, event must have at least one
      if (includeTags.length > 0) {
        if (!includeTags.some(tag => eventTags.includes(tag))) return false;
      }

      return true;
    });

    const header = `# Asheville Events

> Generated: ${new Date().toISOString()}
> Total Events: ${allEvents.length}

---

`;

    const eventsList = allEvents.map(event => {
      const lines: string[] = [];

      // Title with link
      const safeTitle = escapeMarkdown(event.title);
      lines.push(`## [${safeTitle}](${event.url})`);
      lines.push('');

      // Date
      lines.push(`**Date:** ${formatDate(new Date(event.startDate))}`);

      // Location
      if (event.location) {
        lines.push(`**Location:** ${event.location}`);
      }

      // Organizer
      if (event.organizer) {
        lines.push(`**Organizer:** ${event.organizer}`);
      }

      // Price
      if (event.price) {
        lines.push(`**Price:** ${event.price}`);
      }

      // Source
      lines.push(`**Source:** ${event.source}`);

      // Tags
      if (event.tags && event.tags.length > 0) {
        lines.push(`**Tags:** ${event.tags.join(', ')}`);
      }

      // Description (truncated)
      if (event.description) {
        const truncated = event.description.length > 500
          ? event.description.slice(0, 500) + '...'
          : event.description;
        lines.push('');
        lines.push(truncated);
      }

      lines.push('');
      lines.push('---');
      lines.push('');

      return lines.join('\n');
    }).join('\n');

    const markdown = header + eventsList;

    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[Markdown Export] Error:', error);
    return new NextResponse(
      '# Error\n\nFailed to generate Markdown feed.',
      {
        status: 500,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      }
    );
  }
}
