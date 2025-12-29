import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { newsletterSettings, userPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  type NewsletterFilters,
  type NewsletterSettingsPayload,
  type NewsletterFrequency,
  type NewsletterScoreTier,
} from "@/lib/newsletter/types";

const DEFAULT_FILTERS: NewsletterFilters = {
  search: "",
  dateFilter: "all",
  customDateRange: { start: null, end: null },
  selectedDays: [],
  selectedTimes: [],
  priceFilter: "any",
  customMaxPrice: null,
  tagsInclude: [],
  tagsExclude: [],
  selectedLocations: [],
  selectedZips: [],
  showDailyEvents: true,
  useDefaultFilters: true,
};

const ALLOWED_FREQUENCIES: NewsletterFrequency[] = ["none", "daily", "weekly"];
const ALLOWED_SCORE_TIERS: NewsletterScoreTier[] = ["all", "top50", "top10"];

function normalizeFilters(filters?: NewsletterFilters): NewsletterFilters {
  const merged = {
    ...DEFAULT_FILTERS,
    ...filters,
    customDateRange: {
      ...DEFAULT_FILTERS.customDateRange,
      ...(filters?.customDateRange || {}),
    },
  };

  return {
    ...merged,
    selectedDays: Array.isArray(merged.selectedDays)
      ? merged.selectedDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [],
    selectedTimes: Array.isArray(merged.selectedTimes)
      ? merged.selectedTimes
      : [],
    tagsInclude: Array.isArray(merged.tagsInclude) ? merged.tagsInclude : [],
    tagsExclude: Array.isArray(merged.tagsExclude) ? merged.tagsExclude : [],
    selectedLocations: Array.isArray(merged.selectedLocations)
      ? merged.selectedLocations
      : [],
    selectedZips: Array.isArray(merged.selectedZips) ? merged.selectedZips : [],
  };
}

// GET /api/email-digest/settings - Get current user's email digest settings
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db
      .select()
      .from(newsletterSettings)
      .where(eq(newsletterSettings.userId, user.id))
      .limit(1);

    if (result.length === 0) {
      const legacy = await db
        .select({
          frequency: userPreferences.emailDigestFrequency,
          tags: userPreferences.emailDigestTags,
        })
        .from(userPreferences)
        .where(eq(userPreferences.userId, user.id))
        .limit(1);

      if (legacy.length > 0) {
        const legacySettings = legacy[0];
        const legacyFrequency =
          (legacySettings.frequency as NewsletterFrequency) || "none";
        const legacyFilters = normalizeFilters({
          ...DEFAULT_FILTERS,
          tagsInclude: legacySettings.tags ?? [],
        });

        await db.insert(newsletterSettings).values({
          userId: user.id,
          frequency: legacyFrequency,
          weekendEdition: false,
          scoreTier: "all",
          filters: legacyFilters,
          curatorUserIds: [],
          updatedAt: new Date(),
        });

        return NextResponse.json({
          frequency: legacyFrequency,
          weekendEdition: false,
          scoreTier: "all",
          filters: legacyFilters,
          curatorUserIds: [],
        });
      }

      return NextResponse.json({
        frequency: "none",
        weekendEdition: false,
        scoreTier: "all",
        filters: DEFAULT_FILTERS,
        curatorUserIds: [],
      });
    }

    const row = result[0];
    return NextResponse.json({
      frequency: (row.frequency as NewsletterFrequency) || "none",
      weekendEdition: row.weekendEdition ?? false,
      scoreTier: (row.scoreTier as NewsletterScoreTier) || "all",
      filters: normalizeFilters(row.filters as NewsletterFilters),
      curatorUserIds: row.curatorUserIds ?? [],
      updatedAt: row.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching email digest settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// POST /api/email-digest/settings - Update email digest settings
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as NewsletterSettingsPayload;

    if (body.frequency && !ALLOWED_FREQUENCIES.includes(body.frequency)) {
      return NextResponse.json(
        { error: "Invalid frequency value" },
        { status: 400 }
      );
    }

    if (body.scoreTier && !ALLOWED_SCORE_TIERS.includes(body.scoreTier)) {
      return NextResponse.json(
        { error: "Invalid score tier value" },
        { status: 400 }
      );
    }

    const existing = await db
      .select()
      .from(newsletterSettings)
      .where(eq(newsletterSettings.userId, user.id))
      .limit(1);

    const current = existing[0];
    const nextFilters = body.filters
      ? normalizeFilters(body.filters)
      : normalizeFilters(current?.filters as NewsletterFilters | undefined);

    const nextFrequency = body.frequency ?? (current?.frequency as NewsletterFrequency) ?? "none";
    const nextWeekendEdition =
      body.weekendEdition ?? current?.weekendEdition ?? false;
    const nextScoreTier = body.scoreTier ?? (current?.scoreTier as NewsletterScoreTier) ?? "all";
    const nextCuratorUserIds =
      body.curatorUserIds ?? current?.curatorUserIds ?? [];
    const normalizedWeekendEdition =
      nextFrequency === "daily" ? nextWeekendEdition : false;

    await db
      .insert(newsletterSettings)
      .values({
        userId: user.id,
        frequency: nextFrequency,
        weekendEdition: normalizedWeekendEdition,
        scoreTier: nextScoreTier,
        filters: nextFilters,
        curatorUserIds: nextCuratorUserIds,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: newsletterSettings.userId,
        set: {
          frequency: nextFrequency,
          weekendEdition: normalizedWeekendEdition,
          scoreTier: nextScoreTier,
          filters: nextFilters,
          curatorUserIds: nextCuratorUserIds,
          updatedAt: new Date(),
        },
      });

    console.log(
      `[Newsletter] Updated settings for ${user.email}: frequency=${nextFrequency}, scoreTier=${nextScoreTier}, curators=${nextCuratorUserIds.length}`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving email digest settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}

