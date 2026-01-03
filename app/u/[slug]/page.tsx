import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { db } from '@/lib/db';
import { curatorProfiles, curatedEvents, events } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import Header from '@/components/Header';
import CuratorProfileCard from '@/components/CuratorProfileCard';
import CuratedEventList from '@/components/CuratedEventList';

export const revalidate = 60; // ISR: revalidate every minute

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  const [profile] = await db
    .select()
    .from(curatorProfiles)
    .where(eq(curatorProfiles.slug, slug))
    .limit(1);

  if (!profile || !profile.isPublic) {
    return { title: 'Profile Not Found | AVL GO' };
  }

  return {
    title: `${profile.displayName}'s Curated Events | AVL GO`,
    description:
      profile.bio || `Check out events curated by ${profile.displayName} in Asheville, NC`,
  };
}

export default async function CuratorProfilePage({ params }: PageProps) {
  const { slug } = await params;

  // Check if user is logged in
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch profile
  const [profile] = await db
    .select()
    .from(curatorProfiles)
    .where(eq(curatorProfiles.slug, slug))
    .limit(1);

  // Profile doesn't exist
  if (!profile) {
    notFound();
  }

  // Check if this is the owner viewing their own profile
  const isOwner = user?.id === profile.userId;

  // If profile is private and viewer is not the owner, show not found
  if (!profile.isPublic && !isOwner) {
    notFound();
  }

  // Fetch curated events with full event data
  const curations = await db
    .select({
      id: curatedEvents.id,
      note: curatedEvents.note,
      curatedAt: curatedEvents.curatedAt,
      event: {
        id: events.id,
        title: events.title,
        description: events.description,
        aiSummary: events.aiSummary,
        startDate: events.startDate,
        location: events.location,
        organizer: events.organizer,
        price: events.price,
        url: events.url,
        imageUrl: events.imageUrl,
        tags: events.tags,
        source: events.source,
      },
    })
    .from(curatedEvents)
    .innerJoin(events, eq(curatedEvents.eventId, events.id))
    .where(eq(curatedEvents.userId, profile.userId))
    .orderBy(desc(curatedEvents.curatedAt));

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />
      <div className="flex-1 py-8 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Top navigation bar - Edit button for owner */}
          {isOwner && (
            <div className="flex justify-end mb-6">
              <Link
                href="/profile"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-700 rounded-lg hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
              >
                <Settings className="w-4 h-4" />
                Edit bio & visibility
              </Link>
            </div>
          )}

          {/* Private profile banner for owner */}
          {isOwner && !profile.isPublic && (
            <div className="mb-6 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Your profile is private. Only you can see this page.
              </p>
            </div>
          )}
          <CuratorProfileCard
            displayName={profile.displayName}
            title={profile.title}
            bio={profile.bio}
            curationCount={curations.length}
            showProfilePicture={profile.showProfilePicture}
            avatarUrl={profile.avatarUrl}
          />
          <CuratedEventList curations={curations} />
        </div>
      </div>
    </main>
  );
}
