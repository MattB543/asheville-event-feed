/**
 * Shared lookup of Supabase auth-user contact details for the email crons.
 *
 * `supabase.auth.admin.listUsers` is paginated. Calling it once with
 * perPage: 1000 silently drops everyone past the first page, so any subscriber
 * beyond user #1000 never receives mail. This helper pages until exhausted.
 */

import { createServiceClient } from './service';

export interface AuthUserContact {
  email: string;
  name?: string;
}

export interface AuthUserContactsResult {
  /** userId -> contact, for every auth user that has an email address */
  contacts: Map<string, AuthUserContact>;
  /** Total auth users seen across all pages (including those without email) */
  totalUsers: number;
  /** Non-null when listing failed; `contacts` then holds whatever was fetched */
  error: Error | null;
}

/** Supabase caps perPage at 1000. */
const PAGE_SIZE = 1000;

/** Guard against an unexpected non-terminating pagination loop. */
const MAX_PAGES = 50;

function extractName(metadata: unknown): string | undefined {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const record = metadata as Record<string, unknown>;
  if (typeof record.full_name === 'string') return record.full_name;
  if (typeof record.name === 'string') return record.name;
  return undefined;
}

/**
 * Fetch every auth user's email and display name, paging through listUsers.
 *
 * @param client - Optional service client to reuse (one is created otherwise)
 * @param userIds - Optional filter; only these user IDs end up in the map
 */
export async function listAuthUserContacts(
  client?: ReturnType<typeof createServiceClient>,
  userIds?: Iterable<string>
): Promise<AuthUserContactsResult> {
  const supabase = client ?? createServiceClient();
  const wanted = userIds ? new Set(userIds) : null;

  const contacts = new Map<string, AuthUserContact>();
  let totalUsers = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });

    if (error) {
      return {
        contacts,
        totalUsers,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }

    const users = data?.users ?? [];
    totalUsers += users.length;

    for (const user of users) {
      if (!user.email) continue;
      if (wanted && !wanted.has(user.id)) continue;
      contacts.set(user.id, { email: user.email, name: extractName(user.user_metadata) });
    }

    // Last page reached
    if (users.length < PAGE_SIZE) {
      return { contacts, totalUsers, error: null };
    }
  }

  return {
    contacts,
    totalUsers,
    error: new Error(`listUsers exceeded ${MAX_PAGES} pages; results are truncated`),
  };
}
