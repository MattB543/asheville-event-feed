import { db } from "@/lib/db";
import { curatorProfiles, curatedEvents, events } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { generateProfileSlug } from "@/lib/utils/generateProfileSlug";

// Get or create a curator profile (used on first curation)
export async function getOrCreateCuratorProfile(userId: string, email: string) {
  const existing = await db.select().from(curatorProfiles).where(eq(curatorProfiles.userId, userId)).limit(1);
  if (existing.length > 0) return existing[0];

  const slug = generateProfileSlug(email, userId);
  const displayName = email.split('@')[0];

  const [profile] = await db.insert(curatorProfiles).values({
    userId,
    slug,
    displayName,
    isPublic: false,
  }).returning();

  return profile;
}

// Get profile by slug (for public pages)
export async function getCuratorProfileBySlug(slug: string) {
  const results = await db.select().from(curatorProfiles).where(eq(curatorProfiles.slug, slug)).limit(1);
  return results[0] || null;
}

// Get profile by userId
export async function getCuratorProfileByUserId(userId: string) {
  const results = await db.select().from(curatorProfiles).where(eq(curatorProfiles.userId, userId)).limit(1);
  return results[0] || null;
}

// Update profile settings
export async function updateCuratorProfile(userId: string, data: {
  displayName?: string;
  bio?: string;
  isPublic?: boolean;
  showProfilePicture?: boolean;
  avatarUrl?: string | null;
}) {
  await db.update(curatorProfiles)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(curatorProfiles.userId, userId));
}

// Get user's curated events with full event data
export async function getCuratedEventsWithDetails(userId: string) {
  return db.select({
    curation: curatedEvents,
    event: events,
  })
  .from(curatedEvents)
  .innerJoin(events, eq(curatedEvents.eventId, events.id))
  .where(eq(curatedEvents.userId, userId))
  .orderBy(desc(curatedEvents.curatedAt));
}

// Get just curation records (eventIds)
export async function getUserCurations(userId: string) {
  return db.select().from(curatedEvents).where(eq(curatedEvents.userId, userId));
}

// Add a curation
export async function addCuration(userId: string, eventId: string, note?: string) {
  await db.insert(curatedEvents).values({
    userId,
    eventId,
    note: note || null,
  }).onConflictDoNothing();
}

// Remove a curation
export async function removeCuration(userId: string, eventId: string) {
  await db.delete(curatedEvents)
    .where(and(
      eq(curatedEvents.userId, userId),
      eq(curatedEvents.eventId, eventId)
    ));
}
