import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userPreferences, events } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

interface PositiveSignal {
  eventId: string;
  signalType: 'favorite' | 'calendar' | 'share' | 'viewSource';
  timestamp: string;
  active: boolean;
}

interface NegativeSignal {
  eventId: string;
  timestamp: string;
  active: boolean;
}

interface TasteEvent {
  event: {
    id: string;
    title: string;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    url: string;
    imageUrl: string | null;
  };
  signalType?: 'favorite' | 'calendar' | 'share' | 'viewSource' | 'hide';
  timestamp: string;
  active: boolean;
}

// GET /api/taste - Get user's signal history
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch user preferences
    const result = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({
        positive: [],
        negative: [],
        inactive: [],
      });
    }

    const prefs = result[0];
    const positiveSignals = (prefs.positiveSignals as PositiveSignal[]) ?? [];
    const negativeSignals = (prefs.negativeSignals as NegativeSignal[]) ?? [];

    // Get all unique event IDs
    const allEventIds = [
      ...positiveSignals.map(s => s.eventId),
      ...negativeSignals.map(s => s.eventId),
    ];

    // Fetch event details for all signals
    const eventDetails = allEventIds.length > 0
      ? await db
          .select({
            id: events.id,
            title: events.title,
            startDate: events.startDate,
            location: events.location,
            organizer: events.organizer,
            url: events.url,
            imageUrl: events.imageUrl,
          })
          .from(events)
          .where(inArray(events.id, allEventIds))
      : [];

    // Create a map for quick event lookup
    const eventMap = new Map(eventDetails.map(e => [e.id, e]));

    // Process positive signals
    const positiveEvents: TasteEvent[] = positiveSignals
      .reduce<TasteEvent[]>((acc, signal) => {
        const event = eventMap.get(signal.eventId);
        if (!event) return acc;
        acc.push({
          event: {
            id: event.id,
            title: event.title,
            startDate: event.startDate,
            location: event.location,
            organizer: event.organizer,
            url: event.url,
            imageUrl: event.imageUrl,
          },
          signalType: signal.signalType,
          timestamp: signal.timestamp,
          active: signal.active,
        });
        return acc;
      }, []);

    // Process negative signals
    const negativeEvents: TasteEvent[] = negativeSignals
      .reduce<TasteEvent[]>((acc, signal) => {
        const event = eventMap.get(signal.eventId);
        if (!event) return acc;
        acc.push({
          event: {
            id: event.id,
            title: event.title,
            startDate: event.startDate,
            location: event.location,
            organizer: event.organizer,
            url: event.url,
            imageUrl: event.imageUrl,
          },
          signalType: 'hide',
          timestamp: signal.timestamp,
          active: signal.active,
        });
        return acc;
      }, []);

    // Split into active and inactive based on the active flag
    const activePositive = positiveEvents.filter(e => e.active);
    const activeNegative = negativeEvents.filter(e => e.active);
    const inactiveEvents = [
      ...positiveEvents.filter(e => !e.active),
      ...negativeEvents.filter(e => !e.active),
    ];

    // Sort by timestamp (most recent first)
    activePositive.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    activeNegative.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    inactiveEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({
      positive: activePositive,
      negative: activeNegative,
      inactive: inactiveEvents,
    });
  } catch (error) {
    console.error("Error fetching taste profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch taste profile" },
      { status: 500 }
    );
  }
}
