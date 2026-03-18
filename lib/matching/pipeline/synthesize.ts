import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { matchingProfileCards, matchingProfileReports } from '@/lib/db/schema';
import { callAzureJson } from '@/lib/matching/pipeline/llm';
import { getAzureDeploymentName } from '@/lib/ai/provider-clients';
import { getEnrichmentSummaryByProfile } from '@/lib/matching/pipeline/enrichment';
import type {
  CandidateCard,
  NormalizedTedxProfile,
  SynthesizedCardJson,
  SynthesizedProfileReportJson,
} from '@/lib/matching/pipeline/types';

const PROFILE_REPORT_PROMPT_VERSION = 'tedx-profile-report-v1';
const CARD_PROMPT_VERSION = 'tedx-card-v2';
const CARD_MIN_WORDS = 120;
const CARD_MAX_WORDS = 220;
const REPORT_MIN_WORDS = 300;
const REPORT_MAX_WORDS = 1800;
const INPUT_SECTION_MAX_CHARS = 50_000;
const REPORT_TEXT_MAX_CHARS = 50_000;
const CARD_TEXT_MAX_CHARS = 2400;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim());
}

function asEvidenceHighlights(value: unknown): Array<{
  claim: string;
  evidence: string;
}> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ claim: string; evidence: string }> = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const claim = typeof row.claim === 'string' ? row.claim.trim() : '';
    const evidence = typeof row.evidence === 'string' ? row.evidence.trim() : '';
    if (!claim || !evidence) continue;
    out.push({ claim, evidence });
  }

  return out;
}

function clipText(value: string, maxChars = INPUT_SECTION_MAX_CHARS): string {
  return value.trim().slice(0, maxChars);
}

function isSameInstant(a: Date | null, b: Date | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

function sanitizeProfileReportJson(raw: unknown): SynthesizedProfileReportJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const reportText =
    (typeof obj.report_text === 'string' && obj.report_text.trim()) ||
    (typeof obj.reportText === 'string' && obj.reportText.trim()) ||
    '';
  if (!reportText) return null;

  return {
    identity_overview:
      (typeof obj.identity_overview === 'string' && obj.identity_overview.trim()) ||
      (typeof obj.identityOverview === 'string' && obj.identityOverview.trim()) ||
      '',
    personality_and_style: asStringArray(obj.personality_and_style ?? obj.personalityAndStyle),
    career_arc: asStringArray(obj.career_arc ?? obj.careerArc),
    current_focus: asStringArray(obj.current_focus ?? obj.currentFocus),
    core_interests: asStringArray(obj.core_interests ?? obj.coreInterests),
    expertise_and_strengths: asStringArray(
      obj.expertise_and_strengths ?? obj.expertiseAndStrengths
    ),
    values_and_motivations: asStringArray(obj.values_and_motivations ?? obj.valuesAndMotivations),
    communities: asStringArray(obj.communities),
    offer_to_others: asStringArray(obj.offer_to_others ?? obj.offerToOthers),
    seeking_from_others: asStringArray(obj.seeking_from_others ?? obj.seekingFromOthers),
    conversation_angles: asStringArray(obj.conversation_angles ?? obj.conversationAngles),
    open_questions_or_unknowns: asStringArray(
      obj.open_questions_or_unknowns ?? obj.openQuestionsOrUnknowns
    ),
    evidence_highlights: asEvidenceHighlights(obj.evidence_highlights ?? obj.evidenceHighlights),
    report_text: reportText,
  };
}

function sanitizeCardJson(raw: unknown): SynthesizedCardJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const cardText =
    (typeof obj.card_text === 'string' && obj.card_text.trim()) ||
    (typeof obj.cardText === 'string' && obj.cardText.trim()) ||
    '';
  if (!cardText) return null;

  return {
    identity_summary:
      (typeof obj.identity_summary === 'string' && obj.identity_summary.trim()) || '',
    current_focus: asStringArray(obj.current_focus),
    core_interests: asStringArray(obj.core_interests),
    can_offer: asStringArray(obj.can_offer),
    seeking: asStringArray(obj.seeking),
    conversation_hooks: asStringArray(obj.conversation_hooks),
    watchouts: asStringArray(obj.watchouts),
    card_text: cardText,
  };
}

