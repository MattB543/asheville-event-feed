'use client';

import Script from 'next/script';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// TypeScript declarations for Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GISConfig) => void;
          renderButton: (element: HTMLElement | null, options: GISButtonOptions) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface GISConfig {
  client_id: string;
  callback: (response: CredentialResponse) => void;
  nonce?: string;
  use_fedcm_for_prompt?: boolean;
}

interface CredentialResponse {
  credential: string;
  select_by: string;
}

interface GISButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  width?: number;
}

// Generate nonce for security
function genNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface GoogleSignInButtonProps {
  className?: string;
  redirectTo?: string;
}

export function GoogleSignInButton({ className, redirectTo = '/events' }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const initializedRef = useRef(false);
  const safeRedirect =
    redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/events';

  const initializeButton = useCallback(async () => {
    // Prevent re-initialization
    if (initializedRef.current || !buttonRef.current || !containerRef.current) return;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.warn('Google Sign-In: NEXT_PUBLIC_GOOGLE_CLIENT_ID not configured');
      setError('Google Sign-In not configured');
      return;
    }

    if (!window.google?.accounts?.id) {
      console.warn('Google Identity Services not loaded');
      return;
    }

    initializedRef.current = true;

    const supabase = createClient();
    const nonce = genNonce();
    const hashedNonce = await sha256Hex(nonce);

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response: CredentialResponse) => {
        void (async () => {
          try {
            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: response.credential,
              nonce, // raw nonce
            });

            if (error) throw error;

            console.log('Successfully signed in with Google');
            router.push(safeRedirect);
            router.refresh();
          } catch (err) {
            console.error('Google sign-in error:', err);
            setError('Failed to sign in with Google');
          }
        })();
      },
      nonce: hashedNonce, // hashed nonce to Google
      use_fedcm_for_prompt: true,
    });

    // Calculate responsive width: use container width, clamped between 200-400 (Google's limits)
    const containerWidth = containerRef.current.offsetWidth;
    const buttonWidth = Math.max(200, Math.min(400, containerWidth));

    // Render the Google Sign-In button
    window.google.accounts.id.renderButton(buttonRef.current, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: buttonWidth,
    });
  }, [router, safeRedirect]);

  useEffect(() => {
    if (isScriptLoaded) {
      void initializeButton();
    }
  }, [isScriptLoaded, initializeButton]);

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        onReady={() => setIsScriptLoaded(true)}
        strategy="afterInteractive"
      />
      <div ref={containerRef} className={className}>
        {/* Google's rendered button will appear here */}
        <div ref={buttonRef} className="flex justify-center" />
        {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
      </div>
    </>
  );
}
