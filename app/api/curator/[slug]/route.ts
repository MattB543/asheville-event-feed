import { NextResponse, type NextRequest } from 'next/server';
import {
  getCuratorProfileBySlug,
  getCuratedEventsWithDetails,
} from '@/lib/supabase/curatorProfile';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const profile = await getCuratorProfileBySlug(slug);

    if (!profile || !profile.isPublic) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const curationsWithEvents = await getCuratedEventsWithDetails(profile.userId);

    return NextResponse.json({
      profile: {
        displayName: profile.displayName,
        title: profile.title,
        bio: profile.bio,
        slug: profile.slug,
      },
      curations: curationsWithEvents,
    });
  } catch (error) {
    console.error('Error fetching curator profile:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}
