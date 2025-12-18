import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, userPreferences } from "@/lib/db/schema";
import { sql, gte, and, or, eq, isNotNull } from "drizzle-orm";
import { env, isPostmarkEnabled } from "@/lib/config/env";
import { verifyAuthToken } from "@/lib/utils/auth";
import { sendEmail } from "@/lib/notifications/postmark";
import {
  generateDigestEmailHtml,
  generateDigestEmailText,
} from "@/lib/notifications/email-templates";
import { matchesDefaultFilter } from "@/lib/config/defaultFilters";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 300; // 5 minutes

// Helper to format duration in human-readable form
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

interface HiddenEventFingerprint {
  title: string;
  organizer: string;
}

interface DigestUser {
  userId: string;
  email: string;
  name?: string;
  frequency: "daily" | "weekly";
  lastSentAt: Date | null;
  blockedHosts: string[];
  blockedKeywords: string[];
  hiddenEvents: HiddenEventFingerprint[];
  useDefaultFilters: boolean;
  emailDigestTags: string[];
}

// Email digest cron job
//
// This route sends email digests to users who have opted in.
// Daily digests are sent every day at 7 AM ET.
// Weekly digests are sent on Mondays at 7 AM ET.
//
// Schedule: Daily at 7 AM ET (cron: "0 12 * * *" = 12:00 UTC)
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!verifyAuthToken(authHeader, env.CRON_SECRET)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!isPostmarkEnabled()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Email features not enabled (POSTMARK_API_KEY or POSTMARK_FROM_EMAIL not set)",
      },
      { status: 400 }
    );
  }

  const jobStartTime = Date.now();
  const now = new Date();
  const isMonday = now.getDay() === 1;

  // Stats tracking
  const stats = {
    usersQueried: 0,
    emailsSent: 0,
    emailsFailed: 0,
    usersSkipped: 0,
  };

  try {
    console.log("[EmailDigest] ════════════════════════════════════════════════");
    console.log("[EmailDigest] Starting email digest job...");
    console.log(`[EmailDigest] Day of week: ${now.getDay()} (Monday = 1), isMonday: ${isMonday}`);

    // Get Supabase service client to fetch user emails
    const supabase = createServiceClient();

    // 1. Find users who need digests
    // - Daily users: always
    // - Weekly users: only on Mondays
    console.log("[EmailDigest] Finding users needing digests...");

    const frequencyCondition = isMonday
      ? or(
          eq(userPreferences.emailDigestFrequency, "daily"),
          eq(userPreferences.emailDigestFrequency, "weekly")
        )
      : eq(userPreferences.emailDigestFrequency, "daily");

    const usersNeedingDigests = await db
      .select({
        userId: userPreferences.userId,
        emailDigestFrequency: userPreferences.emailDigestFrequency,
        emailDigestLastSentAt: userPreferences.emailDigestLastSentAt,
        blockedHosts: userPreferences.blockedHosts,
        blockedKeywords: userPreferences.blockedKeywords,
        hiddenEvents: userPreferences.hiddenEvents,
        useDefaultFilters: userPreferences.useDefaultFilters,
        emailDigestTags: userPreferences.emailDigestTags,
      })
      .from(userPreferences)
      .where(
        and(
          frequencyCondition!,
          isNotNull(userPreferences.emailDigestFrequency)
        )
      );

    stats.usersQueried = usersNeedingDigests.length;
    console.log(`[EmailDigest] Found ${usersNeedingDigests.length} users needing digests`);

    if (usersNeedingDigests.length === 0) {
      const totalDuration = Date.now() - jobStartTime;
      console.log(`[EmailDigest] No users to process, completed in ${formatDuration(totalDuration)}`);
      return NextResponse.json({
        success: true,
        duration: totalDuration,
        stats,
      });
    }

    // 2. Fetch user emails from Supabase Auth
    const userIds = usersNeedingDigests.map((u) => u.userId);
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
      perPage: 1000,
    });

    if (authError) {
      console.error("[EmailDigest] Failed to fetch auth users:", authError);
      return NextResponse.json(
        { success: false, error: "Failed to fetch user emails" },
        { status: 500 }
      );
    }

    // Create lookup map for user emails and names
    const userEmailMap = new Map<string, { email: string; name?: string }>();
    authUsers.users.forEach((user) => {
      if (user.email && userIds.includes(user.id)) {
        userEmailMap.set(user.id, {
          email: user.email,
          name: user.user_metadata?.full_name || user.user_metadata?.name,
        });
      }
    });

    // 3. Get upcoming events (next 14 days for weekly, next 2 days for daily)
    const twoWeeksFromNow = new Date();
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

    const upcomingEvents = await db
      .select({
        id: events.id,
        title: events.title,
        startDate: events.startDate,
        location: events.location,
        organizer: events.organizer,
        price: events.price,
        imageUrl: events.imageUrl,
        tags: events.tags,
        url: events.url,
        createdAt: events.createdAt,
        hidden: events.hidden,
      })
      .from(events)
      .where(
        and(
          gte(events.startDate, now),
          sql`${events.startDate} <= ${twoWeeksFromNow.toISOString()}`,
          eq(events.hidden, false)
        )
      )
      .orderBy(events.startDate);

    console.log(`[EmailDigest] Found ${upcomingEvents.length} upcoming events`);

    // 4. Process each user
    for (const userPref of usersNeedingDigests) {
      const userAuth = userEmailMap.get(userPref.userId);
      if (!userAuth?.email) {
        console.log(`[EmailDigest] Skipping user ${userPref.userId}: no email found`);
        stats.usersSkipped++;
        continue;
      }

      const digestUser: DigestUser = {
        userId: userPref.userId,
        email: userAuth.email,
        name: userAuth.name,
        frequency: userPref.emailDigestFrequency as "daily" | "weekly",
        lastSentAt: userPref.emailDigestLastSentAt,
        blockedHosts: userPref.blockedHosts ?? [],
        blockedKeywords: userPref.blockedKeywords ?? [],
        hiddenEvents: (userPref.hiddenEvents as HiddenEventFingerprint[]) ?? [],
        useDefaultFilters: userPref.useDefaultFilters ?? true,
        emailDigestTags: userPref.emailDigestTags ?? [],
      };

      // Filter events for this user
      const filteredEvents = filterEventsForUser(
        upcomingEvents,
        digestUser,
        digestUser.frequency === "daily" ? 2 : 14
      );

      // Only filter to NEW events since last sent (if applicable)
      const newEvents = digestUser.lastSentAt
        ? filteredEvents.filter(
            (e) => e.createdAt && new Date(e.createdAt) > digestUser.lastSentAt!
          )
        : filteredEvents;

      // For weekly digests, include all upcoming events even if not new
      // For daily digests, only include new events
      const eventsToSend =
        digestUser.frequency === "weekly" ? filteredEvents : newEvents;

      // Skip if no events to send (for daily)
      if (digestUser.frequency === "daily" && eventsToSend.length === 0) {
        console.log(
          `[EmailDigest] Skipping ${digestUser.email}: no new events since ${digestUser.lastSentAt?.toISOString()}`
        );
        stats.usersSkipped++;
        continue;
      }

      // Generate and send email
      const appUrl = env.NEXT_PUBLIC_APP_URL;
      const unsubscribeUrl = `${appUrl}/profile?unsubscribe=true`;

      const htmlBody = generateDigestEmailHtml({
        recipientName: digestUser.name,
        frequency: digestUser.frequency,
        events: eventsToSend.slice(0, 20), // Limit to 20 events per email
        unsubscribeUrl,
      });

      const textBody = generateDigestEmailText({
        recipientName: digestUser.name,
        frequency: digestUser.frequency,
        events: eventsToSend.slice(0, 20),
        unsubscribeUrl,
      });

      const subject =
        digestUser.frequency === "daily"
          ? `🎉 ${eventsToSend.length} new event${eventsToSend.length === 1 ? "" : "s"} in Asheville today`
          : `🎉 Your weekly Asheville events roundup (${eventsToSend.length} events)`;

      try {
        const sent = await sendEmail({
          to: digestUser.email,
          subject,
          htmlBody,
          textBody,
        });

        if (sent) {
          stats.emailsSent++;
          console.log(`[EmailDigest] Sent ${digestUser.frequency} digest to ${digestUser.email} (${eventsToSend.length} events)`);

          // Update lastSentAt
          await db
            .update(userPreferences)
            .set({ emailDigestLastSentAt: now })
            .where(eq(userPreferences.userId, digestUser.userId));
        } else {
          stats.emailsFailed++;
          console.error(`[EmailDigest] Failed to send to ${digestUser.email}`);
        }
      } catch (error) {
        stats.emailsFailed++;
        console.error(`[EmailDigest] Error sending to ${digestUser.email}:`, error);
      }

      // Small delay between emails to avoid rate limiting
      await new Promise((r) => setTimeout(r, 100));
    }

    // Final summary
    const totalDuration = Date.now() - jobStartTime;
    console.log("[EmailDigest] ────────────────────────────────────────────────");
    console.log(`[EmailDigest] JOB COMPLETE in ${formatDuration(totalDuration)}`);
    console.log("[EmailDigest] ────────────────────────────────────────────────");
    console.log(`[EmailDigest] Users queried: ${stats.usersQueried}`);
    console.log(`[EmailDigest] Emails sent: ${stats.emailsSent}`);
    console.log(`[EmailDigest] Emails failed: ${stats.emailsFailed}`);
    console.log(`[EmailDigest] Users skipped: ${stats.usersSkipped}`);
    console.log("[EmailDigest] ════════════════════════════════════════════════");

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      stats,
    });
  } catch (error) {
    const totalDuration = Date.now() - jobStartTime;
    console.error("[EmailDigest] ════════════════════════════════════════════════");
    console.error(`[EmailDigest] JOB FAILED after ${formatDuration(totalDuration)}`);
    console.error("[EmailDigest] Error:", error);
    console.error("[EmailDigest] ════════════════════════════════════════════════");
    return NextResponse.json(
      { success: false, error: String(error), duration: totalDuration },
      { status: 500 }
    );
  }
}

