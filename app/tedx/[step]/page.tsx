import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Header from '@/components/Header';
import MatchingOnboardingClient from '@/components/matching/MatchingOnboardingClient';
import { createClient } from '@/lib/supabase/server';
import { getDefaultDisplayName } from '@/lib/matching/utils';
import { getMatchingFlowPath, isMatchingFlowStep } from '@/lib/matching/flow';

interface TedxStepPageProps {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const titleByStep: Record<string, string> = {
  intro: 'TEDx Matching Intro | AVL GO',
  consent: 'TEDx Matching Consent | AVL GO',
  context: 'TEDx Matching Context | AVL GO',
  questions: 'TEDx Matching Questions | AVL GO',
  confirmation: 'TEDx Matching Confirmation | AVL GO',
};

export async function generateMetadata({ params }: TedxStepPageProps): Promise<Metadata> {
  const { step } = await params;
  const resolvedTitle = titleByStep[step] || 'TEDx Matching | AVL GO';

  return {
    title: resolvedTitle,
    description: 'TEDxAsheville attendee matching setup flow.',
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function TedxStepPage({ params, searchParams }: TedxStepPageProps) {
  const [{ step }, query] = await Promise.all([params, searchParams]);

  if (!isMatchingFlowStep(step)) {
    redirect('/tedx/intro');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(getMatchingFlowPath(step))}`);
  }

  const rawSource = query.from;
  const entrySource =
    typeof rawSource === 'string' && rawSource.trim() ? rawSource.trim().slice(0, 80) : null;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Header />
      <div className="flex-1 px-4 py-10">
        <div className="max-w-3xl mx-auto">
          <MatchingOnboardingClient
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
