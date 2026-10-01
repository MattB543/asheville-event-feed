/**
 * The news AI pipeline (docs/news/05-v1-plan.md §6.2-6.5). One run:
 *
 *   1. Enrich new or changed articles (the local gate, our headline and summary).
 *   2. Embed live articles.
 *   3. Cluster unclustered live articles into stories.
 *   4. Recompute dirty stories (synthesis for multi-outlet stories), then the
 *      per-day cap on live community stories.
 *   5. Recompute Top and the daily summaries for the days that need it.
 *
 * Everything runs against one absolute deadline: no model call starts after
 * it, and each step stops cleanly where it is. Whatever is left (unenriched
 * articles, unclustered articles, dirty stories) is picked up by the next run.
 * A fatal model error (Azure rejecting the credentials, the deployment or a
 * request parameter) ends the run as a failure before anything is written for
 * the article that hit it.
 *
 * Called by app/api/cron/news-ai/route.ts and scripts/news/run-local.ts, which
 * both take the lease first (acquireNewsAiLease): the run's own 'news-ai' row
 * in cron_job_runs, of which at most one can be `running`.
 */

import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cronJobRuns, newsArticles, newsDays, newsStories } from '@/lib/db/schema';
import { isAIEnabled, isAzureAIEnabled } from '@/lib/ai/provider-clients';
import { startCronJob } from '@/lib/cron/jobTracker';
import { formatDuration } from '@/lib/utils/cron';
import { newShortId } from './db';
import {
  callNewsModel,
  meteredCaller,
  type NewsModelCaller,
  type NewsModelResult,
  type TokenMeter,
} from './ai/call';
import { enrichArticle, type EnrichmentOutcome } from './ai/enrich';
import { embedNewsText, newsEmbeddingText } from './ai/embed';
import {
  CLUSTER_MIN_SIMILARITY,
  CLUSTER_WINDOW_AFTER_DAYS,
  CLUSTER_WINDOW_BEFORE_DAYS,
  decideCluster,
  pickCandidateStories,
  type CandidateStory,
  type ClusterArticle,
  type ClusterDecision,
} from './ai/cluster';
import { synthesizeStory, type SynthesisMember } from './ai/synthesize';
import { dailyInputHash, summarizeDay } from './ai/daily';
import {
  COMMUNITY_LIVE_PER_DAY,
  etDay,
  mostCommon,
  pickLead,
  pickTop,
  shiftDay,
  storyImage,
  storyScore,
} from './ai/rules';
import type { NewsSourceKind } from './types';

/** Default run budget; the route passes start + 660s explicitly. */
const DEFAULT_RUN_MS = 660_000;
/** A 'news-ai' row still `running` this long after it started is a dead run (maxDuration is 800s). */
const LEASE_MINUTES = 15;

/** Articles published longer ago than this are never enriched for the first time. */
const ENRICH_WINDOW_DAYS = 14;
const ENRICH_CONCURRENCY = 8;
const ENRICH_PER_RUN = 200;
/** An article waiting on full text is enriched anyway once it's this old. */
const FULLTEXT_SETTLE_MINUTES = 60;
const MAX_AI_ATTEMPTS = 3;
/** This many transient model failures in a row means an outage: stop calling for this run. */
const OUTAGE_STREAK = 4;

const EMBED_CONCURRENCY = 8;
const SYNTH_CONCURRENCY = 4;

/** The per-day community cap is re-applied to filing days this recent. */
const COMMUNITY_CAP_DAYS = 14;

/**
 * A day whose Top must be recomputed keeps its summary but gets this prefix on
 * its input_hash. The next Top step re-ranks the day and regenerates the
 * summary only if the hash without the prefix no longer matches.
 */
const STALE_PREFIX = 'stale:';

export interface NewsAiResult {
  enriched: number;
  /** Articles enriched as live this run. */
  live: number;
  skipped: { byReason: Record<string, number> };
  contentFiltered: number;
  aiFailed: number;
  /** Failed enrichment calls left for the next run. */
  enrichRetry: number;
  embedded: number;
  clustered: {
    attachedLlm: number;
    attachedLink: number;
    deferred: number;
    newStories: number;
    llmCalls: number;
  };
  recomputed: number;
  synthesized: number;
  synthesisFailed: number;
  refiled: number;
  storiesHidden: number;
  communityLiveChanged: number;
  topDaysChanged: number;
  daysSummarized: number;
  daysCleared: number;
  tokens: { in: number; out: number; calls: number };
  backlog: { needsEnrich: number; unembedded: number; unclustered: number; dirty: number };
  msByStep: { enrich: number; embed: number; cluster: number; recompute: number; top: number };
  hitDeadline: boolean;
}

interface RunContext {
  deadline: number;
  call: NewsModelCaller;
  result: NewsAiResult;
  /** Days whose Top must be recomputed this run, beyond today/yesterday and stale or missing days. */
  topDays: Set<string>;
}

