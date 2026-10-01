/**
 * Prototype of the proposed story clustering: online, in publish order.
 *   1. retrieve candidate stories by embedding (max-sim to a member from the last 10 days)
 *   2. auto-attach when sim >= AUTO and the pair shares a rare entity or a near-identical title
 *   3. otherwise, if any candidate >= LOW, ask the LLM a multiple-choice question
 *   4. else start a new story
 * Reads corpus.json, enriched.json, embed-cache.json. LLM answers cached in confirm-cache.json. No DB.
 * Usage: npx tsx cluster-sim.ts [variant=enriched] [AUTO=0.88] [LOW=0.72] [llm=on|off]
 */
import * as fs from 'fs';
import * as path from 'path';
import { cosineSimilarity } from '../../../../../../../../projects/asheville-event-feed/lib/ai/embedding';
import {
  getAzureClient,
  getAzureDeploymentName,
  parseJsonFromModel,
} from '../../../../../../../../projects/asheville-event-feed/lib/ai/provider-clients';

const P = __dirname;
const [variant = 'enriched', autoArg = '0.88', lowArg = '0.72', llmArg = 'on', effort = 'minimal'] =
  process.argv.slice(2);
const AUTO = Number(autoArg);
const LOW = Number(lowArg);
const WINDOW_DAYS = 10;

