import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCuratorProfileByUserId, getOrCreateCuratorProfile, updateCuratorProfile } from "@/lib/supabase/curatorProfile";

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

    const body = await request.json();
    const { displayName, bio, isPublic, showProfilePicture, avatarUrl } = body;

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
