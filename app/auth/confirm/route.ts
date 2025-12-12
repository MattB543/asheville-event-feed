import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = searchParams.get('next') ?? '/';

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type: type as 'email',
      token_hash,
    });

    if (!error) {
      // Successful verification - redirect to the intended destination
      return NextResponse.redirect(`${origin}${next}`);
    }

    // Verification failed - redirect with error
    console.error('Magic link verification failed:', error.message);
  }

  // Invalid or missing parameters - redirect to home with error
  return NextResponse.redirect(`${origin}/?auth_error=invalid_link`);
}
