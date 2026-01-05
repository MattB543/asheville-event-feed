import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/utils/superAdmin';
import { setCuratorVerification, getCuratorProfileByUserId } from '@/lib/supabase/curatorProfile';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin
    if (!isSuperAdmin(user.id)) {
      return NextResponse.json({ error: 'Forbidden - Super admin only' }, { status: 403 });
    }

    // Parse request body
    const body = (await request.json()) as {
      curatorUserId: string;
      verified: boolean;
    };
    const { curatorUserId, verified } = body;

    if (!curatorUserId || typeof verified !== 'boolean') {
      return NextResponse.json(
        { error: 'curatorUserId and verified (boolean) are required' },
        { status: 400 }
      );
    }

    // Check if curator profile exists
    const profile = await getCuratorProfileByUserId(curatorUserId);
    if (!profile) {
      return NextResponse.json({ error: 'Curator profile not found' }, { status: 404 });
    }

    // Update verification status
    await setCuratorVerification(curatorUserId, verified, user.id);

    return NextResponse.json({
      success: true,
      curatorUserId,
      isVerified: verified,
    });
  } catch (error) {
    console.error('Error toggling curator verification:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
