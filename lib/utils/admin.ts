/**
 * The one admin level: everyone in SUPER_ADMIN (comma-separated Supabase auth user IDs) gets
 * every admin tool.
 */

import { env } from '@/lib/config/env';

/**
 * Server-only: SUPER_ADMIN is not NEXT_PUBLIC_, so it is stripped from client bundles and this
 * would silently return false there. Compute the flag on the server and pass it down.
 */
export function isAdmin(userId: string | undefined | null): boolean {
  if (!userId) return false;
  return (env.SUPER_ADMIN ?? '')
    .split(',')
    .map((id) => id.trim())
    .includes(userId);
}
