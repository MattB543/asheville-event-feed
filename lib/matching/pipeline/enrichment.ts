import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { db } from '@/lib/db';
import { matchingEnrichmentItems, matchingProfiles } from '@/lib/db/schema';
import { env } from '@/lib/config/env';
import { withRetry } from '@/lib/utils/retry';
import { extractGitHubUsername, sourceHash } from '@/lib/matching/pipeline/source';
import { fetchGitHubProfile } from '@/lib/matching/pipeline/github';
import type { NormalizedTedxProfile } from '@/lib/matching/pipeline/types';

const CLAY_POLL_INTERVAL_MS = 15_000;
const JINA_RAW_MAX_CHARS = 20_000;
const JINA_NORMALIZED_MAX_CHARS = 1_500;
const JINA_FREE_RATE_DELAY_MS = 1_500;
const DNS_LOOKUP_TIMEOUT_MS = 2_500;

class HttpStatusError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMalformedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.startsWith('.') || host.endsWith('.')) return true;
  if (host.includes('..')) return true;
  if (host.includes(' ')) return true;
  if (!/^[a-z0-9.-]+$/.test(host)) return true;

  if (isIP(host) !== 0) return false;

  if (!host.includes('.')) return true;
  const labels = host.split('.');
  if (labels.some((label) => !label || label.length > 63)) return true;
  const tld = labels[labels.length - 1] ?? '';
  if (!/^[a-z]{2,24}$/.test(tld)) return true;

  return false;
}

