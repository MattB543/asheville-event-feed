/**
 * AI-powered deduplication cron job.
 *
 * Runs daily at 5 AM ET to catch semantic duplicates that rule-based
 * deduplication might miss.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { env } from "@/lib/config/env";
import { verifyAuthToken } from "@/lib/utils/auth";
import {
  runAIDeduplication,
  isAIDeduplicationAvailable,
  EventForAIDedup,
} from "@/lib/ai/aiDeduplication";

export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const startTime = Date.now();

  try {
    console.log("[AI Dedup Cron] ════════════════════════════════════════════════");
    console.log("[AI Dedup Cron] Starting AI deduplication job...");

    // Check if Azure AI is configured
    if (!isAIDeduplicationAvailable()) {
      console.log("[AI Dedup Cron] Azure AI not configured, skipping.");
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Azure AI not configured",
      });
    }

    // Fetch all events for AI analysis
    const allEvents = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        organizer: events.organizer,
        location: events.location,
        startDate: events.startDate,
        price: events.price,
        source: events.source,
      })
      .from(events);

    console.log(`[AI Dedup Cron] Analyzing ${allEvents.length} events...`);

    const eventsForAI: EventForAIDedup[] = allEvents.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      organizer: e.organizer,
      location: e.location,
      startDate: e.startDate,
      price: e.price,
      source: e.source,
    }));

    // Run AI deduplication for today + next 10 days
    const result = await runAIDeduplication(eventsForAI, {
      maxDays: 11,
      delayBetweenDays: 300,
      verbose: true,
    });

    // Delete duplicates
    if (result.idsToRemove.length > 0) {
      await db.delete(events).where(inArray(events.id, result.idsToRemove));
      console.log(
        `[AI Dedup Cron] Removed ${result.idsToRemove.length} duplicate events.`
      );
    } else {
      console.log("[AI Dedup Cron] No duplicates found.");
    }

    const duration = Date.now() - startTime;
    console.log("[AI Dedup Cron] ────────────────────────────────────────────────");
    console.log(
      `[AI Dedup Cron] Complete in ${Math.round(duration / 1000)}s: ${result.idsToRemove.length} removed, ${result.totalTokensUsed} tokens used`
    );
    console.log("[AI Dedup Cron] ════════════════════════════════════════════════");

    return NextResponse.json({
      success: true,
      duration,
      daysProcessed: result.daysProcessed,
      duplicatesRemoved: result.idsToRemove.length,
      tokensUsed: result.totalTokensUsed,
      errors: result.errors,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[AI Dedup Cron] ════════════════════════════════════════════════");
    console.error("[AI Dedup Cron] Job failed:", error);
    console.error("[AI Dedup Cron] ════════════════════════════════════════════════");
    return NextResponse.json(
      { success: false, error: String(error), duration },
      { status: 500 }
    );
  }
}
