import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { curatorProfiles, curatedEvents } from "@/lib/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();

    const conditions = [eq(curatorProfiles.isPublic, true)];
    if (search) {
      conditions.push(
        or(
          ilike(curatorProfiles.displayName, `%${search}%`),
          ilike(curatorProfiles.bio, `%${search}%`)
        )!
      );
    }

    const results = await db
      .select({
        userId: curatorProfiles.userId,
        slug: curatorProfiles.slug,
        displayName: curatorProfiles.displayName,
        bio: curatorProfiles.bio,
        avatarUrl: curatorProfiles.avatarUrl,
        showProfilePicture: curatorProfiles.showProfilePicture,
        curationCount: sql<number>`count(${curatedEvents.id})::int`,
      })
      .from(curatorProfiles)
      .leftJoin(curatedEvents, eq(curatorProfiles.userId, curatedEvents.userId))
      .where(and(...conditions))
      .groupBy(curatorProfiles.userId)
      .orderBy(desc(sql`count(${curatedEvents.id})`));

    return NextResponse.json({ curators: results });
  } catch (error) {
    console.error("Error fetching public curators:", error);
    return NextResponse.json(
      { error: "Failed to fetch curators" },
      { status: 500 }
    );
  }
}