type Doc = { id: string; outlet: string; title: string; dek: string; text: string; publishedAt: string };
const corpus: Doc[] = JSON.parse(fs.readFileSync(path.join(P, 'corpus.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(P, 'golden.json'), 'utf8'));
const enriched: Record<string, any> = JSON.parse(fs.readFileSync(path.join(P, 'enriched.json'), 'utf8'));
const embedCache: Record<string, number[]> = JSON.parse(fs.readFileSync(path.join(P, 'embed-cache.json'), 'utf8'));
const confirmFile = path.join(P, `confirm-cache-${effort}${process.env.RUN ? '-' + process.env.RUN : ''}.json`);
const confirmCache: Record<string, any> = fs.existsSync(confirmFile)
  ? JSON.parse(fs.readFileSync(confirmFile, 'utf8'))
  : {};

const docs = corpus.filter((d) => !golden.excludeOutlets.includes(d.outlet) && enriched[d.id]?.whatHappened);
const byId = new Map(docs.map((d) => [d.id, d]));
const time = (id: string) => new Date(byId.get(id)!.publishedAt).getTime();

function embedText(d: Doc): string {
  const e = enriched[d.id];
  const ents = (e.entities ?? []).map((x: any) => x.name).join(', ');
  return variant === 'hybrid' ? `${d.title}\n${e.whatHappened}\n${ents}` : `${e.whatHappened}\n${ents}`;
}
const V = new Map<string, number[]>();
for (const d of docs) {
  const v = embedCache['RETRIEVAL_DOCUMENT::' + embedText(d)];
  if (!v) throw new Error('missing embedding for ' + d.id + ' - run embed-eval.ts first');
  V.set(d.id, v);
}

// ---- golden
const label = new Map<string, string>();
for (const [g, ids] of Object.entries<string[]>(golden.groups)) for (const id of ids) label.set(id, g);
for (const d of docs) if (!label.has(d.id)) label.set(d.id, d.id);
const ambiguous = new Set<string>();
for (const [x, y] of golden.ambiguous) {
  ambiguous.add(`${x}|${y}`);
  ambiguous.add(`${y}|${x}`);
}

// ---- entities: normalized keys + document frequency over the corpus (stand-in for "last 30 days")
const entKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[’'.,()"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const ents = new Map<string, Set<string>>();
const df = new Map<string, number>();
// Only people and "matters" (projects, programs, incidents) are specific enough to corroborate a merge;
// orgs and places recur across unrelated stories (every sheriff's office press release names the sheriff's office).
for (const d of docs) {
  const keys = new Set<string>(
    (enriched[d.id].entities ?? []).filter((x: any) => x.type === 'person' || x.type === 'matter').map((x: any) => entKey(x.name))
  );
  ents.set(d.id, keys);
  for (const k of keys) df.set(k, (df.get(k) ?? 0) + 1);
}
const RARE_DF = 4;
const rareShared = (a: string, b: string) =>
  [...ents.get(a)!].filter((k) => ents.get(b)!.has(k) && (df.get(k) ?? 0) <= RARE_DF);
const titleWords = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9$ ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
const jaccard = (a: Set<string>, b: Set<string>) => {
  const i = [...a].filter((x) => b.has(x)).length;
  return i / (a.size + b.size - i || 1);
};

// ---- LLM confirmation (the prompt sketch from the design doc)
const CONFIRM_SYSTEM = `You maintain the story list for AVL GO, a local news feed for Asheville and Western North Carolina. Decide whether a NEW ARTICLE reports on the same story as one of the CANDIDATE STORIES.

SAME STORY = the same specific real-world matter: one incident, decision, project, program, lawsuit, appointment, or event - including later developments of it (the vote after the hearing, the arrest after the shooting, the sentencing after the trial, the results after the tournament).

NOT the same story:
- Only the same broad theme (two different Helene-recovery stories, two different bear stories, two different crimes, two items from the same council meeting).
- The same organization doing different things (the city announcing an app update vs. naming a police chief).
- A round-up or anniversary piece covering many matters, unless its main subject is this story's specific matter.

When unsure, choose "new": a missed merge is cheap to fix later, a wrong merge corrupts a summary.

Return JSON: {"decision": "same" | "new", "storyId": "<candidate id or null>", "related": ["<candidate ids that are clearly connected but separate>"], "confidence": <0-1>, "reason": "<max 20 words>"}`;

function describeArticle(id: string): string {
  const d = byId.get(id)!;
  const e = enriched[id];
  return [
    `Published ${d.publishedAt.slice(0, 10)} by ${d.outlet}`,
    `Headline: ${d.title}`,
    `What happened: ${e.whatHappened}`,
    `Entities: ${(e.entities ?? []).map((x: any) => x.name).join('; ')}`,
  ].join('\n');
}
function describeStory(sid: string, members: string[]): string {
  const sorted = [...members].sort((a, b) => time(a) - time(b));
  const shown = [...new Set([sorted[0], ...sorted.slice(-2)])];
  const entCount = new Map<string, number>();
  for (const m of members)
    for (const x of enriched[m].entities ?? []) entCount.set(x.name, (entCount.get(x.name) ?? 0) + 1);
  const topEnts = [...entCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
  return [
    `${sid} (${members.length} article${members.length > 1 ? 's' : ''}, latest ${byId.get(sorted[sorted.length - 1])!.publishedAt.slice(0, 10)})`,
    ...shown.map((m) => `  - ${byId.get(m)!.publishedAt.slice(0, 10)} ${byId.get(m)!.outlet}: "${byId.get(m)!.title}" -> ${enriched[m].whatHappened}`),
    `  Key entities: ${topEnts.join('; ')}`,
  ].join('\n');
}

let llmCalls = 0;
let llmIn = 0;
let llmOut = 0;
async function confirm(id: string, cands: Array<{ sid: string; members: string[] }>) {
  const key = id + '|' + cands.map((c) => c.members.slice().sort().join(',')).join('|');
  if (!confirmCache[key]) {
    const labels = cands.map((c, i) => ({ ...c, label: `S${i + 1}` }));
    const user = `NEW ARTICLE\n${describeArticle(id)}\n\nCANDIDATE STORIES\n${labels.map((c) => describeStory(c.label, c.members)).join('\n\n')}`;
    const r = await getAzureClient()!.chat.completions.create({
      model: getAzureDeploymentName(),
      messages: [
        { role: 'system', content: CONFIRM_SYSTEM },
        { role: 'user', content: user },
      ],
      max_completion_tokens: 4000,
      response_format: { type: 'json_object' },
      reasoning_effort: effort,
    } as any);
    const u: any = r.usage;
    llmCalls++;
    llmIn += u.prompt_tokens;
    llmOut += u.completion_tokens;
    const parsed = parseJsonFromModel<any>(r.choices[0].message.content ?? '') ?? {};
    const chosen = labels.find((c) => c.label === parsed.storyId);
    confirmCache[key] = { ...parsed, chosenIndex: chosen ? labels.indexOf(chosen) : null, userPrompt: user };
    fs.writeFileSync(confirmFile, JSON.stringify(confirmCache, null, 2));
  }
  return confirmCache[key];
}

async function main() {
  const order = [...docs].sort((a, b) => time(a.id) - time(b.id)).map((d) => d.id);
  const story = new Map<string, string>(); // article -> story id
  const members = new Map<string, string[]>(); // story id -> articles
  const decisions: Record<string, number> = { new: 0, auto: 0, llmSame: 0, llmNew: 0 };
  const llmLog: string[] = [];

  for (const id of order) {
    // candidate stories: best sim to any member from the last WINDOW_DAYS
    const best = new Map<string, number>();
    for (const [other, sid] of story) {
      if (time(id) - time(other) > WINDOW_DAYS * 864e5) continue;
      const s = cosineSimilarity(V.get(id)!, V.get(other)!);
      if (s > (best.get(sid) ?? -1)) best.set(sid, s);
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    const [topSid, topSim] = ranked[0] ?? ['', 0];

    let target: string | null = null;
    if (topSim >= AUTO) {
      const m = members.get(topSid)!;
      const corroborated = m.some(
        (o) => rareShared(id, o).length > 0 || jaccard(titleWords(byId.get(id)!.title), titleWords(byId.get(o)!.title)) >= 0.75
      );
      if (corroborated) {
        target = topSid;
        decisions.auto++;
      }
    }
    if (!target && topSim >= LOW && llmArg === 'on') {
      const cands = ranked.filter(([, s]) => s >= LOW).slice(0, 4).map(([sid]) => ({ sid, members: members.get(sid)! }));
      const ans = await confirm(id, cands);
      const chosen = ans.decision === 'same' && ans.chosenIndex != null ? cands[ans.chosenIndex] : null;
      const truth = cands.find((c) => c.members.some((m) => label.get(m) === label.get(id)))?.sid ?? null;
      const ok = (chosen?.sid ?? null) === truth;
      const amb = cands.some((c) => c.members.some((m) => ambiguous.has(`${label.get(m)}|${label.get(id)}`)));
      llmLog.push(
        `${ok ? 'OK ' : amb ? 'AMB' : 'BAD'} ${ans.decision.padEnd(4)} c=${ans.confidence} sim=${topSim.toFixed(3)} "${byId.get(id)!.title.slice(0, 60)}"` +
          (chosen ? ` -> "${byId.get(chosen.members[0])!.title.slice(0, 50)}"` : '') +
          (!ok && truth ? `  [truth: "${byId.get(members.get(truth)![0])!.title.slice(0, 50)}"]` : '') +
          ` | ${ans.reason}`
      );
      if (chosen) {
        target = chosen.sid;
        decisions.llmSame++;
      } else decisions.llmNew++;
    }
    if (!target) {
      target = id;
      members.set(id, []);
      decisions.new++;
    }
    story.set(id, target);
    members.get(target)!.push(id);
  }

  if (process.env.DUMP) fs.writeFileSync(path.join(P, process.env.DUMP), JSON.stringify(Object.fromEntries(story), null, 1));
  // ---- metrics
  const ids = order;
  let bp = 0;
  let br = 0;
  for (const i of ids) {
    const pc = ids.filter((j) => story.get(j) === story.get(i));
    const gc = ids.filter((j) => label.get(j) === label.get(i));
    const both = pc.filter((j) => label.get(j) === label.get(i)).length;
    bp += both / pc.length;
    br += both / gc.length;
  }
  bp /= ids.length;
  br /= ids.length;

  const multi = Object.entries<string[]>(golden.groups).map(([g, gids]) => [g, gids.filter((x) => byId.has(x))] as const);
  let recovered = 0;
  const frag: string[] = [];
  for (const [g, gids] of multi) {
    const parts = new Set(gids.map((x) => story.get(x)));
    if (parts.size === 1) recovered++;
    else frag.push(`${g}: ${gids.length} articles in ${parts.size} stories`);
  }
  const falseMerges: string[] = [];
  for (const [sid, m] of members) {
    const labels = [...new Set(m.map((x) => label.get(x)!))];
    if (labels.length < 2) continue;
    const allAmbiguous = labels.every((a, i) => labels.slice(i + 1).every((b) => ambiguous.has(`${a}|${b}`)));
    falseMerges.push(
      `${allAmbiguous ? '(ambiguous) ' : ''}${m.length} articles / ${labels.length} golden stories: ` +
        labels.map((l) => `"${byId.get(m.find((x) => label.get(x) === l)!)!.title.slice(0, 45)}"`).join(' + ')
    );
  }

  console.log(`variant=${variant} AUTO=${AUTO} LOW=${LOW} llm=${llmArg} effort=${effort}`);
  console.log(`decisions`, decisions, `stories=${members.size} from ${ids.length} articles`);
  console.log(`B-cubed P=${bp.toFixed(3)} R=${br.toFixed(3)} F1=${((2 * bp * br) / (bp + br)).toFixed(3)}`);
  console.log(`golden multi-article stories fully recovered: ${recovered}/${multi.length}`);
  for (const f of frag) console.log('  fragmented:', f);
  console.log(`false merges: ${falseMerges.length}`);
  for (const f of falseMerges) console.log('  merged:', f);
  if (llmLog.length) {
    console.log(`\nLLM confirmations (${llmLog.length}; new calls this run ${llmCalls}, in=${llmIn} out=${llmOut}, $${(llmIn * 0.25e-6 + llmOut * 2e-6).toFixed(4)})`);
    for (const l of llmLog) console.log('  ' + l);
  }
}
main();