function emptyResult(): NewsAiResult {
  return {
    enriched: 0,
    live: 0,
    skipped: { byReason: {} },
    contentFiltered: 0,
    aiFailed: 0,
    enrichRetry: 0,
    embedded: 0,
    clustered: { attachedLlm: 0, attachedLink: 0, deferred: 0, newStories: 0, llmCalls: 0 },
    recomputed: 0,
    synthesized: 0,
    synthesisFailed: 0,
    refiled: 0,
    storiesHidden: 0,
    communityLiveChanged: 0,
    topDaysChanged: 0,
    daysSummarized: 0,
    daysCleared: 0,
    tokens: { in: 0, out: 0, calls: 0 },
    backlog: { needsEnrich: 0, unembedded: 0, unclustered: 0, dirty: 0 },
    msByStep: { enrich: 0, embed: 0, cluster: 0, recompute: 0, top: 0 },
    hitDeadline: false,
  };
}

function pastDeadline(ctx: RunContext): boolean {
  if (Date.now() < ctx.deadline) return false;
  ctx.result.hitDeadline = true;
  return true;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

/**
 * Thrown by the run's model caller on a fatal result. Steps let it through,
 * so the run ends as a failure with nothing written for the article.
 */
class FatalModelError extends Error {}

/** The run's model caller answers this once the deadline has passed: transient, so steps stop. */
const DEADLINE_PASSED: NewsModelResult = {
  ok: false,
  reason: 'transient',
  error: 'Run deadline passed',
  usage: { inputTokens: 0, outputTokens: 0 },
};

/**
 * Run `fn` over `items`, `concurrency` at a time, starting nothing once
 * `stop()` says so or an item has thrown. Items already started finish, then
 * the first error is rethrown.
 */
async function pool<T>(
  items: T[],
  concurrency: number,
  stop: () => boolean,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const errors: unknown[] = [];
  const worker = async () => {
    while (next < items.length && errors.length === 0 && !stop()) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (errors.length > 0) throw errors[0];
}

const a = newsArticles;
const s = newsStories;

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

/** Postgres unique_violation, possibly wrapped by Drizzle (the driver error is the cause). */
function isUniqueViolation(error: unknown): boolean {
  const pgError = error instanceof Error && error.cause ? error.cause : error;
  return !!pgError && typeof pgError === 'object' && 'code' in pgError && pgError.code === '23505';
}

/**
 * Take the news-ai lease: returns this run's cron_job_runs id, or null when
 * another run holds it. The lease is the run's own `running` row; the partial
 * unique index cron_job_runs_one_running_news_ai (drizzle/0020_news_ai_lease.sql)
 * lets only one exist, so two runs starting together can't both get one. A row
 * still running after LEASE_MINUTES is a run that died without recording its
 * end, and is failed first. Any other error throws: with no row there is no
 * lease, and the caller must not run.
 */
export async function acquireNewsAiLease(): Promise<string | null> {
  await db
    .update(cronJobRuns)
    .set({ status: 'failed', completedAt: sql`now()`, result: { error: 'lease expired' } })
    .where(
      and(
        eq(cronJobRuns.jobName, 'news-ai'),
        eq(cronJobRuns.status, 'running'),
        sql`${cronJobRuns.startedAt} < now() - make_interval(mins => ${LEASE_MINUTES}::int)`
      )
    );
  try {
    return await startCronJob('news-ai');
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 1. Enrich
// ---------------------------------------------------------------------------

/** Full text is settled: fetched or not coming, or the article has waited long enough. */
const fulltextSettled = sql`(
  ${a.fulltextStatus} IN ('none_needed', 'fetched', 'unavailable')
  OR (${a.fulltextStatus} = 'failed' AND ${a.fulltextAttempts} >= 3)
  OR ${a.firstSeenAt} < now() - make_interval(mins => ${FULLTEXT_SETTLE_MINUTES}::int)
)`;
const needsEnrichment = and(
  ne(a.state, 'hidden'),
  sql`${a.enrichedHash} IS DISTINCT FROM ${a.inputHash}`,
  sql`${a.publishedAt} >= now() - make_interval(days => ${ENRICH_WINDOW_DAYS}::int)`
);

function countSkip(ctx: RunContext, reason: string) {
  ctx.result.skipped.byReason[reason] = (ctx.result.skipped.byReason[reason] ?? 0) + 1;
}

async function markStoryDirty(
  tx: Pick<typeof db, 'update'>,
  storyId: string | null | undefined
): Promise<void> {
  // Never bumps the story's updated_at: recompute compares members against it.
  if (storyId) await tx.update(s).set({ dirty: true }).where(eq(s.id, storyId));
}

async function enrichStep(ctx: RunContext): Promise<void> {
  const tooOld = await db
    .update(a)
    .set({ state: 'skipped', skipReason: 'too_old', updatedAt: sql`now()` })
    .where(
      and(
        eq(a.state, 'pending'),
        isNull(a.enrichedHash),
        sql`${a.publishedAt} < now() - make_interval(days => ${ENRICH_WINDOW_DAYS}::int)`
      )
    )
    .returning({ id: a.id });
  for (let i = 0; i < tooOld.length; i++) countSkip(ctx, 'too_old');

  const rows = await db
    .select({
      id: a.id,
      url: a.url,
      outletName: a.outletName,
      outletDomain: a.outletDomain,
      kind: a.kind,
      publishedAt: a.publishedAt,
      title: a.title,
      dek: a.dek,
      contentText: a.contentText,
      paywalled: a.paywalled,
      inputHash: a.inputHash,
      aiAttempts: a.aiAttempts,
    })
    .from(a)
    .where(and(needsEnrichment, fulltextSettled))
    .orderBy(asc(a.publishedAt), asc(a.id))
    .limit(ENRICH_PER_RUN);

  let transientStreak = 0;
  const stop = () => pastDeadline(ctx) || transientStreak >= OUTAGE_STREAK;

  await pool(rows, ENRICH_CONCURRENCY, stop, async (row) => {
    let outcome: EnrichmentOutcome;
    try {
      outcome = await enrichArticle(
        {
          outletName: row.outletName,
          outletDomain: row.outletDomain,
          kind: row.kind as NewsSourceKind,
          url: row.url,
          publishedAt: row.publishedAt,
          title: row.title,
          dek: row.dek,
          contentText: row.contentText,
          paywalled: row.paywalled,
        },
        ctx.call
      );
    } catch (error) {
      if (error instanceof FatalModelError) throw error;
      outcome = {
        status: 'failed',
        transient: false,
        error: errorText(error),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    transientStreak = outcome.status === 'failed' && outcome.transient ? transientStreak + 1 : 0;

    // Every write is guarded on state <> 'hidden', so a takedown mid-call wins.
    // enriched_hash gets the hash we READ: if ingest changed the text meanwhile,
    // the mismatch sends the article back through enrichment next run.
    const notHidden = and(eq(a.id, row.id), ne(a.state, 'hidden'));
    try {
      if (outcome.status === 'ok') {
        const r = outcome.result;
        await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(a)
            .set({
              state: r.state,
              skipReason: r.skipReason,
              buncombe: r.buncombe,
              aiHeadline: r.headline,
              aiSummary: r.summary,
              whatHappened: r.whatHappened,
              entities: r.entities,
              topics: r.topics,
              place: r.place,
              importance: r.importance,
              communityImportant: r.communityImportant,
              aiAttempts: 0,
              aiError: null,
              enrichedAt: sql`now()`,
              enrichedHash: row.inputHash,
              embedding: null,
              updatedAt: sql`now()`,
            })
            .where(notHidden)
            .returning({ storyId: a.storyId });
          await markStoryDirty(tx, updated?.storyId);
        });
        ctx.result.enriched++;
        if (r.state === 'live') ctx.result.live++;
        else countSkip(ctx, r.skipReason ?? 'unknown');
      } else if (outcome.status === 'content_filter') {
        await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(a)
            .set({
              state: 'skipped',
              skipReason: 'content_filter',
              aiError: outcome.error.slice(0, 500),
              enrichedAt: sql`now()`,
              enrichedHash: row.inputHash,
              embedding: null,
              updatedAt: sql`now()`,
            })
            .where(notHidden)
            .returning({ storyId: a.storyId });
          await markStoryDirty(tx, updated?.storyId);
        });
        ctx.result.contentFiltered++;
        countSkip(ctx, 'content_filter');
      } else if (outcome.transient) {
        // Throttling, timeouts and outages don't use up the article's attempts.
        await db
          .update(a)
          .set({ aiError: outcome.error.slice(0, 500) })
          .where(notHidden);
        ctx.result.enrichRetry++;
      } else {
        const attempts = row.aiAttempts + 1;
        if (attempts >= MAX_AI_ATTEMPTS) {
          await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(a)
              .set({
                state: 'skipped',
                skipReason: 'ai_failed',
                aiAttempts: attempts,
                aiError: outcome.error.slice(0, 500),
                enrichedHash: row.inputHash,
                embedding: null,
                updatedAt: sql`now()`,
              })
              .where(notHidden)
              .returning({ storyId: a.storyId });
            await markStoryDirty(tx, updated?.storyId);
          });
          ctx.result.aiFailed++;
          countSkip(ctx, 'ai_failed');
        } else {
          await db
            .update(a)
            .set({ aiAttempts: attempts, aiError: outcome.error.slice(0, 500) })
            .where(notHidden);
          ctx.result.enrichRetry++;
        }
      }
    } catch (error) {
      console.error(`[NewsAI] Could not record enrichment of ${row.id}: ${errorText(error)}`);
    }
  });

  if (transientStreak >= OUTAGE_STREAK) {
    console.warn(`[NewsAI] Enrichment stopped after ${OUTAGE_STREAK} transient failures in a row`);
  }
}

