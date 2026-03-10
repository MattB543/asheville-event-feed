import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next');
  const isDev = process.env.NODE_ENV !== 'production';
  const next =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (isDev) {
    console.info('[Auth][Callback] Incoming request', {
      hasCode: Boolean(code),
      hasError: Boolean(error),
      hasNextParam: Boolean(nextParam),
      next,
    });
  }

  // Handle OAuth errors
  if (error) {
    console.error('[Auth][Callback] OAuth error', {
      error,
      errorDescription,
      next,
    });
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription || error)}`
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (!exchangeError) {
      const forwardedHost = request.headers.get('x-forwarded-host');
      const isLocalEnv = process.env.NODE_ENV === 'development';

      if (isLocalEnv) {
        if (isDev) {
          console.info('[Auth][Callback] Code exchange success (local)', { next });
        }
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        if (isDev) {
          console.info('[Auth][Callback] Code exchange success (forwarded host)', {
            next,
            forwardedHost,
          });
        }
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        if (isDev) {
          console.info('[Auth][Callback] Code exchange success (origin)', { next });
        }
        return NextResponse.redirect(`${origin}${next}`);
      }
    }

    console.error('[Auth][Callback] Code exchange failed', {
      message: exchangeError.message,
      next,
    });
  }

  // Return the user to login with error
  console.warn('[Auth][Callback] Missing code, redirecting with auth error');
  return NextResponse.redirect(`${origin}/login?error=Could not authenticate`);
}
