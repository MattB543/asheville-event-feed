import { readFile } from 'fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { matchingAnswers, matchingProfiles } from '@/lib/db/schema';
import {
  canonicalizeUrl,
  isGitHubProfileUrl,
  isLinkedInProfileUrl,
  isLinkedInShortUrl,
  looksLikeDomain,
  normalizeSourceValue,
  resolveLinkedInProfileUrl,
  shouldSkipWebEnrichmentUrl,
  toAbsoluteUrl,
} from '@/lib/matching/pipeline/source';
import type {
  AnswerRowShape,
  CohortAudit,
  CohortFilter,
  NormalizedTedxProfile,
} from '@/lib/matching/pipeline/types';

type CohortProfileRow = {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  updatedAt: Date | null;
  submittedAt: Date | null;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => normalizeSourceValue(item))
    .filter((item) => item.length > 0);
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Look up an answer by bare suffix (e.g. 'resume'), falling back to any key ending with `_${suffix}` (e.g. 'vibe_resume'). */
function findAnswerBySuffix(
  answerMap: Map<string, AnswerRowShape>,
  suffix: string
): AnswerRowShape | undefined {
  const direct = answerMap.get(suffix);
  if (direct) return direct;
  for (const [key, value] of answerMap) {
    if (key.endsWith(`_${suffix}`)) return value;
  }
  return undefined;
}

/** Passive question suffixes — these are handled via dedicated lookups, not as survey answers. */
const PASSIVE_SUFFIXES = [
  'resume',
  'linkedin_url',
  'github_url',
  'links_about_you',
  'links_about_topics',
];

/** Returns true if the questionId matches a passive suffix (bare or prefixed). */
function isPassiveQuestionId(id: string): boolean {
  if (PASSIVE_SUFFIXES.includes(id)) return true;
  return PASSIVE_SUFFIXES.some((suffix) => id.endsWith(`_${suffix}`));
}

