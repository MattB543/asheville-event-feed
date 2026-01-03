import { createClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client with service role key.
 * This client bypasses RLS and can access admin functions.
 * Only use on the server side!
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Supabase service credentials not configured');
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
