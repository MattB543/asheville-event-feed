import type { Metadata } from 'next';
import MatchingStepPage from '@/components/matching/MatchingStepPage';
import { getMatchingProgramConfig } from '@/lib/matching/programs';

interface VibeStepPageProps {
  params: Promise<{ step: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const config = getMatchingProgramConfig('vibe');

const titleByStep: Record<string, string> = {
  intro: `${config.flowPageTitlePrefix} Intro | AVL GO`,
  consent: `${config.flowPageTitlePrefix} Consent | AVL GO`,
  context: `${config.flowPageTitlePrefix} Context | AVL GO`,
  questions: `${config.flowPageTitlePrefix} Questions | AVL GO`,
  confirmation: `${config.flowPageTitlePrefix} Confirmation | AVL GO`,
};

export async function generateMetadata({ params }: VibeStepPageProps): Promise<Metadata> {
  const { step } = await params;

  return {
    title: titleByStep[step] || `${config.flowPageTitlePrefix} | AVL GO`,
    description: config.flowPageDescription,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function VibeStepRoute({ params, searchParams }: VibeStepPageProps) {
  const [{ step }, query] = await Promise.all([params, searchParams]);
  return <MatchingStepPage program="vibe" step={step} searchParams={query} />;
}
