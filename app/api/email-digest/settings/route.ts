import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type DigestFrequency = "none" | "daily" | "weekly";

interface EmailDigestSettings {
  frequency: DigestFrequency;
  tags: string[];
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
      .select({
        emailDigestFrequency: userPreferences.emailDigestFrequency,
        emailDigestTags: userPreferences.emailDigestTags,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json({
        frequency: "none",
        tags: [],
      });
    }

    const row = result[0];
    return NextResponse.json({
      frequency: row.emailDigestFrequency || "none",
      tags: row.emailDigestTags || [],
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

    const body = await request.json();
    const settings: EmailDigestSettings = {
      frequency: body.frequency || "none",
      tags: body.tags || [],
    };

    // Validate frequency
    if (!["none", "daily", "weekly"].includes(settings.frequency)) {
      return NextResponse.json(
        { error: "Invalid frequency value" },
        { status: 400 }
      );
    }

    // Upsert the settings
    await db
      .insert(userPreferences)
      .values({
        userId: user.id,
        emailDigestFrequency: settings.frequency,
        emailDigestTags: settings.tags,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          emailDigestFrequency: settings.frequency,
          emailDigestTags: settings.tags,
          updatedAt: new Date(),
        },
      });

    console.log(
      `[EmailDigest] Updated settings for ${user.email}: frequency=${settings.frequency}, tags=${settings.tags.length}`
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

