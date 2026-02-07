export const MATCHING_FLOW_STEPS = [
  'intro',
  'consent',
  'context',
  'questions',
  'confirmation',
] as const;

export type MatchingFlowStep = (typeof MATCHING_FLOW_STEPS)[number];

export function isMatchingFlowStep(value: string): value is MatchingFlowStep {
  return MATCHING_FLOW_STEPS.includes(value as MatchingFlowStep);
}

export function getMatchingFlowPath(step: MatchingFlowStep): string {
  return `/tedx/${step}`;
}

interface FlowProfileLike {
  displayName: string | null;
  aiMatching: boolean;
  status: string;
}

interface FlowAnswerLike {
  questionId: string;
}

export function inferMatchingFlowStep(args: {
  profile: FlowProfileLike | null;
  answers: FlowAnswerLike[];
  surveyQuestionIds: string[];
}): MatchingFlowStep {
  const { profile, answers, surveyQuestionIds } = args;

  if (!profile) return 'intro';

  const hasConsent = Boolean(profile.displayName?.trim()) && profile.aiMatching;
  if (!hasConsent) return 'consent';

  if (profile.status === 'submitted') return 'confirmation';

  const answerIds = new Set(answers.map((answer) => answer.questionId));
  const hasSurveyAnswer = surveyQuestionIds.some((questionId) => answerIds.has(questionId));

  return hasSurveyAnswer ? 'questions' : 'context';
}
