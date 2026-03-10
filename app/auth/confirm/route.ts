import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const code = searchParams.get('code'); // fallback for default Supabase templates
  const nextParam = searchParams.get('next');
  const isDev = process.env.NODE_ENV !== 'production';
  let next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '';
  let nextSource: 'query' | 'cookie' | 'default' = next ? 'query' : 'default';

  // Fallback: read redirect from cookie if not in URL params.
  // Supabase email templates may not preserve query params from emailRedirectTo.
  if (!next) {
    const cookieStore = await cookies();
    const authRedirect = cookieStore.get('auth_redirect')?.value;
    if (authRedirect) {
      const decoded = decodeURIComponent(authRedirect);
      if (decoded.startsWith('/') && !decoded.startsWith('//')) {
        next = decoded;
        nextSource = 'cookie';
      }
    }
  }

  if (!next) {
    next = '/events';
    nextSource = 'default';
  }

  if (isDev) {
    console.info('[Auth][Confirm] Incoming request', {
      hasTokenHash: Boolean(token_hash),
      hasCode: Boolean(code),
      hasNextParam: Boolean(nextParam),
      next,
      nextSource,
      path: request.nextUrl.pathname,
    });
  }

  const supabase = await createClient();

  // Helper to build a redirect response and clear the auth_redirect cookie
  function redirectWithCleanup(url: string) {
    const response = NextResponse.redirect(url);
    response.cookies.delete('auth_redirect');
    return response;
  }

  // Recommended PKCE-compatible magic link flow: token_hash + verifyOtp
  // This works across devices (user can open email on different browser/device)
  if (token_hash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'email', // IMPORTANT: 'magiclink' is deprecated
    });

    if (!error) {
      if (isDev) {
        console.info('[Auth][Confirm] verifyOtp success', { next, nextSource });
      }
      return redirectWithCleanup(`${origin}${next}`);
    }

    console.error('[Auth][Confirm] verifyOtp failed', {
      message: error.message,
      next,
      nextSource,
    });
    return redirectWithCleanup(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Fallback: default Supabase template can redirect with a PKCE code
  // Note: This can fail if user opens link in different browser than the one that requested it
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      if (isDev) {
        console.info('[Auth][Confirm] exchangeCodeForSession success', { next, nextSource });
      }
      return redirectWithCleanup(`${origin}${next}`);
    }

    // Detect cross-device PKCE failure and show a friendly message
    const isCrossDevice =
      error.message.includes('code verifier') || error.message.includes('code_verifier');
    const userMessage = isCrossDevice
      ? 'This sign-in link was opened on a different device or browser. Please request a new magic link from this device.'
      : error.message;

    console.error('[Auth][Confirm] exchangeCodeForSession failed', {
      message: error.message,
      isCrossDevice,
      next,
      nextSource,
    });
    return redirectWithCleanup(`${origin}/login?error=${encodeURIComponent(userMessage)}`);
  }

  // No token_hash or code provided
  console.warn('[Auth][Confirm] Missing token_hash and code');
  return redirectWithCleanup(`${origin}/login?error=Invalid+or+expired+link`);
}
