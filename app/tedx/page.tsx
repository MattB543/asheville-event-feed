import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { matchingProfiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ArrowRight, Users } from 'lucide-react';

export const metadata: Metadata = {
  title: 'TEDx Matching | AVL GO',
  description: 'Create your matching profile for the TEDx Asheville attendee pilot.',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function TedxLandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    try {
      const [result] = await db
        .select()
        .from(matchingProfiles)
        .where(eq(matchingProfiles.userId, user.id))
        .limit(1);
      profile = result ?? null;
    } catch {
      // Matching profiles table may not exist yet — silently continue
      profile = null;
    }
  }

  const ctaHref = user ? '/tedx/onboarding' : '/login?next=/tedx/onboarding';
  let ctaLabel = 'Start profile matching';
  if (profile?.status === 'submitted') {
    ctaLabel = 'View your submitted profile';
  } else if (profile) {
    ctaLabel = 'Continue your profile';
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />
      <div className="flex-1 px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-800 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="icon-circle">
                <Users className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  TEDx Asheville Matching
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Help us match you with other attendees for meaningful conversations.
                </p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-gray-600 dark:text-gray-400">
              <p>
                This is a private pilot flow. You will create an AVL GO account, answer a short
                survey, and opt in to having your profile analyzed for matching.
              </p>
              <p>
                Your answers are used only for this matching experiment. You can view your
                submission afterward, but edits require support.
              </p>
            </div>

            <div className="mt-8">
              <Link
                href={ctaHref}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors"
              >
                {ctaLabel}
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