async function isResolvableHostname(hostname: string): Promise<boolean> {
  try {
    await Promise.race([
      lookup(hostname),
      sleep(DNS_LOOKUP_TIMEOUT_MS).then(() => {
        throw new Error('DNS timeout');
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

function normalizeJinaMarkdown(markdown: string): string {
  const squashed = markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return squashed.slice(0, JINA_NORMALIZED_MAX_CHARS);
}

async function upsertEnrichmentItem(args: {
  runId: string;
  profileId: string;
  sourceKind: 'linkedin' | 'url' | 'github' | 'topic_text';
  sourceValue: string;
  provider: 'clay' | 'jina' | 'github' | 'manual';
  status: 'pending' | 'completed' | 'failed' | 'timeout' | 'skipped';
  sourceSurveyUpdatedAt: Date | null;
  normalizedText?: string | null;
  rawPayload?: unknown;
  errorText?: string | null;
}) {
  const now = new Date();
  const hash = sourceHash(args.sourceValue);
  const [existing] = await db
    .select({
      id: matchingEnrichmentItems.id,
      sourceSurveyUpdatedAt: matchingEnrichmentItems.sourceSurveyUpdatedAt,
      status: matchingEnrichmentItems.status,
    })
    .from(matchingEnrichmentItems)
    .where(
      and(
        eq(matchingEnrichmentItems.runId, args.runId),
        eq(matchingEnrichmentItems.profileId, args.profileId),
        eq(matchingEnrichmentItems.sourceKind, args.sourceKind),
        eq(matchingEnrichmentItems.provider, args.provider),
        eq(matchingEnrichmentItems.sourceHash, hash)
      )
    )
    .limit(1);

  const existingSurveyTs = existing?.sourceSurveyUpdatedAt?.getTime() ?? null;
  const incomingSurveyTs = args.sourceSurveyUpdatedAt?.getTime() ?? null;
  const unchangedSurveySnapshot = existing && existingSurveyTs === incomingSurveyTs;
  const needsSnapshotBackfill =
    existing &&
    existingSurveyTs === null &&
    incomingSurveyTs !== null &&
    existing.status === 'completed';

  if (!existing) {
    await db.insert(matchingEnrichmentItems).values({
      runId: args.runId,
      profileId: args.profileId,
      sourceKind: args.sourceKind,
      sourceValue: args.sourceValue,
      sourceHash: hash,
      provider: args.provider,
      status: args.status,
      sourceSurveyUpdatedAt: args.sourceSurveyUpdatedAt,
      normalizedText: args.normalizedText ?? null,
      rawPayload: args.rawPayload ?? null,
      errorText: args.errorText ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  if (unchangedSurveySnapshot) {
    return;
  }

  // One-time migration backfill path:
  // if prior rows predate source_survey_updated_at but are already completed,
  // preserve enriched payload and only stamp the survey snapshot.
  if (needsSnapshotBackfill) {
    await db
      .update(matchingEnrichmentItems)
      .set({
        sourceSurveyUpdatedAt: args.sourceSurveyUpdatedAt,
      })
      .where(eq(matchingEnrichmentItems.id, existing.id));
    return;
  }

  await db
    .update(matchingEnrichmentItems)
    .set({
      sourceValue: args.sourceValue,
      status: args.status,
      sourceSurveyUpdatedAt: args.sourceSurveyUpdatedAt,
      normalizedText: args.normalizedText ?? null,
      rawPayload: args.rawPayload ?? null,
      errorText: args.errorText ?? null,
      externalId: null,
      httpStatus: null,
      updatedAt: now,
    })
    .where(eq(matchingEnrichmentItems.id, existing.id));
}

export async function seedEnrichmentItems(runId: string, profiles: NormalizedTedxProfile[]) {
  for (const profile of profiles) {
    for (const linkedinUrl of profile.linkedinUrls) {
      await upsertEnrichmentItem({
        runId,
        profileId: profile.profileId,
        sourceKind: 'linkedin',
        sourceValue: linkedinUrl,
        provider: 'clay',
        status: 'pending',
        sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
      });
    }

    for (const githubUrl of profile.githubUrls) {
      await upsertEnrichmentItem({
        runId,
        profileId: profile.profileId,
        sourceKind: 'github',
        sourceValue: githubUrl,
        provider: 'github',
        status: 'pending',
        sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
      });
    }

    for (const webUrl of profile.webUrls) {
      await upsertEnrichmentItem({
        runId,
        profileId: profile.profileId,
        sourceKind: 'url',
        sourceValue: webUrl,
        provider: 'jina',
        status: 'pending',
        sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
      });
    }

    for (const topicText of profile.topicTexts) {
      await upsertEnrichmentItem({
        runId,
        profileId: profile.profileId,
        sourceKind: 'topic_text',
        sourceValue: topicText,
        provider: 'manual',
        status: 'completed',
        sourceSurveyUpdatedAt: profile.surveyUpdatedAt,
        normalizedText: topicText,
      });
    }
  }
}

export async function dispatchClayLinkedinJobs(runId: string): Promise<void> {
  const clayWebhook = env.CLAY_WEBHOOK;

  if (!clayWebhook) {
    await db
      .update(matchingEnrichmentItems)
      .set({
        status: 'skipped',
        errorText: 'CLAY_WEBHOOK is not configured',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(matchingEnrichmentItems.runId, runId),
          eq(matchingEnrichmentItems.provider, 'clay'),
          eq(matchingEnrichmentItems.status, 'pending')
        )
      );
    return;
  }

  const pendingItems = await db
    .select({
      id: matchingEnrichmentItems.id,
      runId: matchingEnrichmentItems.runId,
      sourceValue: matchingEnrichmentItems.sourceValue,
      profileUserId: matchingProfiles.userId,
    })
    .from(matchingEnrichmentItems)
    .innerJoin(matchingProfiles, eq(matchingEnrichmentItems.profileId, matchingProfiles.id))
    .where(
      and(
        eq(matchingEnrichmentItems.runId, runId),
        eq(matchingEnrichmentItems.provider, 'clay'),
        eq(matchingEnrichmentItems.status, 'pending'),
        isNull(matchingEnrichmentItems.externalId)
      )
    );

  for (const item of pendingItems) {
    const claimToken = `dispatch:${item.id}:${Date.now()}`;
    const [claimed] = await db
      .update(matchingEnrichmentItems)
      .set({
        externalId: claimToken,
        errorText: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(matchingEnrichmentItems.id, item.id),
          eq(matchingEnrichmentItems.status, 'pending'),
          isNull(matchingEnrichmentItems.externalId)
        )
      )
      .returning({ id: matchingEnrichmentItems.id });

    if (!claimed) {
      continue;
    }

    try {
      // Do not auto-retry Clay POSTs. The webhook is side-effectful and retrying can create
      // duplicate rows/jobs in Clay if the upstream accepted a prior attempt.
      const response = await fetch(clayWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': item.id,
          ...(env.CLAY_API_KEY ? { Authorization: `Bearer ${env.CLAY_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          run_id: item.runId,
          user_uid: item.profileUserId,
          linkedin_url: item.sourceValue,
        }),
      });

      if (!response.ok) {
        await db
          .update(matchingEnrichmentItems)
          .set({
            status: 'failed',
            errorText: `Clay webhook rejected row: HTTP ${response.status}`,
            externalId: null,
            updatedAt: new Date(),
          })
          .where(eq(matchingEnrichmentItems.id, item.id));
        continue;
      }

      let responseJson: unknown = null;
      try {
        responseJson = await response.json();
      } catch {
        responseJson = null;
      }

      const externalId =
        responseJson &&
        typeof responseJson === 'object' &&
        'id' in responseJson &&
        typeof responseJson.id === 'string'
          ? responseJson.id
          : claimToken;

      await db
        .update(matchingEnrichmentItems)
        .set({
          externalId,
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
    } catch (error) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'failed',
          errorText: error instanceof Error ? error.message : String(error),
          externalId: null,
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
    }
  }
}

export async function waitForClayResults(runId: string, timeoutMinutes: number): Promise<void> {
  const timeoutMs = Math.max(1, timeoutMinutes) * 60_000;
  const start = Date.now();

  while (true) {
    const [pendingCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(matchingEnrichmentItems)
      .where(
        and(
          eq(matchingEnrichmentItems.runId, runId),
          eq(matchingEnrichmentItems.provider, 'clay'),
          eq(matchingEnrichmentItems.status, 'pending')
        )
      );

    const pendingCount = pendingCountRow?.count ?? 0;
    if (pendingCount <= 0) {
      return;
    }

    if (Date.now() - start > timeoutMs) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'timeout',
          errorText: 'Timed out waiting for Clay callback',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(matchingEnrichmentItems.runId, runId),
            eq(matchingEnrichmentItems.provider, 'clay'),
            eq(matchingEnrichmentItems.status, 'pending')
          )
        );
      return;
    }

    await sleep(CLAY_POLL_INTERVAL_MS);
  }
}

async function fetchJinaMarkdown(url: string): Promise<{
  ok: boolean;
  status: number | null;
  markdown?: string;
  error?: string;
}> {
  const requestUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
  const hasApiKey = !!env.JINA_API_KEY;

  const response = await withRetry(
    async () => {
      const res = await fetch(requestUrl, {
        headers: {
          ...(hasApiKey ? { Authorization: `Bearer ${env.JINA_API_KEY}` } : {}),
          'x-respond-with': 'markdown',
          'x-timeout': '30',
        },
      });

      if (res.status === 429 || res.status >= 500) {
        throw new HttpStatusError(`Jina retryable HTTP ${res.status}`, res.status);
      }

      return res;
    },
    {
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
    }
  );

  if (!response.ok) {
    return { ok: false, status: response.status, error: `Jina HTTP ${response.status}` };
  }

  const markdown = await response.text();
  if (!markdown.trim()) {
    return { ok: false, status: response.status, error: 'Jina returned empty markdown' };
  }

  return { ok: true, status: response.status, markdown };
}

export async function processJinaEnrichment(runId: string): Promise<void> {
  const completedItems = await db
    .select({
      sourceHash: matchingEnrichmentItems.sourceHash,
      normalizedText: matchingEnrichmentItems.normalizedText,
    })
    .from(matchingEnrichmentItems)
    .where(
      and(
        eq(matchingEnrichmentItems.runId, runId),
        eq(matchingEnrichmentItems.provider, 'jina'),
        eq(matchingEnrichmentItems.status, 'completed')
      )
    );

  const contentCache = new Map<string, string>();
  for (const row of completedItems) {
    if (row.normalizedText) {
      contentCache.set(row.sourceHash, row.normalizedText);
    }
  }

  const pendingItems = await db
    .select({
      id: matchingEnrichmentItems.id,
      sourceValue: matchingEnrichmentItems.sourceValue,
      sourceHash: matchingEnrichmentItems.sourceHash,
    })
    .from(matchingEnrichmentItems)
    .where(
      and(
        eq(matchingEnrichmentItems.runId, runId),
        eq(matchingEnrichmentItems.provider, 'jina'),
        eq(matchingEnrichmentItems.status, 'pending')
      )
    );

  const hostValidityCache = new Map<string, boolean>();

  for (const item of pendingItems) {
    // Respect slower anonymous/free Jina limits when no API key is configured.
    if (!env.JINA_API_KEY) {
      await sleep(JINA_FREE_RATE_DELAY_MS);
    }

    const cachedText = contentCache.get(item.sourceHash);
    if (cachedText) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'completed',
          normalizedText: cachedText,
          rawPayload: { reused: true, sourceHash: item.sourceHash },
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
      continue;
    }

    let host: string | null = null;
    try {
      host = new URL(item.sourceValue).hostname.toLowerCase();
    } catch {
      host = null;
    }

    if (!host || isMalformedHostname(host)) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'skipped',
          errorText: 'Skipped malformed URL host before Jina fetch',
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
      continue;
    }

    let isValidHost = hostValidityCache.get(host);
    if (isValidHost === undefined) {
      isValidHost = await isResolvableHostname(host);
      hostValidityCache.set(host, isValidHost);
    }

    if (!isValidHost) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'skipped',
          errorText: 'Skipped unresolvable URL host before Jina fetch',
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
      continue;
    }

    try {
      const result = await fetchJinaMarkdown(item.sourceValue);
      if (!result.ok || !result.markdown) {
        await db
          .update(matchingEnrichmentItems)
          .set({
            status: 'failed',
            httpStatus: result.status,
            errorText: result.error ?? 'Unknown Jina error',
            updatedAt: new Date(),
          })
          .where(eq(matchingEnrichmentItems.id, item.id));
        continue;
      }

      const rawMarkdown = result.markdown.slice(0, JINA_RAW_MAX_CHARS);
      const normalizedText = normalizeJinaMarkdown(rawMarkdown);
      contentCache.set(item.sourceHash, normalizedText);

      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'completed',
          httpStatus: result.status,
          normalizedText,
          rawPayload: { markdown: rawMarkdown },
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
    } catch (error) {
      const status = error instanceof HttpStatusError ? error.status : null;
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'failed',
          httpStatus: status,
          errorText: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
    }
  }
}

export async function processGitHubEnrichment(runId: string): Promise<void> {
  if (!env.GITHUB_TOKEN) {
    await db
      .update(matchingEnrichmentItems)
      .set({
        status: 'skipped',
        errorText: 'GITHUB_TOKEN is not configured',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(matchingEnrichmentItems.runId, runId),
          eq(matchingEnrichmentItems.provider, 'github'),
          eq(matchingEnrichmentItems.status, 'pending')
        )
      );
    return;
  }

  const pendingItems = await db
    .select({
      id: matchingEnrichmentItems.id,
      sourceValue: matchingEnrichmentItems.sourceValue,
      sourceHash: matchingEnrichmentItems.sourceHash,
    })
    .from(matchingEnrichmentItems)
    .where(
      and(
        eq(matchingEnrichmentItems.runId, runId),
        eq(matchingEnrichmentItems.provider, 'github'),
        eq(matchingEnrichmentItems.status, 'pending')
      )
    );

  // Deduplicate by username so we don't query the same profile twice
  const contentCache = new Map<string, string>();

  for (const item of pendingItems) {
    const username = extractGitHubUsername(item.sourceValue);
    if (!username) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'skipped',
          errorText: 'Could not extract GitHub username from URL',
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
      continue;
    }

    const cachedText = contentCache.get(username.toLowerCase());
    if (cachedText) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'completed',
          normalizedText: cachedText,
          rawPayload: { reused: true, username },
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
      continue;
    }

    try {
      const result = await fetchGitHubProfile(username);
      if (!result.ok || !result.text) {
        await db
          .update(matchingEnrichmentItems)
          .set({
            status: 'failed',
            errorText: result.error ?? 'Unknown GitHub API error',
            updatedAt: new Date(),
          })
          .where(eq(matchingEnrichmentItems.id, item.id));
        continue;
      }

      contentCache.set(username.toLowerCase(), result.text);

      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'completed',
          normalizedText: result.text,
          rawPayload: { username },
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
    } catch (error) {
      await db
        .update(matchingEnrichmentItems)
        .set({
          status: 'failed',
          errorText: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(matchingEnrichmentItems.id, item.id));
    }
  }
}

export async function getEnrichmentSummaryByProfile(runId: string, profileIds: string[]) {
  if (profileIds.length === 0)
    return new Map<
      string,
      { clay: string[]; jina: string[]; github: string[]; topics: string[] }
    >();

  const rows = await db
    .select({
      profileId: matchingEnrichmentItems.profileId,
      provider: matchingEnrichmentItems.provider,
      sourceKind: matchingEnrichmentItems.sourceKind,
      normalizedText: matchingEnrichmentItems.normalizedText,
      sourceValue: matchingEnrichmentItems.sourceValue,
      status: matchingEnrichmentItems.status,
    })
    .from(matchingEnrichmentItems)
    .where(
      and(
        eq(matchingEnrichmentItems.runId, runId),
        inArray(matchingEnrichmentItems.profileId, profileIds),
        eq(matchingEnrichmentItems.status, 'completed')
      )
    );

  const map = new Map<
    string,
    { clay: string[]; jina: string[]; github: string[]; topics: string[] }
  >();
  for (const profileId of profileIds) {
    map.set(profileId, { clay: [], jina: [], github: [], topics: [] });
  }

  for (const row of rows) {
    const existing = map.get(row.profileId);
    if (!existing) continue;

    if (row.provider === 'clay' && row.normalizedText) {
      existing.clay.push(row.normalizedText);
      continue;
    }

    if (row.provider === 'github' && row.normalizedText) {
      existing.github.push(row.normalizedText);
      continue;
    }

    if (row.provider === 'jina' && row.normalizedText) {
      existing.jina.push(row.normalizedText);
      continue;
    }

    if (row.sourceKind === 'topic_text') {
      existing.topics.push(row.normalizedText || row.sourceValue);
    }
  }

  return map;
}
