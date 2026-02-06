import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import MatchingOnboardingClient from '@/components/matching/MatchingOnboardingClient';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'TEDx Matching Profile | AVL GO',
  description: 'Create your matching profile for the TEDx Asheville attendee pilot.',
  robots: {
    index: false,
    follow: false,
  },
};

function getDefaultDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}) {
  const metadata = user.user_metadata || {};
  const fullName =
    (typeof metadata.full_name === 'string' && metadata.full_name.trim()) ||
    (typeof metadata.name === 'string' && metadata.name.trim());
  if (fullName) return fullName;
  if (user.email) return user.email.split('@')[0];
  return 'AVL GO User';
}

export default async function TedxOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/tedx/onboarding');
  }

  const defaultDisplayName = getDefaultDisplayName({
    email: user.email,
    user_metadata: user.user_metadata as Record<string, unknown>,
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />
      <div className="flex-1 px-4 py-10">
        <div className="max-w-3xl mx-auto">
          <MatchingOnboardingClient
            defaultDisplayName={defaultDisplayName}
            defaultEmail={user.email ?? null}
          />
        </div>
      </div>
    </main>
  );
}