function countWords(text: string): number {
  const matches = text.trim().match(/\b[\w'-]+\b/g);
  return matches ? matches.length : 0;
}

function validateReportWordCount(reportText: string): void {
  const words = countWords(reportText);
  if (words < REPORT_MIN_WORDS || words > REPORT_MAX_WORDS) {
    throw new Error(
      `report_text word count must be ${REPORT_MIN_WORDS}-${REPORT_MAX_WORDS}. Received ${words} words.`
    );
  }
}

function validateCardWordCount(cardText: string): void {
  const words = countWords(cardText);
  if (words < CARD_MIN_WORDS || words > CARD_MAX_WORDS) {
    throw new Error(
      `card_text word count must be ${CARD_MIN_WORDS}-${CARD_MAX_WORDS}. Received ${words} words.`
    );
  }
}

async function synthesizeOneProfileReport(
  profile: NormalizedTedxProfile,
  enrichment: { clay: string[]; jina: string[]; github: string[]; topics: string[] },
  repairContext?: string
): Promise<SynthesizedProfileReportJson> {
  const systemPrompt =
    'You are generating high-detail attendee intelligence reports for TEDx Asheville matching. Return only a valid JSON object.';

  const repairSection = repairContext
    ? `Repair instructions from previous attempt:
- ${repairContext}
- Return strict JSON only. Do not include markdown fences or commentary.
`
    : '';

  const userPrompt = `Generate a detailed attendee report JSON for this attendee.

Required JSON shape:
{
  "identity_overview": "string",
  "personality_and_style": ["string"],
  "career_arc": ["string"],
  "current_focus": ["string"],
  "core_interests": ["string"],
  "expertise_and_strengths": ["string"],
  "values_and_motivations": ["string"],
  "communities": ["string"],
  "offer_to_others": ["string"],
  "seeking_from_others": ["string"],
  "conversation_angles": ["string"],
  "open_questions_or_unknowns": ["string"],
  "evidence_highlights": [{"claim":"string","evidence":"string"}],
  "report_text": "300-1800 words"
}

Rules:
- The report must be specific and evidence-based, not generic.
- Use only signals present in the provided data.
- Avoid prestige bias and avoid unsupported assumptions.
- If information is uncertain or missing, state uncertainty in "open_questions_or_unknowns".
- "report_text" MUST be ${REPORT_MIN_WORDS}-${REPORT_MAX_WORDS} words.

${repairSection}

Attendee:
- Name: ${profile.displayName}

Resume markdown (optional):
${profile.resumeMarkdown ? clipText(profile.resumeMarkdown) : 'None'}

Survey answers:
${clipText(JSON.stringify(profile.surveyAnswers, null, 2))}

Clay LinkedIn enrichment:
${enrichment.clay.length > 0 ? clipText(enrichment.clay.join('\n\n')) : 'None'}

GitHub profile enrichment:
${enrichment.github.length > 0 ? clipText(enrichment.github.join('\n\n')) : 'None'}

Jina URL enrichment:
${enrichment.jina.length > 0 ? clipText(enrichment.jina.join('\n\n')) : 'None'}

Topic text:
${enrichment.topics.length > 0 ? clipText(enrichment.topics.join('\n')) : 'None'}`;

  const raw = await callAzureJson<unknown>({
    systemPrompt,
    userPrompt,
    maxCompletionTokens: 7000,
  });

  const sanitized = sanitizeProfileReportJson(raw);
  if (!sanitized) {
    throw new Error('Invalid synthesized profile report JSON');
  }

  const trimmedReportText = sanitized.report_text.trim().slice(0, REPORT_TEXT_MAX_CHARS);
  validateReportWordCount(trimmedReportText);
  return {
    ...sanitized,
    report_text: trimmedReportText,
  };
}

async function synthesizeOneProfileReportWithRepair(
  profile: NormalizedTedxProfile,
  enrichment: { clay: string[]; jina: string[]; github: string[]; topics: string[] }
): Promise<SynthesizedProfileReportJson> {
  try {
    return await synthesizeOneProfileReport(profile, enrichment);
  } catch (firstError) {
    const repairReason = firstError instanceof Error ? firstError.message : String(firstError);
    return synthesizeOneProfileReport(profile, enrichment, repairReason);
  }
}

async function synthesizeOneCardFromReport(
  profile: NormalizedTedxProfile,
  report: SynthesizedProfileReportJson,
  repairContext?: string
): Promise<SynthesizedCardJson> {
  const systemPrompt =
    'You are generating compact attendee cards for TEDx Asheville matching. Return only a valid JSON object.';

  const repairSection = repairContext
    ? `Repair instructions from previous attempt:
- ${repairContext}
- Return strict JSON only. Do not include markdown fences or commentary.
`
    : '';

  const userPrompt = `Generate a concise profile card JSON for this attendee using the detailed report.

Required JSON shape:
{
  "identity_summary": "string",
  "current_focus": ["string"],
  "core_interests": ["string"],
  "can_offer": ["string"],
  "seeking": ["string"],
  "conversation_hooks": ["string"],
  "watchouts": ["string"],
  "card_text": "120-220 words"
}

Rules:
- "card_text" must be dense and specific.
- Include both "can_offer" and "seeking" when available.
- Avoid generic filler and prestige bias.
- Use only signals present in the detailed report.
- "card_text" MUST be ${CARD_MIN_WORDS}-${CARD_MAX_WORDS} words.

${repairSection}

Attendee:
- Name: ${profile.displayName}

Detailed report JSON:
${clipText(JSON.stringify(report, null, 2))}

Detailed report text:
${clipText(report.report_text)}`;

  const raw = await callAzureJson<unknown>({
    systemPrompt,
    userPrompt,
    maxCompletionTokens: 3000,
  });

  const sanitized = sanitizeCardJson(raw);
  if (!sanitized) {
    throw new Error('Invalid synthesized card JSON');
  }

  const trimmedCardText = sanitized.card_text.trim().slice(0, CARD_TEXT_MAX_CHARS);
  validateCardWordCount(trimmedCardText);
  return {
    ...sanitized,
    card_text: trimmedCardText,
  };
}

async function synthesizeOneCardFromReportWithRepair(
  profile: NormalizedTedxProfile,
  report: SynthesizedProfileReportJson
): Promise<SynthesizedCardJson> {
  try {
    return await synthesizeOneCardFromReport(profile, report);
  } catch (firstError) {
    const repairReason = firstError instanceof Error ? firstError.message : String(firstError);
    return synthesizeOneCardFromReport(profile, report, repairReason);
  }
}

export async function buildProfileCards(
  runId: string,
  profiles: NormalizedTedxProfile[]
): Promise<CandidateCard[]> {
  const profileIds = profiles.map((profile) => profile.profileId);
  const enrichmentByProfile = await getEnrichmentSummaryByProfile(runId, profileIds);
  const now = new Date();

  for (const profile of profiles) {
    const enrichment = enrichmentByProfile.get(profile.profileId) ?? {
      clay: [],
      jina: [],
      github: [],
      topics: [],
    };
    const model = getAzureDeploymentName();
    const [existingReport] = await db
      .select({
        promptVersion: matchingProfileReports.promptVersion,
        sourceSurveyUpdatedAt: matchingProfileReports.sourceSurveyUpdatedAt,
        reportJson: matchingProfileReports.reportJson,
      })
      .from(matchingProfileReports)
      .where(
        and(
          eq(matchingProfileReports.runId, runId),
          eq(matchingProfileReports.profileId, profile.profileId)
        )
      )
      .limit(1);

    const shouldReuseReport =
      !!existingReport &&
      existingReport.promptVersion === PROFILE_REPORT_PROMPT_VERSION &&
      isSameInstant(existingReport.sourceSurveyUpdatedAt, profile.surveyUpdatedAt) &&
      !!existingReport.reportJson &&
      typeof existingReport.reportJson === 'object';
    const shouldBackfillReportSnapshot =
      !!existingReport &&
      existingReport.promptVersion === PROFILE_REPORT_PROMPT_VERSION &&
      existingReport.sourceSurveyUpdatedAt === null &&
      profile.surveyUpdatedAt !== null &&
      !!existingReport.reportJson &&
      typeof existingReport.reportJson === 'object';

    const existingReportJson =
      (shouldReuseReport || shouldBackfillReportSnapshot) && existingReport?.reportJson
        ? sanitizeProfileReportJson(existingReport.reportJson)
        : null;

    const reportJson = existingReportJson
      ? existingReportJson
      : await synthesizeOneProfileReportWithRepair(profile, enrichment).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to synthesize profile report for ${profile.profileId}: ${message}`
          );
        });

    if (shouldBackfillReportSnapshot) {
      await db
        .update(matchingProfileReports)
        .set({
          sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
        })
        .where(
          and(
            eq(matchingProfileReports.runId, runId),
            eq(matchingProfileReports.profileId, profile.profileId)
          )
        );
    } else if (!shouldReuseReport) {
      await db
        .insert(matchingProfileReports)
        .values({
          runId,
          profileId: profile.profileId,
          sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
          reportJson,
          reportText: reportJson.report_text,
          model,
          promptVersion: PROFILE_REPORT_PROMPT_VERSION,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [matchingProfileReports.runId, matchingProfileReports.profileId],
          set: {
            sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
            reportJson,
            reportText: reportJson.report_text,
            model,
            promptVersion: PROFILE_REPORT_PROMPT_VERSION,
            updatedAt: now,
          },
        });
    }

    const [existingCard] = await db
      .select({
        promptVersion: matchingProfileCards.promptVersion,
        sourceSurveyUpdatedAt: matchingProfileCards.sourceSurveyUpdatedAt,
      })
      .from(matchingProfileCards)
      .where(
        and(
          eq(matchingProfileCards.runId, runId),
          eq(matchingProfileCards.profileId, profile.profileId)
        )
      )
      .limit(1);

    const shouldReuseCard =
      !!existingCard &&
      existingCard.promptVersion === CARD_PROMPT_VERSION &&
      isSameInstant(existingCard.sourceSurveyUpdatedAt, profile.surveyUpdatedAt);
    const shouldBackfillCardSnapshot =
      !!existingCard &&
      existingCard.promptVersion === CARD_PROMPT_VERSION &&
      existingCard.sourceSurveyUpdatedAt === null &&
      profile.surveyUpdatedAt !== null;

    if (shouldBackfillCardSnapshot) {
      await db
        .update(matchingProfileCards)
        .set({
          sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
        })
        .where(
          and(
            eq(matchingProfileCards.runId, runId),
            eq(matchingProfileCards.profileId, profile.profileId)
          )
        );
    } else if (!shouldReuseCard) {
      const cardJson = await synthesizeOneCardFromReportWithRepair(profile, reportJson).catch(
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to synthesize profile card for ${profile.profileId}: ${message}`);
        }
      );

      await db
        .insert(matchingProfileCards)
        .values({
          runId,
          profileId: profile.profileId,
          sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
          cardJson,
          cardText: cardJson.card_text,
          model,
          promptVersion: CARD_PROMPT_VERSION,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [matchingProfileCards.runId, matchingProfileCards.profileId],
          set: {
            sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
            cardJson,
            cardText: cardJson.card_text,
            model,
            promptVersion: CARD_PROMPT_VERSION,
            updatedAt: now,
          },
        });
    }
  }

  const rows = await db
    .select({
      profileId: matchingProfileCards.profileId,
      cardText: matchingProfileCards.cardText,
    })
    .from(matchingProfileCards)
    .where(eq(matchingProfileCards.runId, runId));

  const nameByProfileId = new Map(
    profiles.map((profile) => [profile.profileId, profile.displayName])
  );
  return rows.map((row) => ({
    profileId: row.profileId,
    name: nameByProfileId.get(row.profileId) ?? 'TEDx Attendee',
    cardText: row.cardText,
  }));
}
