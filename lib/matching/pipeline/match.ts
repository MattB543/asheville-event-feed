import { db } from '@/lib/db';
import { matchingTopMatches } from '@/lib/db/schema';
import { callAzureJson } from '@/lib/matching/pipeline/llm';
import { getAzureDeploymentName } from '@/lib/ai/provider-clients';
import type { CandidateCard, MatchEntry } from '@/lib/matching/pipeline/types';

const MATCH_PROMPT_VERSION = 'tedx-match-v4';
const MATCHES_PER_PROFILE = 5;

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanSentence(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function validateMatches(
  raw: unknown,
  targetProfileId: string,
  validCandidateIds: Set<string>
): MatchEntry[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.matches)) {
    return [];
  }

  const deduped: MatchEntry[] = [];
  const seen = new Set<string>();

  for (const item of obj.matches) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const profileId =
      (typeof row.profile_id === 'string' && row.profile_id.trim()) ||
      (typeof row.profileId === 'string' && row.profileId.trim()) ||
      '';
    if (!profileId || profileId === targetProfileId || !validCandidateIds.has(profileId)) {
      continue;
    }
    if (seen.has(profileId)) continue;

    const rankNumber = asNumber(row.rank) ?? deduped.length + 1;
    const score = asNumber(row.score) ?? asNumber(row.confidence) ?? 50;
    const entry: MatchEntry = {
      rank: rankNumber,
      profile_id: profileId,
      name: cleanSentence(row.name, 'TEDx Attendee'),
      why_match: cleanSentence(
        row.why_match,
        'Strong topical overlap and likely conversation fit.'
      ),
      mutual_value: cleanSentence(
        row.mutual_value,
        'Potential mutual value exchange in a short meeting.'
      ),
      conversation_starter: cleanSentence(
        row.conversation_starter,
        'What are you both most excited to explore at TEDx Asheville?'
      ),
      confidence: Math.max(0, Math.min(100, score)),
    };
    deduped.push(entry);
    seen.add(profileId);

    if (deduped.length >= MATCHES_PER_PROFILE) break;
  }

  return deduped.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function buildMatchPrompt(
  target: CandidateCard,
  candidates: CandidateCard[],
  repairContext?: string
): string {
  const repairSection = repairContext
    ? `Repair instructions from previous attempt:
- ${repairContext}
- Return strict JSON only. Do not include markdown fences or commentary.
`
    : '';

  return `Return JSON in this format:
{
  "target_profile_id": "uuid",
  "matches": [
    {
      "rank": 1,
      "profile_id": "uuid",
      "name": "string",
      "why_match": "2-4 specific sentences",
      "mutual_value": "1-2 specific sentences",
      "conversation_starter": "1 sentence",
      "score": 85
    }
  ]
}

Rules:
- Select exactly ${MATCHES_PER_PROFILE} unique matches.
- Never include the target profile.
- Use concrete details from both cards.
- Avoid prestige bias and generic networking language.
- Keep "why_match" high-level and vibes-based: personality, energy, values, passions, working style.
- Keep "conversation_starter" high-level and safe for first conversation.
- "score" is a 0-100 compatibility rating (100 = perfect match, 50 = decent, below 30 = weak).
- Privacy-safe style for "why_match" and "conversation_starter":
  - Do NOT reference private or sensitive specifics from survey/resume/enrichment.
  - Do NOT mention traumatic events, health/family details, exact metrics, or highly specific project names.
  - Prefer broad public descriptors (e.g., entrepreneur, nonprofit leader, community builder, AI safety builder).

${repairSection}

Target profile:
${JSON.stringify(
  {
    profile_id: target.profileId,
    name: target.name,
    card_text: target.cardText,
  },
  null,
  2
)}

Candidates:
${JSON.stringify(
  candidates.map((candidate) => ({
    profile_id: candidate.profileId,
    name: candidate.name,
    card_text: candidate.cardText,
  })),
  null,
  2
)}`;
}

async function generateOneMatchSet(
  target: CandidateCard,
  candidates: CandidateCard[],
  repairContext?: string
): Promise<MatchEntry[]> {
  const candidateMap = new Map(candidates.map((candidate) => [candidate.profileId, candidate]));

  const systemPrompt =
    'You match TEDx Asheville attendees for high-quality 1:1 conversations. Return only valid JSON.';

  const userPrompt = buildMatchPrompt(target, candidates, repairContext);

  const raw = await callAzureJson<unknown>({
    systemPrompt,
    userPrompt,
    maxCompletionTokens: 4000,
  });

  const parsed = validateMatches(raw, target.profileId, new Set(candidateMap.keys()));
  if (parsed.length !== MATCHES_PER_PROFILE) {
    throw new Error(
      `Model returned ${parsed.length} valid matches instead of ${MATCHES_PER_PROFILE}`
    );
  }

  return parsed.map((match) => ({
    ...match,
    name: candidateMap.get(match.profile_id)?.name ?? match.name,
  }));
}

async function generateOneMatchSetWithRepair(
  target: CandidateCard,
  candidates: CandidateCard[]
): Promise<MatchEntry[]> {
  try {
    return await generateOneMatchSet(target, candidates);
  } catch (firstError) {
    const repairReason = firstError instanceof Error ? firstError.message : String(firstError);
    return generateOneMatchSet(target, candidates, repairReason);
  }
}

const MATCH_CONCURRENCY = 10;

export async function generateTopMatches(
  runId: string,
  cards: CandidateCard[]
): Promise<{ completed: number; failed: number }> {
  const now = new Date();
  let completed = 0;
  let failed = 0;

  // Build tasks with pre-filtered candidates
  const tasks: Array<{ target: CandidateCard; candidates: CandidateCard[] }> = [];
  for (const target of cards) {
    const targetExclusions = new Set(target.excludedProfileIds ?? []);
    const candidates = cards.filter((c) => {
      if (c.profileId === target.profileId) return false;
      if (targetExclusions.has(c.profileId)) return false;
      if (c.excludedProfileIds?.includes(target.profileId)) return false;
      return true;
    });
    if (candidates.length < MATCHES_PER_PROFILE) {
      failed += 1;
      continue;
    }
    tasks.push({ target, candidates });
  }

  // Process in parallel batches
  for (let i = 0; i < tasks.length; i += MATCH_CONCURRENCY) {
    const batch = tasks.slice(i, i + MATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ target, candidates }) => {
        const matches = await generateOneMatchSetWithRepair(target, candidates);
        const model = getAzureDeploymentName();

        await db
          .insert(matchingTopMatches)
          .values({
            runId,
            profileId: target.profileId,
            matchesJson: {
              target_profile_id: target.profileId,
              matches,
            },
            model,
            promptVersion: MATCH_PROMPT_VERSION,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [matchingTopMatches.runId, matchingTopMatches.profileId],
            set: {
              matchesJson: {
                target_profile_id: target.profileId,
                matches,
              },
              model,
              promptVersion: MATCH_PROMPT_VERSION,
              updatedAt: now,
            },
          });

        return target.profileId;
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        completed += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { completed, failed };
}
