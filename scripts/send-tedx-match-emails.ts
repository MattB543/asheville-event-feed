import 'dotenv/config';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { matchingProfiles, matchingRuns, matchingTopMatches } from '../lib/db/schema';
import { sendEmail } from '../lib/notifications/postmark';
import {
  generateTedxMatchesEmailHtml,
  generateTedxMatchesEmailText,
} from '../lib/notifications/matching-email-templates';

const MATCHES_TO_SHOW = 5;

type CliOptions = {
  program: string;
  runId: string | null;
  profileId: string | null;
  toEmail: string | null;
  dryRun: boolean;
};

type MatchEmailEntry = {
  name: string;
  whyMatch: string;
  conversationStarter: string;
  rank: number;
};

function parseArgs(argv: string[]): CliOptions {
  const getValue = (flag: string): string | null => {
    const idx = argv.findIndex((arg) => arg === flag);
    if (idx < 0 || idx + 1 >= argv.length) return null;
    return argv[idx + 1] ?? null;
  };
  const hasFlag = (flag: string): boolean => argv.includes(flag);

  const options: CliOptions = {
    program: getValue('--program') ?? 'tedx',
    runId: getValue('--run-id'),
    profileId: getValue('--profile-id'),
    toEmail: getValue('--to-email'),
    dryRun: hasFlag('--dry-run'),
  };

  if (options.toEmail && !options.profileId) {
    throw new Error('--to-email requires --profile-id');
  }

  return options;
}

function readMatches(matchesJson: unknown): MatchEmailEntry[] {
  if (!matchesJson || typeof matchesJson !== 'object') return [];
  const obj = matchesJson as Record<string, unknown>;
  if (!Array.isArray(obj.matches)) return [];

  const parsed: MatchEmailEntry[] = [];
  for (const item of obj.matches) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : 'TEDx Attendee';
    const whyMatch =
      typeof row.why_match === 'string' && row.why_match.trim()
        ? row.why_match.trim()
        : 'You seem likely to have a strong conversation based on your overall interests and style.';
    const conversationStarter =
      typeof row.conversation_starter === 'string' && row.conversation_starter.trim()
        ? row.conversation_starter.trim()
        : 'What are you most excited to explore at TEDx Asheville this year?';
    const rank =
      typeof row.rank === 'number' && Number.isFinite(row.rank) ? row.rank : parsed.length + 1;
    parsed.push({ name, whyMatch, conversationStarter, rank });
  }

  return parsed.sort((a, b) => a.rank - b.rank).slice(0, MATCHES_TO_SHOW);
}

async function resolveRunId(options: CliOptions): Promise<string> {
  if (options.runId) return options.runId;

  const [latest] = await db
    .select({
      id: matchingRuns.id,
    })
    .from(matchingRuns)
    .innerJoin(matchingTopMatches, eq(matchingRuns.id, matchingTopMatches.runId))
    .where(and(eq(matchingRuns.program, options.program), eq(matchingRuns.status, 'completed')))
    .groupBy(matchingRuns.id, matchingRuns.startedAt)
    .orderBy(desc(matchingRuns.startedAt))
    .limit(1);

  if (!latest) {
    throw new Error(`No completed run with matches found for program "${options.program}"`);
  }

  return latest.id;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = await resolveRunId(options);

  const rows = await db
    .select({
      profileId: matchingTopMatches.profileId,
      matchesJson: matchingTopMatches.matchesJson,
      displayName: matchingProfiles.displayName,
      email: matchingProfiles.email,
    })
    .from(matchingTopMatches)
    .innerJoin(matchingProfiles, eq(matchingTopMatches.profileId, matchingProfiles.id))
    .where(
      and(
        eq(matchingTopMatches.runId, runId),
        ...(options.profileId ? [eq(matchingTopMatches.profileId, options.profileId)] : [])
      )
    );

  if (rows.length === 0) {
    throw new Error(`No match rows found for run ${runId}`);
  }

  let attempted = 0;
  let sent = 0;
  let skippedNoEmail = 0;

  for (const row of rows) {
    const matches = readMatches(row.matchesJson);
    if (matches.length === 0) {
      console.warn(`[Match Email] Skipping ${row.profileId}: no parsed matches`);
      continue;
    }

    const to = options.toEmail || row.email;
    if (!to) {
      skippedNoEmail += 1;
      console.warn(`[Match Email] Skipping ${row.profileId}: missing recipient email`);
      continue;
    }

    const subject = 'Your TEDx Asheville Top 5 Matches';
    const htmlBody = generateTedxMatchesEmailHtml({
      recipientName: row.displayName,
      matches,
    });
    const textBody = generateTedxMatchesEmailText({
      recipientName: row.displayName,
      matches,
    });

    attempted += 1;

    if (options.dryRun) {
      console.log(`[Match Email] DRY RUN -> ${to} (${row.profileId})`);
      continue;
    }

    const ok = await sendEmail({
      to,
      subject,
      htmlBody,
      textBody,
    });
    if (ok) {
      sent += 1;
      console.log(`[Match Email] Sent to ${to} (${row.profileId})`);
    } else {
      console.error(`[Match Email] Failed to send to ${to} (${row.profileId})`);
    }
  }

  console.log('\n[Match Email] Summary');
  console.log(`Run ID: ${runId}`);
  console.log(`Rows loaded: ${rows.length}`);
  console.log(`Attempted: ${attempted}`);
  console.log(`Sent: ${sent}`);
  console.log(`Skipped (no email): ${skippedNoEmail}`);

  process.exit(0);
}

main().catch((error) => {
  console.error('[Match Email] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
