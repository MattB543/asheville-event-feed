export type MatchingRunStatus =
  | 'created'
  | 'enriching'
  | 'synthesizing'
  | 'matching'
  | 'exporting'
  | 'completed'
  | 'failed'
  | 'interrupted';

export type PipelineStage = 'enrich' | 'synthesize' | 'match' | 'export';

export interface PipelineCliOptions {
  program: string;
  runLabel: string | null;
  runId: string | null;
  cohortFile: string | null;
  fromStage: PipelineStage;
  skipClay: boolean;
  skipJina: boolean;
  dryRun: boolean;
  clayWaitMinutes: number;
  outputDir: string;
}

export interface CohortFilter {
  userIds: Set<string>;
  emails: Set<string>;
  rowCount: number;
  duplicateCount: number;
}

export interface CohortAudit {
  totalSubmitted: number;
  included: number;
  excludedNoRosterMatch: number;
  rosterProvided: boolean;
  rosterRowCount: number;
  rosterDuplicateCount: number;
  rosterUniqueUserIds: number;
  rosterUniqueEmails: number;
  rosterUnmatchedUserIds: number;
  rosterUnmatchedEmails: number;
}

export interface AnswerRowShape {
  questionId: string;
  answerText: string | null;
  answerJson: unknown;
  updatedAt: Date | null;
}

export interface NormalizedTedxProfile {
  profileId: string;
  userId: string;
  displayName: string;
  email: string | null;
  surveyUpdatedAt: Date | null;
  resumeMarkdown: string | null;
  surveyAnswers: Record<string, string>;
  linksAboutYou: string[];
  linksAboutTopicsRaw: string[];
  linkedinUrls: string[];
  githubUrls: string[];
  webUrls: string[];
  topicTexts: string[];
}

export interface CandidateCard {
  profileId: string;
  name: string;
  cardText: string;
}

export interface SynthesizedCardJson {
  identity_summary: string;
  current_focus: string[];
  core_interests: string[];
  can_offer: string[];
  seeking: string[];
  conversation_hooks: string[];
  watchouts: string[];
  card_text: string;
}

export interface SynthesizedProfileReportJson {
  identity_overview: string;
  personality_and_style: string[];
  career_arc: string[];
  current_focus: string[];
  core_interests: string[];
  expertise_and_strengths: string[];
  values_and_motivations: string[];
  communities: string[];
  offer_to_others: string[];
  seeking_from_others: string[];
  conversation_angles: string[];
  open_questions_or_unknowns: string[];
  evidence_highlights: Array<{ claim: string; evidence: string }>;
  report_text: string;
}

export interface MatchEntry {
  rank: number;
  profile_id: string;
  name: string;
  why_match: string;
  mutual_value: string;
  conversation_starter: string;
  confidence: number;
}
