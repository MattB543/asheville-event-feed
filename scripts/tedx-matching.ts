import 'dotenv/config';
import path from 'path';
import { markRunInterrupted, runTedxMatchingPipeline } from '../lib/matching/pipeline/run';
import type { PipelineCliOptions, PipelineStage } from '../lib/matching/pipeline/types';

function parseArgs(argv: string[]): PipelineCliOptions {
  const getValue = (flag: string): string | null => {
    const idx = argv.findIndex((arg) => arg === flag);
    if (idx < 0 || idx + 1 >= argv.length) return null;
    return argv[idx + 1] ?? null;
  };

  const hasFlag = (flag: string): boolean => argv.includes(flag);

  const fromStageRaw = getValue('--from-stage') ?? 'enrich';
  const allowedStages: PipelineStage[] = ['enrich', 'synthesize', 'match', 'export'];
  if (!allowedStages.includes(fromStageRaw as PipelineStage)) {
    throw new Error(
      `Invalid --from-stage value "${fromStageRaw}". Allowed: ${allowedStages.join(', ')}`
    );
  }

  const clayWaitRaw = getValue('--clay-wait-minutes');
  const clayWaitMinutes = clayWaitRaw ? Number(clayWaitRaw) : 30;
  if (!Number.isFinite(clayWaitMinutes) || clayWaitMinutes <= 0) {
    throw new Error('Invalid --clay-wait-minutes value');
  }

  return {
    program: getValue('--program') ?? 'tedx',
    runLabel: getValue('--run-label'),
    runId: getValue('--run-id'),
    cohortFile: getValue('--cohort-file'),
    fromStage: fromStageRaw as PipelineStage,
    skipClay: hasFlag('--skip-clay'),
    skipJina: hasFlag('--skip-jina'),
    dryRun: hasFlag('--dry-run'),
    clayWaitMinutes,
    outputDir: getValue('--output-dir') ?? path.join(process.cwd(), 'exports', 'tedx-matching'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let activeRunId: string | null = options.runId ?? null;

  const handleInterrupt = async (signal: NodeJS.Signals) => {
    console.log(`\n[TEDx Matching] Received ${signal}, shutting down...`);
    if (activeRunId) {
      try {
        await markRunInterrupted(activeRunId);
        console.log(`[TEDx Matching] Marked run ${activeRunId} as interrupted`);
      } catch (error) {
        console.error('[TEDx Matching] Failed to mark run interrupted:', error);
      }
    }
    process.exit(130);
  };

  process.once('SIGINT', () => {
    void handleInterrupt('SIGINT');
  });
  process.once('SIGTERM', () => {
    void handleInterrupt('SIGTERM');
  });

  console.log('[TEDx Matching] Starting run with options:');
  console.log(JSON.stringify(options, null, 2));

  const result = await runTedxMatchingPipeline(options, (runId) => {
    activeRunId = runId;
    console.log(`[TEDx Matching] Run ID: ${runId}`);
  });

  console.log('\n[TEDx Matching] Completed successfully');
  console.log(`Run ID: ${result.runId}`);
  console.log(`Profiles processed: ${result.profileCount}`);
  console.log('Cohort audit:');
  console.log(JSON.stringify(result.cohortAudit, null, 2));
  if (result.matchSummary) {
    console.log(
      `Match sets generated via AI: ${result.matchSummary.completed} (hard failures: ${result.matchSummary.failed})`
    );
  }
  if (result.exportDir) {
    console.log(`Exports: ${result.exportDir}`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('[TEDx Matching] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