/**
 * Filter events based on user preferences.
 * Matches the client-side filtering logic.
 */
function filterEventsForUser(
  allEvents: Array<{
    id: string;
    title: string;
    startDate: Date;
    location: string | null;
    organizer: string | null;
    price: string | null;
    imageUrl: string | null;
    tags: string[] | null;
    url: string;
    createdAt: Date | null;
    hidden: boolean | null;
  }>,
  user: DigestUser,
  daysAhead: number
): Array<{
  id: string;
  title: string;
  startDate: Date;
  location: string | null;
  organizer: string | null;
  price: string | null;
  imageUrl: string | null;
  tags: string[] | null;
  url: string;
  createdAt: Date | null;
}> {
  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

  return allEvents.filter((event) => {
    // 1. Date range filter
    const eventDate = new Date(event.startDate);
    if (eventDate < now || eventDate > cutoffDate) {
      return false;
    }

    // 2. Hidden events filter
    if (event.hidden) {
      return false;
    }

    // 3. Blocked hosts filter
    if (event.organizer && user.blockedHosts.length > 0) {
      const organizerLower = event.organizer.toLowerCase();
      if (user.blockedHosts.some((host) => organizerLower.includes(host.toLowerCase()))) {
        return false;
      }
    }

    // 4. Blocked keywords filter (user custom)
    if (user.blockedKeywords.length > 0) {
      const titleLower = event.title.toLowerCase();
      if (user.blockedKeywords.some((kw) => titleLower.includes(kw.toLowerCase()))) {
        return false;
      }
    }

    // 5. Default filters (spam filter)
    if (user.useDefaultFilters) {
      if (matchesDefaultFilter(event.title)) {
        return false;
      }
    }

    // 6. Hidden events fingerprint filter
    if (user.hiddenEvents.length > 0) {
      const eventKey = createFingerprintKey(event.title, event.organizer);
      if (user.hiddenEvents.some((fp) => {
        const fpKey = `${fp.title.toLowerCase().trim()}|||${fp.organizer.toLowerCase().trim()}`;
        return eventKey === fpKey;
      })) {
        return false;
      }
    }

    // 7. Tag filter (if user has specific tags configured)
    if (user.emailDigestTags.length > 0) {
      const eventTags = event.tags || [];
      const hasMatchingTag = user.emailDigestTags.some((tag) =>
        eventTags.includes(tag)
      );
      if (!hasMatchingTag) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Create a fingerprint key for event matching (title + organizer).
 */
function createFingerprintKey(
  title: string,
  organizer: string | null | undefined
): string {
  const normalizedTitle = title.toLowerCase().trim();
  const normalizedOrganizer = (organizer || "").toLowerCase().trim();
  return `${normalizedTitle}|||${normalizedOrganizer}`;
}

