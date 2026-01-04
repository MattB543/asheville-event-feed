import { NextResponse } from 'next/server';
import { getSimilarEvents } from '@/lib/events/getEvent';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/events/[id]/similar
// Returns: { similarEvents: SimilarEvent[] }
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid event ID format.',
      },
      { status: 400 }
    );
  }

  try {
    const similarEvents = await getSimilarEvents(id);

    return NextResponse.json({
      success: true,
      similarEvents,
    });
  } catch (error) {
    console.error('[SimilarEvents] Database error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch similar events.',
      },
      { status: 500 }
    );
  }
}
