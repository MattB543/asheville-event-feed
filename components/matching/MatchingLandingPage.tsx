import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Users } from 'lucide-react';
import { eq } from 'drizzle-orm';
import Header from '@/components/Header';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { matchingAnswers } from '@/lib/db/schema';
import {
  getMatchingFlowPath,
  inferMatchingFlowStep,
  type MatchingFlowStep,
} from '@/lib/matching/flow';
import { getMatchingProgramConfig, type MatchingProgram } from '@/lib/matching/programs';
import { getLatestQuestions, getMatchingProfileForUser } from '@/lib/matching/utils';

interface MatchingLandingPageProps {
  program: MatchingProgram;
}

export default async function MatchingLandingPage({ program }: MatchingLandingPageProps) {
  const config = getMatchingProgramConfig(program);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let nextStep: MatchingFlowStep = 'intro';
  const ctaLabel = 'Get Started';

  if (user) {
    try {
      const profile = await getMatchingProfileForUser(user.id, program);

      if (profile) {
        const answers = await db
          .select({ questionId: matchingAnswers.questionId })
          .from(matchingAnswers)
          .where(eq(matchingAnswers.profileId, profile.id));
        const { questions } = await getLatestQuestions(program);
        const surveyQuestionIds = questions
          .filter((question) => question.section === 'survey')
          .map((question) => question.id);

        nextStep = inferMatchingFlowStep({ profile, answers, surveyQuestionIds });
      }
    } catch {
      nextStep = 'intro';
    }
  }

  if (user) {
    const introPath = `${getMatchingFlowPath('intro', program)}?from=${config.landingSource}`;
    const redirectPath = nextStep === 'intro' ? introPath : getMatchingFlowPath(nextStep, program);
    redirect(redirectPath);
  }

  const loggedOutNext = encodeURIComponent(
    `${getMatchingFlowPath('intro', program)}?from=${config.landingSource}`
  );
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
                  {config.landingTitle}
                </h1>
                {config.landingEyebrow && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {config.landingEyebrow}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4 text-md text-gray-600 dark:text-gray-400">
              {config.landingBody.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
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
