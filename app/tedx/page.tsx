import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Users } from 'lucide-react';
import { eq } from 'drizzle-orm';
import Header from '@/components/Header';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { matchingAnswers, matchingProfiles } from '@/lib/db/schema';
import { getLatestQuestions } from '@/lib/matching/utils';
import {
  getMatchingFlowPath,
  inferMatchingFlowStep,
  type MatchingFlowStep,
} from '@/lib/matching/flow';

export const metadata: Metadata = {
  title: 'TEDx Matching | AVL GO',
  description: 'Find your people at TEDxAsheville.',
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

  let nextStep: MatchingFlowStep = 'intro';
  const ctaLabel = 'Get Started';

  if (user) {
    try {
      const [profile] = await db
        .select()
        .from(matchingProfiles)
        .where(eq(matchingProfiles.userId, user.id))
        .limit(1);

      if (profile) {
        const answers = await db
          .select({ questionId: matchingAnswers.questionId })
          .from(matchingAnswers)
          .where(eq(matchingAnswers.profileId, profile.id));
        const { questions } = await getLatestQuestions(profile.program);
        const surveyQuestionIds = questions
          .filter((question) => question.section === 'survey')
          .map((question) => question.id);

        nextStep = inferMatchingFlowStep({ profile, answers, surveyQuestionIds });
      }
    } catch {
      // Matching tables may not exist yet in some environments.
      nextStep = 'intro';
    }
  }

  if (user) {
    const redirectPath =
      nextStep === 'intro' ? '/tedx/intro?from=tedx_landing' : getMatchingFlowPath(nextStep);
    redirect(redirectPath);
  }

  const loggedOutNext = encodeURIComponent('/tedx/intro?from=tedx_landing');
  const ctaHref = `/login?next=${loggedOutNext}`;

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
                  Find Your People at TEDxAsheville
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Get matched with the attendees you&apos;ll actually want to meet.
                </p>
              </div>
            </div>

            <div className="space-y-4 text-md text-gray-600 dark:text-gray-400">
              <p>
                This private pilot helps attendees discover stronger 1:1 conversations before the
                event.
              </p>
              <p>
                Share as much or as little as you want, but the more you share, the better your
                matches will be!
              </p>
              <p>
                Your specific answers stay private. We only use your data to build better match
                recommendations.
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
