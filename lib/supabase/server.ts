import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { isAuthConfigured } from './client';

type ServerClient = SupabaseClient;

// A local setup without Supabase keys runs signed-out: getUser finds nobody
const signedOutClient = {
  auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
} as unknown as ServerClient;

export async function createClient(): Promise<ServerClient> {
  if (!isAuthConfigured()) return signedOutClient;
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component where cookies can't be set
            // This is expected and can be safely ignored
          }
        },
      },
    }
  );
}
