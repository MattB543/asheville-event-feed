import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const code = searchParams.get('code'); // fallback for default Supabase templates
  const next = searchParams.get('next') ?? '/';

  const supabase = await createClient();

  // Recommended PKCE-compatible magic link flow: token_hash + verifyOtp
  // This works across devices (user can open email on different browser/device)
  if (token_hash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'email', // IMPORTANT: 'magiclink' is deprecated
    });

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error('Magic link verification failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Fallback: default Supabase template can redirect with a PKCE code
  // Note: This can fail if user opens link in different browser than the one that requested it
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error('Code exchange failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // No token_hash or code provided
  return NextResponse.redirect(`${origin}/login?error=Invalid+or+expired+link`);
}