// ---------------------------------------------------------------------------
// 2. Embed
// ---------------------------------------------------------------------------

async function embedStep(ctx: RunContext): Promise<void> {
  const rows = await db
    .select({
      id: a.id,
      headline: a.aiHeadline,
      whatHappened: a.whatHappened,
      enrichedHash: a.enrichedHash,
    })
    .from(a)
    .where(
      and(
        eq(a.state, 'live'),
        isNull(a.embedding),
        isNotNull(a.aiHeadline),
        isNotNull(a.whatHappened)
      )
    )
    .orderBy(asc(a.publishedAt), asc(a.id));

  let failStreak = 0;
  const stop = () => pastDeadline(ctx) || failStreak >= OUTAGE_STREAK;
  await pool(rows, EMBED_CONCURRENCY, stop, async (row) => {
    const vector = await embedNewsText(newsEmbeddingText(row.headline!, row.whatHappened!));
    if (!vector) {
      failStreak++;
      return;
    }
    failStreak = 0;
    // Only if the article wasn't re-enriched in the meantime.
    await db
      .update(a)
      .set({ embedding: vector })
      .where(
        and(
          eq(a.id, row.id),
          eq(a.state, 'live'),
          sql`${a.enrichedHash} IS NOT DISTINCT FROM ${row.enrichedHash}`
        )
      );
    ctx.result.embedded++;
  });
}

