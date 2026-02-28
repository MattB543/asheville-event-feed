import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  matchingEnrichmentItems,
  matchingProfileCards,
  matchingProfiles,
  matchingRuns,
} from '@/lib/db/schema';
import { writeRunExports } from '@/lib/matching/pipeline/export';
import { dispatchClayLinkedinJobs, processJinaEnrichment, seedEnrichmentItems, waitForClayResults } from '@/lib/matching/pipeline/enrichment';
import { generateTopMatches } from '@/lib/matching/pipeline/match';
import { loadSubmittedCohort } from '@/lib/matching/pipeline/normalize';
import { buildProfileCards } from '@/lib/matching/pipeline/synthesize';
import type {
  CandidateCard,
  CohortAudit,
  MatchingRunStatus,
  PipelineCliOptions,
} from '@/lib/matching/pipeline/types';

const stageOrder = {
  enrich: 1,
  synthesize: 2,
  match: 3,
  export: 4,
} as const;

function shouldRun(fromStage: keyof typeof stageOrder, currentStage: keyof typeof stageOrder): boolean {
  return stageOrder[currentStage] >= stageOrder[fromStage];
}

async function updateRunStatus(runId: string, status: MatchingRunStatus) {
  const now = new Date();
  await db
    .update(matchingRuns)
    .set({
      status,
      completedAt: status === 'completed' || status === 'failed' || status === 'interrupted' ? now : null,
      updatedAt: now,
    })
    .where(eq(matchingRuns.id, runId));
}

async function createRun(options: PipelineCliOptions): Promise<string> {
  const now = new Date();
  const [run] = await db
    .insert(matchingRuns)
    .values({
      program: options.program,
      cohortLabel: options.runLabel,
      status: 'created',
      configJson: {
        fromStage: options.fromStage,
        skipClay: options.skipClay,
        skipJina: options.skipJina,
        dryRun: options.dryRun,
        cohortFile: options.cohortFile,
        clayWaitMinutes: options.clayWaitMinutes,
      },
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: matchingRuns.id });

  return run.id;
}

async function markProviderSkipped(runId: string, provider: 'clay' | 'jina', reason: string) {
  await db
    .update(matchingEnrichmentItems)
    .set({
      status: 'skipped',
      errorText: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(matchingEnrichmentItems.runId, runId),
        eq(matchingEnrichmentItems.provider, provider),
        eq(matchingEnrichmentItems.status, 'pending')
      )
    );
}

async function loadCardsForRun(runId: string): Promise<CandidateCard[]> {
  const rows = await db
    .select({
      profileId: matchingProfileCards.profileId,
      cardText: matchingProfileCards.cardText,
      displayName: matchingProfiles.displayName,
      email: matchingProfiles.email,
    })
    .from(matchingProfileCards)
    .innerJoin(matchingProfiles, eq(matchingProfileCards.profileId, matchingProfiles.id))
    .where(eq(matchingProfileCards.runId, runId));

  return rows.map((row) => ({
    profileId: row.profileId,
    cardText: row.cardText,
    name: row.displayName || row.email?.split('@')[0] || 'TEDx Attendee',
  }));
}

export async function runTedxMatchingPipeline(
  options: PipelineCliOptions,
  onRunId?: (runId: string) => void
): Promise<{
  runId: string;
  exportDir: string | null;
  profileCount: number;
  cohortAudit: CohortAudit;
  matchSummary: { completed: number; failed: number } | null;
}> {
  const runId = options.dryRun ? options.runId ?? 'dry-run' : options.runId ?? (await createRun(options));
  onRunId?.(runId);
  let exportDir: string | null = null;

  try {
    const { profiles: cohort, audit: cohortAudit } = await loadSubmittedCohort(
      options.program,
      options.cohortFile
    );
    if (cohort.length < 2) {
      throw new Error(`Need at least 2 submitted profiles for matching. Found: ${cohort.length}`);
    }

    if (options.dryRun) {
      return {
        runId,
        exportDir: null,
        profileCount: cohort.length,
        cohortAudit,
        matchSummary: null,
      };
    }

    if (shouldRun(options.fromStage, 'enrich')) {
      await updateRunStatus(runId, 'enriching');
      await seedEnrichmentItems(runId, cohort);

      if (options.skipClay) {
        await markProviderSkipped(runId, 'clay', 'Skipped by --skip-clay flag');
      } else {
        await dispatchClayLinkedinJobs(runId);
        await waitForClayResults(runId, options.clayWaitMinutes);
      }

      if (options.skipJina) {
        await markProviderSkipped(runId, 'jina', 'Skipped by --skip-jina flag');
      } else {
        await processJinaEnrichment(runId);
      }
    }

    let cards: CandidateCard[] = [];
    if (shouldRun(options.fromStage, 'synthesize')) {
      await updateRunStatus(runId, 'synthesizing');
      cards = await buildProfileCards(runId, cohort);
    } else {
      cards = await loadCardsForRun(runId);
    }

    let matchSummary: { completed: number; failed: number } | null = null;
    if (shouldRun(options.fromStage, 'match')) {
      if (cards.length < 2) {
        throw new Error('Cannot run match stage without profile cards. Run synthesize stage first.');
      }
      await updateRunStatus(runId, 'matching');
      matchSummary = await generateTopMatches(runId, cards);
    }

    if (shouldRun(options.fromStage, 'export')) {
      await updateRunStatus(runId, 'exporting');
      exportDir = await writeRunExports({
        runId,
        outputDir: options.outputDir,
        cohort,
        audit: cohortAudit,
      });
    }

    await updateRunStatus(runId, 'completed');
    return {
      runId,
      exportDir,
      profileCount: cohort.length,
      cohortAudit,
      matchSummary,
    };
  } catch (error) {
    if (!options.dryRun) {
      await updateRunStatus(runId, 'failed');
    }
    throw error;
  }
}

export async function markRunInterrupted(runId: string): Promise<void> {
  if (runId === 'dry-run') return;
  await updateRunStatus(runId, 'interrupted');
}
