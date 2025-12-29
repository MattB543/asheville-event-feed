import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCuratorProfileByUserId, getOrCreateCuratorProfile, updateCuratorProfile } from "@/lib/supabase/curatorProfile";
import { isBoolean, isRecord, isString } from "@/lib/utils/validation";

// GET - Get current user's curator profile
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await getCuratorProfileByUserId(user.id);
    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Error fetching curator profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}

// POST - Create or update curator profile
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const displayName = isString(parsed.displayName)
      ? parsed.displayName
      : undefined;
    const bio = isString(parsed.bio) ? parsed.bio : undefined;
    const isPublic = isBoolean(parsed.isPublic) ? parsed.isPublic : undefined;
    const showProfilePicture = isBoolean(parsed.showProfilePicture)
      ? parsed.showProfilePicture
      : undefined;
    const avatarUrl = isString(parsed.avatarUrl) ? parsed.avatarUrl : undefined;

    // Ensure profile exists first
    await getOrCreateCuratorProfile(user.id, user.email || "");

    // Update with provided values
    await updateCuratorProfile(user.id, {
      ...(displayName !== undefined && { displayName }),
      ...(bio !== undefined && { bio }),
      ...(isPublic !== undefined && { isPublic }),
      ...(showProfilePicture !== undefined && { showProfilePicture }),
      ...(avatarUrl !== undefined && { avatarUrl }),
    });

    const updated = await getCuratorProfileByUserId(user.id);
    return NextResponse.json({ profile: updated });
  } catch (error) {
    console.error("Error updating curator profile:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
