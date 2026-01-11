import { NextResponse } from 'next/server';
import { queryTop30Events } from '@/lib/db/queries/events';
import { generateTop30ICS } from '@/lib/utils/icsGenerator';

// Force dynamic - no static caching since top30 changes
export const dynamic = 'force-dynamic';

// Next.js ISR cache for 1 hour
export const revalidate = 3600;

/**
 * GET /api/top30/calendar
 *
 * Public API endpoint that returns an ICS calendar feed of the Top 30 events.
 * Designed for calendar subscription (auto-updating feed).
 *
 * Users can subscribe in Apple Calendar, Google Calendar, or Outlook.
 * The feed automatically updates as events change.
 */
export async function GET() {
  try {
    console.log('[Calendar API] Generating Top 30 calendar feed...');

    // Fetch Top 30 events from database
    const top30Data = await queryTop30Events();

    // Use the "overall" category (top 30 by base score)
    const events = top30Data.overall;

    console.log(`[Calendar API] Generating ICS for ${events.length} events`);

    // Generate ICS calendar content
    const icsContent = generateTop30ICS(events);

    // Return ICS file as response
    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="avl-go-top30.ics"',
        'Cache-Control': 'public, s-maxage=3600', // 1-hour cache
      },
    });
  } catch (error) {
    console.error('[Calendar API] Error generating calendar:', error);
    return NextResponse.json({ error: 'Error generating calendar' }, { status: 500 });
  }
}
