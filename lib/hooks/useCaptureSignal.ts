'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';

export type SignalType = 'favorite' | 'hide';

/**
 * Records a heart or hide for the signed-in person's For You list. Resolves to
 * whether it was saved; signed-out people are skipped.
 */
export function useCaptureSignal(): (eventId: string, signalType: SignalType) => Promise<boolean> {
  const { user, isLoading } = useAuth();
  // Read through refs so a call made while auth is still loading sees the settled value
  const isLoggedInRef = useRef(!!user);
  const authLoadingRef = useRef(isLoading);
  useEffect(() => {
    isLoggedInRef.current = !!user;
    authLoadingRef.current = isLoading;
  }, [user, isLoading]);

  return useCallback(async (eventId: string, signalType: SignalType) => {
    // Wait (bounded) for auth to settle
    const deadline = Date.now() + 2000;
    while (authLoadingRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!isLoggedInRef.current) return false;

    try {
      const response = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, signalType }),
      });
      if (!response.ok) {
        console.error('[Signal] API error:', response.status);
        return false;
      }
      return true;
    } catch (error) {
      console.error('[Signal] Network error:', error);
      return false;
    }
  }, []);
}