function cleanCandidateToken(token: string): string {
  let cleaned = token
    .trim()
    .replace(/^[\[\(\{<"'`]+/, '')
    .replace(/[\]\)\}>",;:!?`]+$/, '');

  // If a markdown fragment like "url](label)" was captured, keep only the URL portion.
  const markdownSplitIdx = cleaned.indexOf('](');
  if (markdownSplitIdx > 0) {
    cleaned = cleaned.slice(0, markdownSplitIdx);
  }

  // Remove extra unmatched closing parenthesis commonly captured from prose.
  while (cleaned.endsWith(')')) {
    const openCount = (cleaned.match(/\(/g) ?? []).length;
    const closeCount = (cleaned.match(/\)/g) ?? []).length;
    if (closeCount <= openCount) break;
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned.trim().replace(/[\]\)\}>",;:!?`]+$/, '');
}

function extractUrlCandidatesFromText(text: string): string[] {
  if (!text.trim()) return [];

  const candidates = new Set<string>();

  const explicitUrlMatches = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  for (const match of explicitUrlMatches) {
    candidates.add(cleanCandidateToken(match));
  }

  const markdownParenMatches = text.match(/\((https?:\/\/[^)\s]+)\)/gi) ?? [];
  for (const match of markdownParenMatches) {
    const inner = match.replace(/^\(/, '').replace(/\)$/, '');
    candidates.add(cleanCandidateToken(inner));
  }

  const tokens = text.split(/\s+/);
  for (const token of tokens) {
    const cleaned = cleanCandidateToken(token);
    if (!cleaned || cleaned.includes('@')) continue;
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      candidates.add(cleaned);
      continue;
    }

    const lowered = cleaned.toLowerCase();
    if (lowered.startsWith('www.') || looksLikeDomain(lowered)) {
      candidates.add(cleaned);
    }
  }

  return Array.from(candidates);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

async function loadCohortFilter(cohortFile: string | null): Promise<CohortFilter | null> {
  if (!cohortFile) return null;

  const raw = await readFile(cohortFile, 'utf-8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error(`Cohort file is empty: ${cohortFile}`);
  }

  const userIds = new Set<string>();
  const emails = new Set<string>();
  let duplicateCount = 0;
  let rowCount = 0;

  const headerCells = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader =
    headerCells.some((cell) => cell.includes('uid') || cell.includes('user')) ||
    headerCells.some((cell) => cell.includes('email'));

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const uidIdx = hasHeader
    ? headerCells.findIndex((cell) => cell.includes('uid') || cell.includes('user'))
    : 0;
  const emailIdx = hasHeader ? headerCells.findIndex((cell) => cell.includes('email')) : -1;

  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    if (cells.length === 0) continue;
    rowCount += 1;

    const uidValue = uidIdx >= 0 && uidIdx < cells.length ? cells[uidIdx].trim() : '';
    const emailValue =
      emailIdx >= 0 && emailIdx < cells.length ? cells[emailIdx].trim().toLowerCase() : '';

    if (uidValue) {
      if (userIds.has(uidValue)) duplicateCount += 1;
      userIds.add(uidValue);
    }

    if (emailValue) {
      if (emails.has(emailValue)) duplicateCount += 1;
      emails.add(emailValue);
    }
  }

  if (userIds.size === 0 && emails.size === 0) {
    throw new Error(`Cohort file "${cohortFile}" did not contain usable user IDs or emails.`);
  }

  return {
    userIds,
    emails,
    rowCount,
    duplicateCount,
  };
}

function shouldIncludeProfile(
  profile: CohortProfileRow,
  filter: CohortFilter | null,
  matchedUserIds: Set<string>,
  matchedEmails: Set<string>
): boolean {
  if (!filter) return true;
  const email = profile.email?.trim().toLowerCase() || '';

  if (filter.userIds.has(profile.userId)) {
    matchedUserIds.add(profile.userId);
    return true;
  }

  if (email && filter.emails.has(email)) {
    matchedEmails.add(email);
    return true;
  }

  return false;
}

async function classifyPotentialUrl(url: string): Promise<{
  linkedinUrl: string | null;
  githubUrl: string | null;
  webUrl: string | null;
}> {
  const canonical = canonicalizeUrl(url);
  if (isLinkedInProfileUrl(canonical)) {
    return { linkedinUrl: canonical, githubUrl: null, webUrl: null };
  }

  if (isLinkedInShortUrl(canonical)) {
    const resolved = await resolveLinkedInProfileUrl(canonical);
    if (resolved) {
      return { linkedinUrl: resolved, githubUrl: null, webUrl: null };
    }
  }

  if (isGitHubProfileUrl(canonical)) {
    return { linkedinUrl: null, githubUrl: canonical, webUrl: null };
  }

  if (shouldSkipWebEnrichmentUrl(canonical)) {
    return { linkedinUrl: null, githubUrl: null, webUrl: null };
  }

  return { linkedinUrl: null, githubUrl: null, webUrl: canonical };
}

export async function loadSubmittedCohort(
  program: string,
  cohortFile: string | null
): Promise<{ profiles: NormalizedTedxProfile[]; audit: CohortAudit }> {
  const filter = await loadCohortFilter(cohortFile);

  const profiles = await db
    .select({
      id: matchingProfiles.id,
      userId: matchingProfiles.userId,
      displayName: matchingProfiles.displayName,
      email: matchingProfiles.email,
      updatedAt: matchingProfiles.updatedAt,
      submittedAt: matchingProfiles.submittedAt,
    })
    .from(matchingProfiles)
    .where(
      and(
        eq(matchingProfiles.program, program),
        eq(matchingProfiles.status, 'submitted'),
        eq(matchingProfiles.aiMatching, true)
      )
    );

  const matchedUserIds = new Set<string>();
  const matchedEmails = new Set<string>();
  const filteredProfiles = profiles.filter((profile) =>
    shouldIncludeProfile(profile, filter, matchedUserIds, matchedEmails)
  );

  const audit: CohortAudit = {
    totalSubmitted: profiles.length,
    included: filteredProfiles.length,
    excludedNoRosterMatch: profiles.length - filteredProfiles.length,
    rosterProvided: !!filter,
    rosterRowCount: filter?.rowCount ?? 0,
    rosterDuplicateCount: filter?.duplicateCount ?? 0,
    rosterUniqueUserIds: filter?.userIds.size ?? 0,
    rosterUniqueEmails: filter?.emails.size ?? 0,
    rosterUnmatchedUserIds: filter ? filter.userIds.size - matchedUserIds.size : 0,
    rosterUnmatchedEmails: filter ? filter.emails.size - matchedEmails.size : 0,
  };

  if (filteredProfiles.length === 0) {
    return { profiles: [], audit };
  }

  const profileIds = filteredProfiles.map((profile) => profile.id);
  const answers = await db
    .select({
      profileId: matchingAnswers.profileId,
      questionId: matchingAnswers.questionId,
      answerText: matchingAnswers.answerText,
      answerJson: matchingAnswers.answerJson,
      updatedAt: matchingAnswers.updatedAt,
    })
    .from(matchingAnswers)
    .where(inArray(matchingAnswers.profileId, profileIds));

  const answersByProfile = new Map<string, AnswerRowShape[]>();
  for (const answer of answers) {
    const list = answersByProfile.get(answer.profileId) ?? [];
    list.push({
      questionId: answer.questionId,
      answerText: answer.answerText,
      answerJson: answer.answerJson,
      updatedAt: answer.updatedAt,
    });
    answersByProfile.set(answer.profileId, list);
  }

  const normalizedProfiles = await Promise.all(
    filteredProfiles.map((profile) =>
      normalizeProfile(profile, answersByProfile.get(profile.id) ?? [])
    )
  );

  return { profiles: normalizedProfiles, audit };
}

async function normalizeProfile(
  profile: CohortProfileRow,
  answers: AnswerRowShape[]
): Promise<NormalizedTedxProfile> {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer]));

  const resumeMarkdown = findAnswerBySuffix(answerMap, 'resume')?.answerText?.trim() || null;
  const linksAboutYou = asStringArray(findAnswerBySuffix(answerMap, 'links_about_you')?.answerJson);
  const linksAboutTopicsRaw = asStringArray(
    findAnswerBySuffix(answerMap, 'links_about_topics')?.answerJson
  );
  const urlCandidates = new Set<string>();

  const surveyAnswers: Record<string, string> = {};
  for (const answer of answers) {
    if (isPassiveQuestionId(answer.questionId)) continue;
    const text = answer.answerText?.trim();
    if (text) {
      surveyAnswers[answer.questionId] = text;
    } else if (Array.isArray(answer.answerJson)) {
      const items = answer.answerJson.filter((item): item is string => typeof item === 'string');
      if (items.length > 0) {
        surveyAnswers[answer.questionId] = items.join(', ');
      }
    }
  }

  const linkedinUrls: string[] = [];
  const githubUrls: string[] = [];
  const webUrls: string[] = [];
  const topicTexts: string[] = [];
  let surveyUpdatedAt: Date | null = profile.submittedAt ?? null;

  // URLs can appear in any field, not just dedicated link questions.
  // We scan both answer_text and answer_json string items for all answers,
  // and allow multiple URLs per answer.
  for (const answer of answers) {
    if (answer.updatedAt && (!surveyUpdatedAt || answer.updatedAt > surveyUpdatedAt)) {
      surveyUpdatedAt = answer.updatedAt;
    }

    if (answer.answerText) {
      for (const candidate of extractUrlCandidatesFromText(answer.answerText)) {
        urlCandidates.add(candidate);
      }
    }

    if (Array.isArray(answer.answerJson)) {
      for (const item of answer.answerJson) {
        if (typeof item !== 'string') continue;
        for (const candidate of extractUrlCandidatesFromText(item)) {
          urlCandidates.add(candidate);
        }
      }
    }
  }

  for (const value of linksAboutYou) {
    for (const candidate of extractUrlCandidatesFromText(value)) {
      urlCandidates.add(candidate);
    }
  }

  for (const value of linksAboutTopicsRaw) {
    const extracted = extractUrlCandidatesFromText(value);
    if (extracted.length > 0) {
      for (const candidate of extracted) {
        urlCandidates.add(candidate);
      }
      continue;
    }

    const absolute = toAbsoluteUrl(value);
    if (absolute) {
      urlCandidates.add(value);
    } else {
      topicTexts.push(value);
    }
  }

  // Bookshelf books are stored as answerJson string arrays (e.g. "Title - Author").
  // Include them as topic signals so they flow through synthesis.
  const bookshelfAnswer = findAnswerBySuffix(answerMap, 'bookshelf');
  if (bookshelfAnswer && Array.isArray(bookshelfAnswer.answerJson)) {
    for (const item of bookshelfAnswer.answerJson) {
      if (typeof item === 'string' && item.trim()) {
        topicTexts.push(`[Book] ${item.trim()}`);
      }
    }
  }

  for (const candidate of urlCandidates) {
    const absolute = toAbsoluteUrl(candidate);
    if (!absolute) continue;
    const classified = await classifyPotentialUrl(absolute);
    if (classified.linkedinUrl) {
      linkedinUrls.push(classified.linkedinUrl);
    }
    if (classified.githubUrl) {
      githubUrls.push(classified.githubUrl);
    }
    if (classified.webUrl) {
      webUrls.push(classified.webUrl);
    }
  }

  return {
    profileId: profile.id,
    userId: profile.userId,
    displayName: profile.displayName?.trim() || profile.email?.split('@')[0] || 'TEDx Attendee',
    email: profile.email,
    surveyUpdatedAt,
    resumeMarkdown,
    surveyAnswers,
    linksAboutYou: dedupe(linksAboutYou),
    linksAboutTopicsRaw: dedupe(linksAboutTopicsRaw),
    linkedinUrls: dedupe(linkedinUrls),
    githubUrls: dedupe(githubUrls),
    webUrls: dedupe(webUrls),
    topicTexts: dedupe(topicTexts),
  };
}
