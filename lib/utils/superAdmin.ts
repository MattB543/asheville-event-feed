/**
 * Super admin utilities for checking admin status.
 * Super admin is identified by the SUPER_ADMIN environment variable.
 */

/**
 * Check if a user ID matches the super admin.
 * Works on both server and client (when userId is passed from server).
 */
export function isSuperAdmin(userId: string | undefined | null): boolean {
  if (!userId) return false;
  const superAdminId = process.env.SUPER_ADMIN;
  return !!superAdminId && userId === superAdminId;
}
