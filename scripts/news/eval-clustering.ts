/**
 * Clustering eval (docs/news/05-v1-plan.md §6.8). Replays the hand-labelled
 * corpus in data/news/eval/ through the PRODUCTION enrichment, embedding and
 * cluster-decision functions, in memory: no database reads or writes.
 *
 * Usage:
 *   npx tsx scripts/news/eval-clustering.ts [--sample <label>] [--verbose]
 *
 * Model answers and embeddings are cached in %TEMP%\claude\news-eval\, keyed
 * by a hash of the prompt, model and options, so a re-run costs nothing and a
 * prompt change re-asks only what changed. The model has no temperature
 * control, so judge a prompt change on 2+ samples: `--sample b` re-asks every
 * cluster decision under a separate cache key (enrichment stays shared).
 *
 * Reports B-cubed P/R/F1 and false merges over the articles that reached
 * clustering, and lists the golden articles the enrichment gate skipped so the
 * denominator is visible. Ship bar: F1 >= 0.90 with <= 2 false merges.
 */

import '../../lib/config/env';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cosineSimilarity } from '../../lib/ai/embedding';
import {
  callNewsModel,
  meteredCaller,
  NEWS_MODEL_OPTIONS,
  type NewsModelCaller,
  type NewsModelResult,
  type TokenMeter,
} from '../../lib/news/ai/call';
import {
  decideCluster,
  inClusterWindow,
  pickCandidateStories,
  type CandidateStory,
  type ClusterArticle,
} from '../../lib/news/ai/cluster';
import { embedNewsText, newsEmbeddingText } from '../../lib/news/ai/embed';
import {
  enrichArticle,
  type EnrichmentInput,
  type EnrichmentOutcome,
} from '../../lib/news/ai/enrich';
import { newsDeployment } from '../../lib/news/ai/model';
import type { NewsSourceKind } from '../../lib/news/types';

const EVAL_DIR = path.join(__dirname, '..', '..', 'data', 'news', 'eval');
const CACHE_DIR = path.join(os.tmpdir(), 'claude', 'news-eval');
const MODEL_CACHE = path.join(CACHE_DIR, 'model-cache.json');
const EMBED_CACHE = path.join(CACHE_DIR, 'embed-cache.json');

/** "Now", pinned just after the corpus's newest item (2026-09-25T01:52Z). */
const NOW = new Date('2026-09-25T12:00:00Z');
const ENRICH_WINDOW_DAYS = 14;
const CONCURRENCY = 8;

const SHIP_F1 = 0.9;
const SHIP_FALSE_MERGES = 2;

interface CorpusItem {
  id: string;
  outlet: string;
  feed: string;
  title: string;
  dek: string;
  text: string;
  publishedAt: string;
  url: string;
  availability: 'full' | 'excerpt' | 'headline';
}

interface Golden {
  groups: Record<string, string[]>;
  ambiguous: [string, string][];
  excludeOutlets: string[];
  relatedButDistinct: [string, string][];
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

function loadJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback;
}

const modelCache = loadJson<Record<string, NewsModelResult>>(MODEL_CACHE, {});
const embedCache = loadJson<Record<string, number[]>>(EMBED_CACHE, {});
let dirty = 0;