// ---------------------------------------------------------------------------
// 3. Cluster
// ---------------------------------------------------------------------------

interface UnclusteredRow {
  id: string;
  kind: string;
  outletName: string;
  publishedAt: Date;
  title: string;
  whatHappened: string | null;
  entities: string[];
  linkedUrl: string | null;
  aiHeadline: string | null;
  aiSummary: string | null;
  topics: string[];
  place: string | null;
  importance: number | null;
}

/** URL comparison key: no scheme, no www., no trailing slash, lowercased. */
const urlKey = (u: unknown) =>
  sql`regexp_replace(regexp_replace(lower(${u}), '^https?://(www\\.)?', ''), '/+$', '')`;

/** Live members of each story, as the cluster prompt shows them. */
async function storyMembers(storyIds: string[]): Promise<Map<string, ClusterArticle[]>> {
  const rows = await db
    .select({
      id: a.id,
      storyId: a.storyId,
      outletName: a.outletName,
      kind: a.kind,
      publishedAt: a.publishedAt,
      title: a.title,
      whatHappened: a.whatHappened,
      entities: a.entities,
    })
    .from(a)
    .where(and(inArray(a.storyId, storyIds), eq(a.state, 'live')));
  const byStory = new Map<string, ClusterArticle[]>();
  for (const r of rows) {
    const list = byStory.get(r.storyId!) ?? [];
    list.push({
      id: r.id,
      outletName: r.outletName,
      kind: r.kind as NewsSourceKind,
      publishedAt: r.publishedAt,
      title: r.title,
      whatHappened: r.whatHappened ?? '',
      entities: r.entities,
    });
    byStory.set(r.storyId!, list);
  }
  return byStory;
}

/** Live, embedded members of non-hidden stories in this article's window, with similarity. */
async function scoredMembers(articleId: string) {
  return db.execute<{ story_id: string; similarity: number }>(sql`
    SELECT m.story_id, 1 - (m.embedding <=> t.embedding) AS similarity
    FROM news_articles t
    JOIN news_articles m
      ON m.published_at >= t.published_at - make_interval(days => ${CLUSTER_WINDOW_BEFORE_DAYS}::int)
     AND m.published_at <= t.published_at + make_interval(days => ${CLUSTER_WINDOW_AFTER_DAYS}::int)
    JOIN news_stories st ON st.id = m.story_id
    WHERE t.id = ${articleId}
      AND m.id <> t.id
      AND m.state = 'live'
      AND m.embedding IS NOT NULL
      AND st.state <> 'hidden'
      AND 1 - (m.embedding <=> t.embedding) >= ${CLUSTER_MIN_SIMILARITY}`);
}

class RollbackSignal extends Error {}

async function attachToStory(articleId: string, storyId: string, reason: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(a)
      .set({ storyId, clusterReason: reason, updatedAt: sql`now()` })
      .where(and(eq(a.id, articleId), isNull(a.storyId), eq(a.state, 'live')))
      .returning({ id: a.id });
    if (updated.length === 0) return false;
    await markStoryDirty(tx, storyId);
    return true;
  });
}

/**
 * A new story seeded from one article, created and assigned in one
 * transaction. The story's updated_at equals the article's (same transaction),
 * which is what keeps the founding member from counting as "new" at recompute.
 */
async function createStory(row: UnclusteredRow, reason: string): Promise<boolean> {
  const tier = row.kind === 'community' ? 'community' : 'newsroom';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.transaction(async (tx) => {
        const [story] = await tx
          .insert(s)
          .values({
            shortId: newShortId(),
            tier,
            state: 'pending',
            headline: row.aiHeadline ?? row.title,
            summary: row.aiSummary ?? '',
            topics: row.topics,
            place: row.place,
            importance: tier === 'newsroom' ? (row.importance ?? 0) : 0,
            filingDay: etDay(row.publishedAt),
            leadArticleId: row.id,
            articleCount: tier === 'newsroom' ? 1 : 0,
            outletCount: tier === 'newsroom' ? 1 : 0,
            firstPublishedAt: row.publishedAt,
            lastArticleAt: row.publishedAt,
            dirty: true,
            createdAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .returning({ id: s.id });
        const updated = await tx
          .update(a)
          .set({ storyId: story.id, clusterReason: reason, updatedAt: sql`now()` })
          .where(and(eq(a.id, row.id), isNull(a.storyId), eq(a.state, 'live')))
          .returning({ id: a.id });
        if (updated.length === 0) throw new RollbackSignal();
      });
      return true;
    } catch (error) {
      if (error instanceof RollbackSignal) return false;
      // A short_id clash: try again with a fresh one.
      if (/short_id/.test(errorText(error)) && attempt < 2) continue;
      throw error;
    }
  }
  return false;
}

