'use client';

import Script from 'next/script';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthProvider';

// TypeScript declarations for Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleOneTapConfig) => void;
          prompt: (callback?: (notification: PromptNotification) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

interface GoogleOneTapConfig {
  client_id: string;
  callback: (response: CredentialResponse) => void;
  nonce?: string;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
}

interface CredentialResponse {
  credential: string;
  select_by: string;
}

interface PromptNotification {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  getNotDisplayedReason: () => string;
  getSkippedReason: () => string;
}

// Generate nonce for security
async function generateNonce(): Promise<[string, string]> {
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))
  );
  const encoder = new TextEncoder();
  const encodedNonce = encoder.encode(nonce);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encodedNonce);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashedNonce = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [nonce, hashedNonce];
}

interface GoogleOneTapProps {
  onNotDisplayed?: () => void;
}

export function GoogleOneTap({ onNotDisplayed }: GoogleOneTapProps) {
  const supabase = createClient();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const initializedRef = useRef(false);

  const initializeOneTap = useCallback(async () => {
    // Prevent re-initialization
    if (initializedRef.current) return;

    // Don't show if user is logged in or still loading
    if (isLoading || user) return;

    // Check if Google client ID is configured
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.warn('Google One Tap: NEXT_PUBLIC_GOOGLE_CLIENT_ID not configured');
      return;
    }

    initializedRef.current = true;

    const [nonce, hashedNonce] = await generateNonce();

    window.google?.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: CredentialResponse) => {
        try {
          const { error } = await supabase.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
            nonce,
          });

          if (error) throw error;

          console.log('Successfully signed in with Google One Tap');
          router.push('/');
          router.refresh();
        } catch (error) {
          console.error('One Tap sign-in error:', error);
        }
      },
      nonce: hashedNonce,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true, // Required for Chrome's third-party cookie phase-out
    });

    window.google?.accounts.id.prompt((notification) => {
      // Note: With FedCM enabled, some notification methods may return less info
      // for privacy reasons. Use optional chaining for compatibility.
      const notDisplayed = notification.isNotDisplayed?.();
      const skipped = notification.isSkippedMoment?.();

      if (notDisplayed || skipped) {
        // Only log in development - these reasons may be undefined with FedCM
        if (process.env.NODE_ENV === 'development') {
          console.log(
            'One Tap not displayed:',
            notification.getNotDisplayedReason?.() ||
              notification.getSkippedReason?.() ||
              'reason unavailable (FedCM privacy)'
          );
        }
        onNotDisplayed?.();
      }
    });
  }, [supabase, router, user, isLoading, onNotDisplayed]);

  // Cancel One Tap when component unmounts or user logs in
  useEffect(() => {
    return () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.cancel();
      }
    };
  }, []);

  // Don't render anything if user is logged in
  if (user) return null;

  return (
    <Script
      src="https://accounts.google.com/gsi/client"
      onReady={() => {
        initializeOneTap();
      }}
      strategy="afterInteractive"
    />
  );
}