function saveCaches(force = false) {
  if (!force && dirty < 10) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(MODEL_CACHE, JSON.stringify(modelCache));
  fs.writeFileSync(EMBED_CACHE, JSON.stringify(embedCache));
  dirty = 0;
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const stats = { modelCached: 0, modelNew: 0, embedCached: 0, embedNew: 0 };

/** callNewsModel behind the cache. Transient failures and errors aren't cached. */
function cachedCaller(salt: string): NewsModelCaller {
  return async (system, user) => {
    const key = sha(
      JSON.stringify({ model: newsDeployment(), options: NEWS_MODEL_OPTIONS, salt, system, user })
    );
    const hit = modelCache[key];
    if (hit) {
      stats.modelCached++;
      // Cached answers cost nothing this run.
      return { ...hit, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    const result = await callNewsModel(system, user);
    if (result.ok || result.reason === 'content_filter') {
      modelCache[key] = result;
      dirty++;
      saveCaches();
    }
    stats.modelNew++;
    return result;
  };
}

async function cachedEmbedding(text: string): Promise<number[] | null> {
  const key = sha(`RETRIEVAL_DOCUMENT\n${text}`);
  if (embedCache[key]) {
    stats.embedCached++;
    return embedCache[key];
  }
  const vector = await embedNewsText(text);
  if (vector) {
    embedCache[key] = vector;
    dirty++;
    saveCaches();
  }
  stats.embedNew++;
  return vector;
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** The corpus's feeds as the production `kind`. Google News items count as outlet reporting. */
function kindOf(item: CorpusItem): NewsSourceKind {
  if (item.feed === 'reddit') return 'community';
  if (item.feed === 'city') return 'government';
  return 'outlet';
}

/** Corpus Google News items carry news.google.com URLs, so the publisher domain comes from the name. */
const OUTLET_DOMAINS: Record<string, string> = {
  'The Asheville Citizen Times': 'citizen-times.com',
};

function enrichmentInput(item: CorpusItem): EnrichmentInput {
  return {
    outletName: item.outlet,
    outletDomain: OUTLET_DOMAINS[item.outlet],
    kind: kindOf(item),
    url: item.url,
    publishedAt: new Date(item.publishedAt),
    title: item.title,
    dek: item.dek || null,
    contentText: item.text || null,
  };
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function main() {
  const args = process.argv.slice(2);
  const sampleIdx = args.indexOf('--sample');
  const sample = sampleIdx >= 0 ? (args[sampleIdx + 1] ?? '') : '';
  const verbose = args.includes('--verbose');

  const corpus = JSON.parse(
    fs.readFileSync(path.join(EVAL_DIR, 'corpus.json'), 'utf8')
  ) as CorpusItem[];
  const golden = JSON.parse(fs.readFileSync(path.join(EVAL_DIR, 'golden.json'), 'utf8')) as Golden;

  const excluded = corpus.filter((d) => golden.excludeOutlets.includes(d.outlet));
  const tooOld = corpus.filter(
    (d) => NOW.getTime() - new Date(d.publishedAt).getTime() > ENRICH_WINDOW_DAYS * 86_400_000
  );
  const docs = corpus.filter((d) => !excluded.includes(d) && !tooOld.includes(d));
  const byId = new Map(docs.map((d) => [d.id, d]));

  const label = new Map<string, string>();
  for (const [group, ids] of Object.entries(golden.groups))
    for (const id of ids) label.set(id, group);
  for (const d of corpus) if (!label.has(d.id)) label.set(d.id, d.id);
  const ambiguous = new Set<string>();
  for (const [x, y] of golden.ambiguous) ambiguous.add(`${x}|${y}`).add(`${y}|${x}`);

  const meter: TokenMeter = { in: 0, out: 0, calls: 0 };
  const enrichCall = meteredCaller(cachedCaller(''), meter);
  const clusterCall = meteredCaller(cachedCaller(sample ? `cluster:${sample}` : ''), meter);

  // 1. Enrich (the production gate).
  const outcomes = new Map<string, EnrichmentOutcome>();
  await pool(docs, async (d) => {
    outcomes.set(d.id, await enrichArticle(enrichmentInput(d), enrichCall));
  });
  saveCaches(true);

  const skippedBy = new Map<string, string[]>();
  const failed: string[] = [];
  const live: CorpusItem[] = [];
  for (const d of docs) {
    const o = outcomes.get(d.id)!;
    const reason =
      o.status === 'ok'
        ? o.result.state === 'live'
          ? null
          : (o.result.skipReason ?? 'unknown')
        : o.status === 'content_filter'
          ? 'content_filter'
          : 'ai_failed';
    if (o.status === 'failed') failed.push(`${d.id}: ${o.error}`);
    if (reason === null) live.push(d);
    else skippedBy.set(reason, [...(skippedBy.get(reason) ?? []), d.id]);
  }

  // 2. Embed.
  const vectors = new Map<string, number[]>();
  await pool(live, async (d) => {
    const o = outcomes.get(d.id) as Extract<EnrichmentOutcome, { status: 'ok' }>;
    const v = await cachedEmbedding(newsEmbeddingText(o.result.headline!, o.result.whatHappened!));
    if (v) vectors.set(d.id, v);
  });
  saveCaches(true);

  // 3. Cluster, as the pipeline does: newsroom first, then community, each oldest first.
  const toCluster = live
    .filter((d) => vectors.has(d.id))
    .sort(
      (x, y) =>
        Number(kindOf(x) === 'community') - Number(kindOf(y) === 'community') ||
        x.publishedAt.localeCompare(y.publishedAt) ||
        x.id.localeCompare(y.id)
    );
  const article = (d: CorpusItem): ClusterArticle => {
    const r = (outcomes.get(d.id) as Extract<EnrichmentOutcome, { status: 'ok' }>).result;
    return {
      id: d.id,
      outletName: d.outlet,
      kind: kindOf(d),
      publishedAt: new Date(d.publishedAt),
      title: d.title,
      whatHappened: r.whatHappened ?? '',
      entities: r.entities,
    };
  };

  const storyOf = new Map<string, string>();
  const members = new Map<string, ClusterArticle[]>();
  const decisions = { noCandidates: 0, llmSame: 0, llmNew: 0, deferred: 0 };
  const log: string[] = [];

  for (const d of toCluster) {
    const me = article(d);
    const scored = [...storyOf.entries()]
      .filter(([other]) => inClusterWindow(me.publishedAt, new Date(byId.get(other)!.publishedAt)))
      .map(([other, storyId]) => ({
        storyId,
        similarity: cosineSimilarity(vectors.get(d.id)!, vectors.get(other)!),
      }));
    const candidates: CandidateStory[] = pickCandidateStories(scored).map((p) => ({
      ...p,
      members: members.get(p.storyId)!,
    }));
    const decision = await decideCluster(me, candidates, clusterCall);

    let target: string;
    if (decision.decision === 'same') {
      decisions.llmSame++;
      target = decision.storyId;
    } else {
      if (candidates.length === 0) decisions.noCandidates++;
      else if (decision.decision === 'defer') decisions.deferred++;
      else decisions.llmNew++;
      target = `story:${d.id}`;
      members.set(target, []);
    }

    if (candidates.length > 0) {
      const truth = candidates.find((c) =>
        c.members.some((m) => label.get(m.id) === label.get(d.id))
      );
      const chosen = decision.decision === 'same' ? decision.storyId : null;
      const ok = (truth?.storyId ?? null) === chosen;
      const amb = candidates.some((c) =>
        c.members.some((m) => ambiguous.has(`${label.get(m.id)}|${label.get(d.id)}`))
      );
      const tag = ok ? 'OK ' : amb ? 'AMB' : 'BAD';
      if (verbose || !ok) {
        const chosenTitle = chosen ? members.get(chosen)![0].title : null;
        const truthTitle = truth ? truth.members[0].title : null;
        log.push(
          `${tag} ${decision.decision.padEnd(4)} best=${candidates[0].similarity.toFixed(3)} ${d.id} "${short(d.title)}"` +
            (chosenTitle ? `\n      -> "${short(chosenTitle)}"` : '') +
            (!ok && truthTitle ? `\n      truth: "${short(truthTitle)}"` : '') +
            `\n      ${decision.reason}`
        );
      }
    }

    storyOf.set(d.id, target);
    members.get(target)!.push(me);
  }
  saveCaches(true);

  // 4. Metrics over the articles that reached clustering.
  const ids = toCluster.map((d) => d.id);
  let precision = 0;
  let recall = 0;
  for (const i of ids) {
    const predicted = ids.filter((j) => storyOf.get(j) === storyOf.get(i));
    const truth = ids.filter((j) => label.get(j) === label.get(i));
    const both = predicted.filter((j) => label.get(j) === label.get(i)).length;
    precision += both / predicted.length;
    recall += both / truth.length;
  }
  precision /= ids.length;
  recall /= ids.length;
  const f1 = (2 * precision * recall) / (precision + recall);

  const inEval = new Set(ids);
  const groups = Object.entries(golden.groups)
    .map(([g, gids]) => [g, gids.filter((x) => inEval.has(x))] as const)
    .filter(([, gids]) => gids.length >= 2);
  const fragmented: string[] = [];
  for (const [g, gids] of groups) {
    const parts = new Set(gids.map((x) => storyOf.get(x)));
    if (parts.size > 1) fragmented.push(`${g}: ${gids.length} articles in ${parts.size} stories`);
  }

  const falseMerges: string[] = [];
  const ambiguousMerges: string[] = [];
  for (const list of members.values()) {
    const labels = [...new Set(list.map((m) => label.get(m.id)!))];
    if (labels.length < 2) continue;
    const allAmbiguous = labels.every((x, i) =>
      labels.slice(i + 1).every((y) => ambiguous.has(`${x}|${y}`))
    );
    const text =
      `${list.length} articles / ${labels.length} golden stories: ` +
      labels
        .map((l) => `"${short(list.find((m) => label.get(m.id) === l)!.title, 50)}" (${l})`)
        .join(' + ');
    (allAmbiguous ? ambiguousMerges : falseMerges).push(text);
  }

  // 5. Report.
  const goldenIds = new Set(Object.values(golden.groups).flat());
  const goldenSkipped = [...skippedBy.entries()].flatMap(([reason, list]) =>
    list
      .filter((id) => goldenIds.has(id))
      .map((id) => `${id} [${label.get(id)}] ${reason}: "${short(byId.get(id)!.title, 70)}"`)
  );

  console.log(
    `\n=== News clustering eval (now pinned to ${NOW.toISOString()}, model ${newsDeployment()}${sample ? `, sample ${sample}` : ''}) ===`
  );
  console.log(
    `Corpus ${corpus.length}: ${excluded.length} excluded by outlet, ${tooOld.length} too old, ${docs.length} enriched`
  );
  console.log(
    `Gate: ${live.length} live, ${docs.length - live.length} skipped ` +
      `(${[...skippedBy.entries()].map(([r, l]) => `${r} ${l.length}`).join(', ')})`
  );
  if (failed.length) console.log(`Enrichment failures:\n  ${failed.join('\n  ')}`);
  console.log(`\nGolden articles the gate skipped (${goldenSkipped.length} of ${goldenIds.size}):`);
  for (const line of goldenSkipped) console.log(`  ${line}`);
  if (verbose) {
    console.log('\nEvery skipped article:');
    for (const [reason, list] of skippedBy) {
      for (const id of list) {
        const o = outcomes.get(id)!;
        const type = o.status === 'ok' ? `${o.result.buncombe}/${o.result.type}` : o.status;
        console.log(
          `  ${reason.padEnd(15)} ${type.padEnd(22)} ${id} ${byId.get(id)!.outlet}: "${short(byId.get(id)!.title, 80)}"`
        );
      }
    }
  }

  console.log(`\nClustered ${ids.length} articles into ${members.size} stories`);
  console.log(
    `Decisions: ${decisions.noCandidates} new (no candidates), ${decisions.llmSame} model same, ` +
      `${decisions.llmNew} model new, ${decisions.deferred} deferred`
  );
  console.log(`B-cubed  P=${precision.toFixed(3)}  R=${recall.toFixed(3)}  F1=${f1.toFixed(3)}`);
  console.log(
    `Golden multi-article stories recovered whole: ${groups.length - fragmented.length}/${groups.length}`
  );
  for (const f of fragmented) console.log(`  fragmented: ${f}`);
  console.log(`False merges: ${falseMerges.length} (plus ${ambiguousMerges.length} ambiguous)`);
  for (const f of falseMerges) console.log(`  merged: ${f}`);
  for (const f of ambiguousMerges) console.log(`  (ambiguous) ${f}`);

  if (log.length) {
    console.log(`\nModel decisions${verbose ? '' : ' that missed'}:`);
    for (const l of log) console.log(`  ${l}`);
  }

  console.log(
    `\nModel calls: ${stats.modelNew} new, ${stats.modelCached} cached; tokens this run in=${meter.in} out=${meter.out}. ` +
      `Embeddings: ${stats.embedNew} new, ${stats.embedCached} cached.`
  );
  const pass = f1 >= SHIP_F1 && falseMerges.length <= SHIP_FALSE_MERGES;
  console.log(
    `\nSHIP BAR (F1 >= ${SHIP_F1}, <= ${SHIP_FALSE_MERGES} false merges): ${pass ? 'PASS' : 'FAIL'}`
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  saveCaches(true);
  console.error(err);
  process.exit(2);
});
