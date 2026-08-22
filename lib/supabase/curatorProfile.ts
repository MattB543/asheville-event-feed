import { db } from '@/lib/db';
import { curatorProfiles, curatedEvents, events } from '@/lib/db/schema';
import { eq, desc, and, isNull, or } from 'drizzle-orm';
import { generateProfileSlug } from '@/lib/utils/generateProfileSlug';
import { publicEventColumns } from '@/lib/db/queries/publicEventColumns';

// Get or create a curator profile (used on first curation)
export async function getOrCreateCuratorProfile(userId: string, email: string) {
  const existing = await db
    .select()
    .from(curatorProfiles)
    .where(eq(curatorProfiles.userId, userId))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const slug = generateProfileSlug(email, userId);
  const displayName = email.split('@')[0];

  // Insert-or-ignore on userId so two concurrent first-curation requests don't
  // both insert. A genuine *slug* collision still surfaces as an error.
  const [profile] = await db
    .insert(curatorProfiles)
    .values({
      userId,
      slug,
      displayName,
      isPublic: false,
    })
    .onConflictDoNothing({ target: curatorProfiles.userId })
    .returning();

  // .returning() is empty when the insert conflicted - the row exists, re-read it.
  if (profile) return profile;

  const [existingProfile] = await db
    .select()
    .from(curatorProfiles)
    .where(eq(curatorProfiles.userId, userId))
    .limit(1);

  return existingProfile;
}

// Get profile by slug (for public pages)
export async function getCuratorProfileBySlug(slug: string) {
  const results = await db
    .select()
    .from(curatorProfiles)
    .where(eq(curatorProfiles.slug, slug))
    .limit(1);
  return results[0] || null;
}

// Get profile by userId
export async function getCuratorProfileByUserId(userId: string) {
  const results = await db
    .select()
    .from(curatorProfiles)
    .where(eq(curatorProfiles.userId, userId))
    .limit(1);
  return results[0] || null;
}

// Update profile settings
export async function updateCuratorProfile(
  userId: string,
  data: {
    displayName?: string;
    title?: string | null;
    bio?: string;
    isPublic?: boolean;
    showProfilePicture?: boolean;
    avatarUrl?: string | null;
  }
) {
  // Pick fields explicitly rather than spreading caller data into .set()
  const updates: Partial<typeof curatorProfiles.$inferInsert> = { updatedAt: new Date() };
  if (data.displayName !== undefined) updates.displayName = data.displayName;
  if (data.title !== undefined) updates.title = data.title;
  if (data.bio !== undefined) updates.bio = data.bio;
  if (data.isPublic !== undefined) updates.isPublic = data.isPublic;
  if (data.showProfilePicture !== undefined) updates.showProfilePicture = data.showProfilePicture;
  if (data.avatarUrl !== undefined) updates.avatarUrl = data.avatarUrl;

  await db.update(curatorProfiles).set(updates).where(eq(curatorProfiles.userId, userId));
}

// Get user's curated events with public event data (used by the public profile API)
export async function getCuratedEventsWithDetails(userId: string) {
  return db
    .select({
      curation: {
        id: curatedEvents.id,
        note: curatedEvents.note,
        curatedAt: curatedEvents.curatedAt,
      },
      event: publicEventColumns,
    })
    .from(curatedEvents)
    .innerJoin(events, eq(curatedEvents.eventId, events.id))
    .where(
      and(
        eq(curatedEvents.userId, userId),
        or(isNull(events.hidden), eq(events.hidden, false)),
        isNull(events.dedupedAt)
      )
    )
    .orderBy(desc(curatedEvents.curatedAt));
}

// Get just curation records (eventIds)
export async function getUserCurations(userId: string) {
  return db.select().from(curatedEvents).where(eq(curatedEvents.userId, userId));
}

// Add a curation
export async function addCuration(userId: string, eventId: string, note?: string) {
  await db
    .insert(curatedEvents)
    .values({
      userId,
      eventId,
      note: note || null,
    })
    .onConflictDoNothing();
}

// Remove a curation
export async function removeCuration(userId: string, eventId: string) {
  await db
    .delete(curatedEvents)
    .where(and(eq(curatedEvents.userId, userId), eq(curatedEvents.eventId, eventId)));
}

// Set curator verification status (super admin only)
export async function setCuratorVerification(
  curatorUserId: string,
  verified: boolean,
  verifiedByUserId: string
) {
  await db
    .update(curatorProfiles)
    .set({
      isVerified: verified,
      verifiedAt: verified ? new Date() : null,
      verifiedBy: verified ? verifiedByUserId : null,
      updatedAt: new Date(),
    })
    .where(eq(curatorProfiles.userId, curatorUserId));
}

// Check if a user is a verified curator
export async function isUserVerifiedCurator(userId: string): Promise<boolean> {
  const results = await db
    .select({ isVerified: curatorProfiles.isVerified })
    .from(curatorProfiles)
    .where(eq(curatorProfiles.userId, userId))
    .limit(1);

  return results[0]?.isVerified ?? false;
}
