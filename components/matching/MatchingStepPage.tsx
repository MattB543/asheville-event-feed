import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import MatchingOnboardingClient from '@/components/matching/MatchingOnboardingClient';
import { createClient } from '@/lib/supabase/server';
import { getDefaultDisplayName } from '@/lib/matching/utils';
import { getMatchingFlowPath, isMatchingFlowStep } from '@/lib/matching/flow';
import type { MatchingProgram } from '@/lib/matching/programs';

interface MatchingStepPageProps {
  program: MatchingProgram;
  step: string;
  searchParams: { [key: string]: string | string[] | undefined };
}

export default async function MatchingStepPage({
  program,
  step,
  searchParams,
}: MatchingStepPageProps) {
  if (!isMatchingFlowStep(step)) {
    redirect(getMatchingFlowPath('intro', program));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(getMatchingFlowPath(step, program))}`);
  }

  const rawSource = searchParams.from;
  const entrySource =
    typeof rawSource === 'string' && rawSource.trim() ? rawSource.trim().slice(0, 80) : null;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />
      <div className="flex-1 pt-4 sm:px-4 sm:py-10">
        <div className="max-w-3xl mx-auto">
          <MatchingOnboardingClient
            program={program}
            currentStep={step}
            defaultDisplayName={getDefaultDisplayName(user)}
            defaultEmail={user.email ?? null}
            entrySource={entrySource}
          />
        </div>
      </div>
    </main>
  );
}