async function clusterStep(ctx: RunContext): Promise<void> {
  // Newsroom articles first so community posts can find their stories; each
  // tier oldest first.
  const rows: UnclusteredRow[] = await db
    .select({
      id: a.id,
      kind: a.kind,
      outletName: a.outletName,
      publishedAt: a.publishedAt,
      title: a.title,
      whatHappened: a.whatHappened,
      entities: a.entities,
      linkedUrl: a.linkedUrl,
      aiHeadline: a.aiHeadline,
      aiSummary: a.aiSummary,
      topics: a.topics,
      place: a.place,
      importance: a.importance,
    })
    .from(a)
    .where(and(eq(a.state, 'live'), isNull(a.storyId), isNotNull(a.embedding)))
    .orderBy(sql`(${a.kind} = 'community')`, asc(a.publishedAt), asc(a.id));

  let transientStreak = 0;
  for (const row of rows) {
    if (pastDeadline(ctx) || transientStreak >= OUTAGE_STREAK) break;
    try {
      // Reddit link posts follow the article they link to, with no model call.
      if (row.kind === 'community' && row.linkedUrl) {
        const [target] = await db
          .select({ id: a.id, state: a.state, storyId: a.storyId })
          .from(a)
          .where(and(ne(a.id, row.id), sql`${urlKey(a.url)} = ${urlKey(row.linkedUrl)}`))
          .limit(1);
        if (target?.storyId && target.state === 'live') {
          if (await attachToStory(row.id, target.storyId, `link: ${row.linkedUrl}`)) {
            ctx.result.clustered.attachedLink++;
          }
          continue;
        }
        if (target && (target.state === 'pending' || target.state === 'live')) {
          ctx.result.clustered.deferred++; // The target isn't enriched or clustered yet.
          continue;
        }
      }

      const scored = await scoredMembers(row.id);
      const picked = pickCandidateStories(
        scored.map((r) => ({ storyId: r.story_id, similarity: Number(r.similarity) }))
      );
      let candidates: CandidateStory[] = [];
      if (picked.length > 0) {
        const members = await storyMembers(picked.map((p) => p.storyId));
        candidates = picked
          .map((p) => ({ ...p, members: members.get(p.storyId) ?? [] }))
          .filter((c) => c.members.length > 0);
      }

      const article: ClusterArticle = {
        id: row.id,
        outletName: row.outletName,
        kind: row.kind as NewsSourceKind,
        publishedAt: row.publishedAt,
        title: row.title,
        whatHappened: row.whatHappened ?? '',
        entities: row.entities,
      };
      const decision: ClusterDecision = await decideCluster(article, candidates, ctx.call);
      if (candidates.length > 0) ctx.result.clustered.llmCalls++;

      if (decision.decision === 'defer') {
        transientStreak++;
        ctx.result.clustered.deferred++;
        continue;
      }
      transientStreak = 0;
      if (decision.decision === 'same') {
        if (await attachToStory(row.id, decision.storyId, decision.reason)) {
          ctx.result.clustered.attachedLlm++;
        }
      } else if (await createStory(row, decision.reason)) {
        ctx.result.clustered.newStories++;
      }
    } catch (error) {
      if (error instanceof FatalModelError) throw error;
      console.error(`[NewsAI] Clustering ${row.id} failed: ${errorText(error)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Recompute dirty stories
// ---------------------------------------------------------------------------

type StoryRow = typeof newsStories.$inferSelect;

interface MemberRow {
  id: string;
  kind: string;
  state: string;
  outletDomain: string;
  outletName: string;
  title: string;
  dek: string | null;
  contentText: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  aiHeadline: string | null;
  aiSummary: string | null;
  importance: number | null;
  topics: string[];
  place: string | null;
  communityImportant: boolean | null;
  /** Attached or re-enriched since the story was last recomputed. */
  isNew: boolean;
}

async function loadMembers(story: StoryRow): Promise<MemberRow[]> {
  return db
    .select({
      id: a.id,
      kind: a.kind,
      state: a.state,
      outletDomain: a.outletDomain,
      outletName: a.outletName,
      title: a.title,
      dek: a.dek,
      contentText: a.contentText,
      imageUrl: a.imageUrl,
      publishedAt: a.publishedAt,
      aiHeadline: a.aiHeadline,
      aiSummary: a.aiSummary,
      importance: a.importance,
      topics: a.topics,
      place: a.place,
      communityImportant: a.communityImportant,
      // Compared in SQL: JS Dates drop the microseconds.
      isNew: sql<boolean>`${a.updatedAt} > ${s.updatedAt}`,
    })
    .from(a)
    .innerJoin(s, eq(s.id, a.storyId))
    .where(eq(a.storyId, story.id));
}

const byPublished = (x: MemberRow, y: MemberRow) =>
  x.publishedAt.getTime() - y.publishedAt.getTime() || x.id.localeCompare(y.id);

/**
 * Reopen days for the Top step: this run's (ctx.topDays) and, durably, the
 * next run's if this one stops first (the stale prefix on news_days).
 */
async function markDaysStale(
  ctx: RunContext,
  tx: Pick<typeof db, 'update'>,
  days: string[]
): Promise<void> {
  if (days.length === 0) return;
  for (const d of days) ctx.topDays.add(d);
  await tx
    .update(newsDays)
    .set({ inputHash: sql`${STALE_PREFIX} || ${newsDays.inputHash}` })
    .where(
      and(inArray(newsDays.day, days), sql`${newsDays.inputHash} NOT LIKE ${STALE_PREFIX + '%'}`)
    );
}

/**
 * Recompute one dirty story (§6.4). Returns false when it must wait for a
 * later run (synthesis needed but no time, or a transient model failure); the
 * story then stays dirty and untouched.
 */
async function recomputeStory(ctx: RunContext, story: StoryRow): Promise<boolean> {
  const members = await loadMembers(story);
  const eligible = members.filter((m) => m.state === 'live').sort(byPublished);
  const newsroom = eligible.filter((m) => m.kind !== 'community');
  const tier = newsroom.length > 0 ? 'newsroom' : 'community';

  // No live members: hide it. A Top story leaving its day reopens that day.
  if (eligible.length === 0) {
    await db.transaction(async (tx) => {
      await tx
        .update(s)
        .set({ state: 'hidden', topRank: null, dirty: false, updatedAt: sql`now()` })
        .where(eq(s.id, story.id));
      if (story.topRank !== null) await markDaysStale(ctx, tx, [story.filingDay]);
    });
    if (story.state !== 'hidden') ctx.result.storiesHidden++;
    return true;
  }

  const basis = tier === 'newsroom' ? newsroom : eligible;
  const lead = pickLead(basis)!;
  let headline = story.headline;
  let summary = story.summary;
  let importance = story.importance;
  let filingDay = story.filingDay;

  if (tier === 'community') {
    // The earliest post's attributive text. Community stories never rank.
    headline = basis[0].aiHeadline ?? basis[0].title;
    summary = basis[0].aiSummary ?? '';
    importance = 0;
  } else if (newsroom.length === 1) {
    headline = newsroom[0].aiHeadline ?? newsroom[0].title;
    summary = newsroom[0].aiSummary ?? '';
    importance = newsroom[0].importance ?? 0;
  } else {
    const anyNew = newsroom.some((m) => m.isNew);
    const needsSynthesis =
      anyNew || newsroom.length !== story.articleCount || story.tier !== 'newsroom';
    if (needsSynthesis) {
      if (pastDeadline(ctx)) return false;
      const synthMembers: SynthesisMember[] = newsroom.map((m) => ({
        outletName: m.outletName,
        outletDomain: m.outletDomain,
        kind: m.kind as NewsSourceKind,
        publishedAt: m.publishedAt,
        title: m.title,
        dek: m.dek,
        contentText: m.contentText,
        isNew: m.isNew,
      }));
      const outcome = await synthesizeStory(
        { currentHeadline: story.headline, currentSummary: story.summary, members: synthMembers },
        ctx.call
      );
      if (outcome.status === 'ok') {
        ctx.result.synthesized++;
        headline = outcome.result.headline;
        summary = outcome.result.summary;
        importance = outcome.result.importance;
        // Filing day moves forward only, and only for a new development in new reporting.
        if (outcome.result.newDevelopment && anyNew) {
          const newest = etDay(newsroom[newsroom.length - 1].publishedAt);
          if (newest > filingDay) filingDay = newest;
        }
      } else {
        ctx.result.synthesisFailed++;
        console.warn(`[NewsAI] Synthesis failed for ${story.shortId}: ${outcome.error}`);
        if (outcome.reason === 'transient') return false;
        // Permanent for this input: fall back to the lead's own text. The
        // story's current text may carry facts only a taken-down outlet reported.
        headline = lead.aiHeadline ?? lead.title;
        summary = lead.aiSummary ?? '';
        importance = lead.importance ?? 0;
      }
    }
  }

  // A community story promoted by its first newsroom article files on that article's day.
  if (story.tier === 'community' && tier === 'newsroom') {
    const first = etDay(newsroom[0].publishedAt);
    if (first > filingDay) filingDay = first;
  }

  const outletCount = new Set(newsroom.map((m) => m.outletDomain)).size;
  const score = storyScore(
    importance,
    outletCount,
    newsroom.some((m) => m.kind === 'outlet')
  );
  const topics = mostCommon(basis.map((m) => m.topics)).slice(0, 2);
  const place = mostCommon(basis.filter((m) => m.place).map((m) => [m.place!]))[0] ?? null;

  // Community stories clear the bar only with an important post; the per-day
  // cap (applyCommunityCap) decides which of those are live.
  let state: 'live' | 'pending';
  if (tier === 'newsroom') {
    state = 'live';
  } else {
    const clearsBar = basis.some((m) => m.communityImportant === true);
    state = clearsBar && story.state === 'live' ? 'live' : 'pending';
  }

  // Days whose Top this changes: the day a Top story leaves (refiled, or no
  // longer newsroom), and the day a newsroom story arrives on (refiled, or
  // newly live: a late article, or a backfill day summarized before all its
  // articles were enriched). Other days stay frozen.
  const refiled = filingDay !== story.filingDay;
  const losesTop = story.topRank !== null && (refiled || tier === 'community');
  const arrives =
    tier === 'newsroom' && (refiled || story.state !== 'live' || story.tier !== 'newsroom');
  const stale = [
    ...new Set([...(losesTop ? [story.filingDay] : []), ...(arrives ? [filingDay] : [])]),
  ];
  if (refiled) ctx.result.refiled++;

  await db.transaction(async (tx) => {
    await tx
      .update(s)
      .set({
        tier,
        state,
        headline,
        summary,
        importance,
        score,
        imageUrl: storyImage(lead, basis),
        topics,
        place,
        filingDay,
        topRank: losesTop || refiled ? null : story.topRank,
        leadArticleId: lead.id,
        articleCount: newsroom.length,
        outletCount,
        firstPublishedAt: basis[0].publishedAt,
        lastArticleAt: basis[basis.length - 1].publishedAt,
        dirty: false,
        updatedAt: sql`now()`,
      })
      .where(eq(s.id, story.id));
    await markDaysStale(ctx, tx, stale);
  });
  return true;
}

async function recomputeStep(ctx: RunContext): Promise<void> {
  const dirty = await db
    .select()
    .from(s)
    .where(eq(s.dirty, true))
    .orderBy(asc(s.filingDay), asc(s.id));

  // Synthesis is the slow part; a few stories at a time.
  await pool(
    dirty,
    SYNTH_CONCURRENCY,
    () => pastDeadline(ctx),
    async (story) => {
      try {
        if (await recomputeStory(ctx, story)) ctx.result.recomputed++;
      } catch (error) {
        if (error instanceof FatalModelError) throw error;
        console.error(`[NewsAI] Recompute of ${story.shortId} failed: ${errorText(error)}`);
      }
    }
  );

  await applyCommunityCap(ctx);
}

/**
 * At most COMMUNITY_LIVE_PER_DAY community stories are live per filing day:
 * those with an important post, by engagement (when a feed carries it) and
 * then recency. The rest stay pending.
 *
 * Applied to every recent filing day with a pending community story that
 * qualifies, found in the database, so a story recompute left pending is
 * published by a later run even if this one stopped first. Re-applying it to
 * a day changes nothing.
 */
async function applyCommunityCap(ctx: RunContext): Promise<void> {
  const days = await db.execute<{ day: string }>(sql`
    SELECT DISTINCT st.filing_day::text AS day
    FROM news_stories st
    JOIN news_articles m ON m.story_id = st.id AND m.state = 'live'
    WHERE st.tier = 'community' AND st.state = 'pending' AND st.dirty = false
      AND m.community_important IS TRUE
      AND st.filing_day >= ${shiftDay(etDay(new Date()), -COMMUNITY_CAP_DAYS)}::date`);
  for (const { day } of days) {
    const rows = await db.execute<{
      id: string;
      state: string;
      important: boolean;
      score: number;
      comments: number;
      first_published_at: string;
    }>(sql`
      SELECT st.id, st.state, st.first_published_at::text,
             bool_or(m.community_important IS TRUE) AS important,
             max(coalesce((m.engagement->>'score')::int, 0)) AS score,
             max(coalesce((m.engagement->>'comments')::int, 0)) AS comments
      FROM news_stories st
      JOIN news_articles m ON m.story_id = st.id AND m.state = 'live'
      WHERE st.tier = 'community' AND st.state <> 'hidden' AND st.dirty = false
        AND st.filing_day = ${day}
      GROUP BY st.id`);
    const ranked = [...rows]
      .filter((r) => r.important)
      .sort(
        (x, y) =>
          y.score - x.score ||
          y.comments - x.comments ||
          y.first_published_at.localeCompare(x.first_published_at)
      );
    const live = new Set(ranked.slice(0, COMMUNITY_LIVE_PER_DAY).map((r) => r.id));
    for (const r of rows) {
      const want = live.has(r.id) ? 'live' : 'pending';
      if (r.state !== want) {
        await db.update(s).set({ state: want }).where(eq(s.id, r.id));
        ctx.result.communityLiveChanged++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Top and daily summaries
// ---------------------------------------------------------------------------

async function topStep(ctx: RunContext): Promise<void> {
  const today = etDay(new Date());
  const days = new Set<string>([today, shiftDay(today, -1), ...ctx.topDays]);
  // Days never summarized (the backfill, a day a takedown cleared) or reopened.
  const open = await db.execute<{ day: string }>(sql`
    SELECT DISTINCT st.filing_day::text AS day
    FROM news_stories st
    LEFT JOIN news_days d ON d.day = st.filing_day
    WHERE ((st.state = 'live' AND st.tier = 'newsroom') OR st.top_rank IS NOT NULL)
      AND (d.day IS NULL OR d.input_hash LIKE ${STALE_PREFIX + '%'})`);
  for (const r of open) days.add(r.day);

  // Newest first, so a deadline leaves the oldest days for the next run. A day
  // is never re-ranked without a chance to rewrite its summary.
  for (const day of [...days].sort().reverse()) {
    if (pastDeadline(ctx)) break;
    const stories = await db
      .select({
        id: s.id,
        shortId: s.shortId,
        headline: s.headline,
        summary: s.summary,
        score: s.score,
        firstPublishedAt: s.firstPublishedAt,
        topRank: s.topRank,
        state: s.state,
        tier: s.tier,
      })
      .from(s)
      .where(
        and(
          eq(s.filingDay, day),
          or(and(eq(s.state, 'live'), eq(s.tier, 'newsroom')), isNotNull(s.topRank))
        )
      );
    const top = pickTop(stories.filter((x) => x.state === 'live' && x.tier === 'newsroom'));
    const rank = new Map(top.map((x, i) => [x.id, i + 1]));

    let changed = false;
    for (const x of stories) {
      const want = rank.get(x.id) ?? null;
      if (x.topRank !== want) {
        await db.update(s).set({ topRank: want }).where(eq(s.id, x.id));
        changed = true;
      }
    }
    if (changed) ctx.result.topDaysChanged++;

    if (top.length === 0) {
      const deleted = await db
        .delete(newsDays)
        .where(eq(newsDays.day, day))
        .returning({ day: newsDays.day });
      if (deleted.length) ctx.result.daysCleared++;
      continue;
    }

    const input = top.map((x) => ({
      shortId: x.shortId,
      headline: x.headline,
      summary: x.summary,
    }));
    const hash = dailyInputHash(input);
    const [existing] = await db
      .select({ inputHash: newsDays.inputHash })
      .from(newsDays)
      .where(eq(newsDays.day, day));
    if (existing && existing.inputHash.replace(STALE_PREFIX, '') === hash) {
      // Reopened, but the same Top: the summary stands.
      if (existing.inputHash !== hash) {
        await db.update(newsDays).set({ inputHash: hash }).where(eq(newsDays.day, day));
      }
      continue;
    }

    const outcome = await summarizeDay(input, ctx.call);
    if (outcome.status !== 'ok') {
      // Left reopened or missing, so the next run tries again.
      console.warn(`[NewsAI] Daily summary for ${day} failed: ${outcome.error}`);
      if (existing) await markDaysStale(ctx, db, [day]);
      continue;
    }
    await db
      .insert(newsDays)
      .values({ day, summary: outcome.sentences, inputHash: hash, generatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: newsDays.day,
        set: { summary: outcome.sentences, inputHash: hash, generatedAt: sql`now()` },
      });
    ctx.result.daysSummarized++;
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function measureBacklog(result: NewsAiResult): Promise<void> {
  const [row] = await db.execute<{
    needs_enrich: number;
    unembedded: number;
    unclustered: number;
    dirty: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM news_articles
        WHERE state <> 'hidden' AND enriched_hash IS DISTINCT FROM input_hash
          AND published_at >= now() - make_interval(days => ${ENRICH_WINDOW_DAYS}::int)) AS needs_enrich,
      (SELECT count(*)::int FROM news_articles WHERE state = 'live' AND embedding IS NULL) AS unembedded,
      (SELECT count(*)::int FROM news_articles WHERE state = 'live' AND story_id IS NULL) AS unclustered,
      (SELECT count(*)::int FROM news_stories WHERE dirty) AS dirty`);
  result.backlog = {
    needsEnrich: row.needs_enrich,
    unembedded: row.unembedded,
    unclustered: row.unclustered,
    dirty: row.dirty,
  };
}

async function timed(
  result: NewsAiResult,
  step: keyof NewsAiResult['msByStep'],
  fn: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  await fn();
  result.msByStep[step] = Date.now() - start;
  console.log(`[NewsAI] ${step} done in ${formatDuration(result.msByStep[step])}`);
}

export interface RunNewsAiOptions {
  /** Epoch ms. No model call starts after it. Default: now + 660s. */
  deadline?: number;
  /** Model caller override (tests). Default: the news deployment. */
  call?: NewsModelCaller;
}

/** One run. The caller must hold the lease (acquireNewsAiLease). */
export async function runNewsAi(options: RunNewsAiOptions = {}): Promise<NewsAiResult> {
  if (!isAzureAIEnabled()) throw new Error('Azure OpenAI is not configured (AZURE_OPENAI_*)');
  if (!isAIEnabled()) throw new Error('Gemini is not configured (GEMINI_API_KEY)');

  const result = emptyResult();
  const meter: TokenMeter = { in: 0, out: 0, calls: 0 };
  const metered = meteredCaller(options.call ?? callNewsModel, meter);
  const ctx: RunContext = {
    deadline: options.deadline ?? Date.now() + DEFAULT_RUN_MS,
    // Every model attempt of the run passes here, so none starts after the
    // deadline, and a fatal answer ends the run.
    call: async (system, user) => {
      if (pastDeadline(ctx)) return DEADLINE_PASSED;
      const answer = await metered(system, user);
      if (!answer.ok && answer.reason === 'fatal') {
        throw new FatalModelError(`Fatal model error, stopping the run: ${answer.error}`);
      }
      return answer;
    },
    result,
    topDays: new Set(),
  };

  try {
    await timed(result, 'enrich', () => enrichStep(ctx));
    await timed(result, 'embed', () => embedStep(ctx));
    await timed(result, 'cluster', () => clusterStep(ctx));
    await timed(result, 'recompute', () => recomputeStep(ctx));
    await timed(result, 'top', () => topStep(ctx));
  } finally {
    result.tokens = { ...meter };
  }
  await measureBacklog(result);
  return result;
}
