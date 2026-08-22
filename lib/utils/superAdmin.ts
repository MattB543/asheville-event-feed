/**
 * Super admin utilities for checking admin status.
 * Super admin is identified by the SUPER_ADMIN environment variable.
 */

import { env } from '@/lib/config/env';

/**
 * Check if a user ID matches the super admin.
 *
 * Server-only: SUPER_ADMIN is not a NEXT_PUBLIC_ variable, so it is stripped
 * from client bundles and this would silently return false there. Compute the
 * flag on the server and pass the result down if a client component needs it.
 */
export function isSuperAdmin(userId: string | undefined | null): boolean {
  if (!userId) return false;
  const superAdminId = env.SUPER_ADMIN;
  return !!superAdminId && userId === superAdminId;
}
