import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  matchingEnrichmentItems,
  matchingProfileCards,
  matchingProfileReports,
  matchingTopMatches,
} from '@/lib/db/schema';
import type { CohortAudit, NormalizedTedxProfile } from '@/lib/matching/pipeline/types';

function toCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function readMatches(matchesJson: unknown): Array<Record<string, unknown>> {
  if (!matchesJson || typeof matchesJson !== 'object') return [];
  const obj = matchesJson as Record<string, unknown>;
  if (!Array.isArray(obj.matches)) return [];
  return obj.matches.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === 'object'
  );
}

export async function writeRunExports(args: {
  runId: string;
  outputDir: string;
  cohort: NormalizedTedxProfile[];
  audit: CohortAudit;
}): Promise<string> {
  const runDir = path.join(args.outputDir, args.runId);
  await mkdir(runDir, { recursive: true });

  await writeFile(path.join(runDir, 'cohort.json'), JSON.stringify(args.cohort, null, 2), 'utf-8');
  await writeFile(path.join(runDir, 'cohort-audit.json'), JSON.stringify(args.audit, null, 2), 'utf-8');

  const enrichmentSummary = await db
    .select({
      provider: matchingEnrichmentItems.provider,
      status: matchingEnrichmentItems.status,
      count: sql<number>`count(*)::int`,
    })
    .from(matchingEnrichmentItems)
    .where(eq(matchingEnrichmentItems.runId, args.runId))
    .groupBy(matchingEnrichmentItems.provider, matchingEnrichmentItems.status);

  await writeFile(
    path.join(runDir, 'enrichment-status.json'),
    JSON.stringify(enrichmentSummary, null, 2),
    'utf-8'
  );

  const cards = await db
    .select({
      profileId: matchingProfileCards.profileId,
      sourceSurveyUpdatedAt: matchingProfileCards.sourceSurveyUpdatedAt,
      cardJson: matchingProfileCards.cardJson,
      cardText: matchingProfileCards.cardText,
      model: matchingProfileCards.model,
      promptVersion: matchingProfileCards.promptVersion,
    })
    .from(matchingProfileCards)
    .where(eq(matchingProfileCards.runId, args.runId));

  await writeFile(path.join(runDir, 'profile-cards.json'), JSON.stringify(cards, null, 2), 'utf-8');

  const profileReports = await db
    .select({
      profileId: matchingProfileReports.profileId,
      sourceSurveyUpdatedAt: matchingProfileReports.sourceSurveyUpdatedAt,
      reportJson: matchingProfileReports.reportJson,
      reportText: matchingProfileReports.reportText,
      model: matchingProfileReports.model,
      promptVersion: matchingProfileReports.promptVersion,
    })
    .from(matchingProfileReports)
    .where(eq(matchingProfileReports.runId, args.runId));

  await writeFile(
    path.join(runDir, 'profile-reports.json'),
    JSON.stringify(profileReports, null, 2),
    'utf-8'
  );

  const profileById = new Map(
    args.cohort.map((profile) => [
      profile.profileId,
      {
        userId: profile.userId,
        displayName: profile.displayName,
        email: profile.email,
      },
    ])
  );

  const topMatches = await db
    .select({
      profileId: matchingTopMatches.profileId,
      matchesJson: matchingTopMatches.matchesJson,
      model: matchingTopMatches.model,
      promptVersion: matchingTopMatches.promptVersion,
    })
    .from(matchingTopMatches)
    .where(eq(matchingTopMatches.runId, args.runId));

  await writeFile(path.join(runDir, 'matches.json'), JSON.stringify(topMatches, null, 2), 'utf-8');

  const csvLines: string[] = [];
  csvLines.push(
    [
      'target_profile_id',
      'target_user_uid',
      'target_name',
      'rank',
      'match_profile_id',
      'match_user_uid',
      'match_name',
      'why_match',
      'mutual_value',
      'conversation_starter',
      'confidence',
    ].join(',')
  );

  const markdownLines: string[] = [];
  markdownLines.push('# TEDx Matching Results');
  markdownLines.push('');
  markdownLines.push(`Run ID: \`${args.runId}\``);
  markdownLines.push('');

  for (const row of topMatches) {
    const targetProfile = profileById.get(row.profileId);
    const targetName = targetProfile?.displayName || 'TEDx Attendee';

    markdownLines.push(`## ${targetName}`);
    markdownLines.push('');

    const matches = readMatches(row.matchesJson);
    for (const match of matches) {
      const rank = typeof match.rank === 'number' ? match.rank : 0;
      const matchProfileId =
        typeof match.profile_id === 'string' ? match.profile_id : typeof match.profileId === 'string' ? match.profileId : '';
      const matchProfile = profileById.get(matchProfileId);
      const matchName =
        (typeof match.name === 'string' && match.name) || matchProfile?.displayName || 'TEDx Attendee';
      const whyMatch = typeof match.why_match === 'string' ? match.why_match : '';
      const mutualValue = typeof match.mutual_value === 'string' ? match.mutual_value : '';
      const conversationStarter =
        typeof match.conversation_starter === 'string' ? match.conversation_starter : '';
      const confidence =
        typeof match.confidence === 'number'
          ? match.confidence
          : typeof match.confidence === 'string'
            ? Number(match.confidence)
            : '';

      csvLines.push(
        [
          toCsvCell(row.profileId),
          toCsvCell(targetProfile?.userId || ''),
          toCsvCell(targetName),
          toCsvCell(rank),
          toCsvCell(matchProfileId),
          toCsvCell(matchProfile?.userId || ''),
          toCsvCell(matchName),
          toCsvCell(whyMatch),
          toCsvCell(mutualValue),
          toCsvCell(conversationStarter),
          toCsvCell(confidence),
        ].join(',')
      );

      markdownLines.push(`### #${rank}. ${matchName}`);
      markdownLines.push(`- **Why:** ${whyMatch}`);
      markdownLines.push(`- **Mutual value:** ${mutualValue}`);
      markdownLines.push(`- **Conversation starter:** ${conversationStarter}`);
      markdownLines.push('');
    }
  }

  await writeFile(path.join(runDir, 'matches.csv'), csvLines.join('\n'), 'utf-8');
  await writeFile(path.join(runDir, 'matches.md'), markdownLines.join('\n'), 'utf-8');

  return runDir;
}
