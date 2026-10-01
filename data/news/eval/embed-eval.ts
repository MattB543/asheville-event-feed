/** Offline clustering experiment: embeddings only. No DB. Caches vectors in embed-cache.json. */
import * as fs from 'fs';
import * as path from 'path';
import {
  generateEmbedding,
  cosineSimilarity,
} from '../../../../../../../../projects/asheville-event-feed/lib/ai/embedding';

const P = __dirname;
type Doc = {
  id: string;
  outlet: string;
  title: string;
  dek: string;
  text: string;
  publishedAt: string;
  availability: string;
};
const allDocs: Doc[] = JSON.parse(fs.readFileSync(path.join(P, 'corpus.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(P, 'golden.json'), 'utf8'));
const docs = allDocs.filter((d) => !golden.excludeOutlets.includes(d.outlet));
const enrichedFile = path.join(P, 'enriched.json');
const enriched: Record<string, any> = fs.existsSync(enrichedFile)
  ? JSON.parse(fs.readFileSync(enrichedFile, 'utf8'))
  : {};

// Golden label per doc (singletons get their own id)
const label = new Map<string, string>();
for (const [g, ids] of Object.entries<string[]>(golden.groups)) for (const id of ids) label.set(id, g);
for (const d of docs) if (!label.has(d.id)) label.set(d.id, d.id);
const ambiguous = new Set<string>();
for (const [x, y] of golden.ambiguous) {
  ambiguous.add(`${x}|${y}`);
  ambiguous.add(`${y}|${x}`);
}
const isAmbiguous = (a: string, b: string) => ambiguous.has(`${label.get(a)}|${label.get(b)}`);

const cacheFile = path.join(P, 'embed-cache.json');
const cache: Record<string, number[]> = fs.existsSync(cacheFile)
  ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  : {};
let embedChars = 0;

const VARIANTS: Record<string, (d: Doc) => string | null> = {
  headline: (d) => d.title,
  lead: (d) => [d.title, d.dek, d.text.slice(0, 700)].filter(Boolean).join('\n'),
  // AI-normalized statement + entity names (needs enriched.json)
  enriched: (d) => {
    const e = enriched[d.id];
    if (!e?.whatHappened) return null;
    return `${e.whatHappened}\n${(e.entities ?? []).map((x: any) => x.name).join(', ')}`;
  },
  // headline + normalized statement: what production would embed
  hybrid: (d) => {
    const e = enriched[d.id];
    if (!e?.whatHappened) return null;
    return `${d.title}\n${e.whatHappened}\n${(e.entities ?? []).map((x: any) => x.name).join(', ')}`;
  },
};

async function vec(text: string, task: string): Promise<number[]> {
  const key = task + '::' + text;
  if (!cache[key]) {
    embedChars += text.length;
    const v = await generateEmbedding(text, { taskType: task as any });
    if (!v) throw new Error('embed failed');
    cache[key] = v;
  }
  return cache[key];
}

function bcubed(pred: Map<string, string>, ids: string[]) {
  let p = 0;
  let r = 0;
  for (const i of ids) {
    const pc = ids.filter((j) => pred.get(j) === pred.get(i));
    const gc = ids.filter((j) => label.get(j) === label.get(i));
    const both = pc.filter((j) => label.get(j) === label.get(i)).length;
    p += both / pc.length;
    r += both / gc.length;
  }
  p /= ids.length;
  r /= ids.length;
  return { p, r, f: (2 * p * r) / (p + r) };
}

const byId = new Map(docs.map((d) => [d.id, d]));
const time = (id: string) => new Date(byId.get(id)!.publishedAt).getTime();
const t = (id: string) =>
  `${id} ${byId.get(id)!.outlet.slice(0, 14)}: ${byId.get(id)!.title.slice(0, 64)}`;

/** Online single pass in publish order: attach to the cluster holding the most similar article from the last 7 days. */
function cluster(ids: string[], V: Map<string, number[]>, T: number) {
  const order = [...ids].sort((a, b) => time(a) - time(b));
  const pred = new Map<string, string>();
  for (const id of order) {
    let best = -1;
    let bestC = '';
    for (const [other, c] of pred) {
      if (time(id) - time(other) > 7 * 864e5) continue;
      const s = cosineSimilarity(V.get(id)!, V.get(other)!);
      if (s > best) {
        best = s;
        bestC = c;
      }
    }
    pred.set(id, best >= T ? bestC : id);
  }
  return pred;
}

async function main() {
  const variants = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['headline:RETRIEVAL_DOCUMENT', 'lead:RETRIEVAL_DOCUMENT', 'lead:CLUSTERING'];
  for (const spec of variants) {
    const [vName, task] = spec.split(':');
    const V = new Map<string, number[]>();
    const ids = docs.filter((d) => VARIANTS[vName](d)).map((d) => d.id);
    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(
        ids
          .slice(i, i + 10)
          .map(async (id) => V.set(id, await vec(VARIANTS[vName](byId.get(id)!)!, task)))
      );
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache));

    const pos: number[] = [];
    const neg: Array<[number, string, string]> = [];
    const posPairs: Array<[number, string, string]> = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (isAmbiguous(a, b)) continue;
        const s = cosineSimilarity(V.get(a)!, V.get(b)!);
        if (label.get(a) === label.get(b)) {
          pos.push(s);
          posPairs.push([s, a, b]);
        } else neg.push([s, a, b]);
      }
    pos.sort((x, y) => x - y);
    neg.sort((x, y) => y[0] - x[0]);
    const q = (arr: number[], p: number) => arr[Math.floor(p * (arr.length - 1))].toFixed(3);
    const negS = neg.map((n) => n[0]).sort((x, y) => x - y);
    console.log(
      `\n######## ${spec}  (${ids.length} docs, ${pos.length} positive pairs, ${neg.length} negative pairs)`
    );
    console.log(
      `positives  p10=${q(pos, 0.1)} p25=${q(pos, 0.25)} median=${q(pos, 0.5)} min=${pos[0].toFixed(3)}`
    );
    console.log(
      `negatives  median=${q(negS, 0.5)} p99=${q(negS, 0.99)} p99.9=${q(negS, 0.999)} max=${negS[negS.length - 1].toFixed(3)}`
    );
    for (const T of [0.7, 0.75, 0.8, 0.82, 0.85, 0.88, 0.9, 0.92]) {
      const tp = pos.filter((s) => s >= T).length;
      const fp = neg.filter((n) => n[0] >= T).length;
      const b = bcubed(cluster(ids, V, T), ids);
      console.log(
        `  T=${T.toFixed(2)} pairwise: recall ${(tp / pos.length).toFixed(2)} falsePos ${String(fp).padStart(4)}  | online B-cubed P=${b.p.toFixed(3)} R=${b.r.toFixed(3)} F1=${b.f.toFixed(3)}`
      );
    }
    console.log('  hardest negatives:');
    for (const [s, a, b] of neg.slice(0, 14)) console.log(`   ${s.toFixed(3)}  ${t(a)}  <>  ${t(b)}`);
    console.log('  weakest positives:');
    posPairs.sort((x, y) => x[0] - y[0]);
    for (const [s, a, b] of posPairs.slice(0, 8)) console.log(`   ${s.toFixed(3)}  ${t(a)}  ==  ${t(b)}`);
  }
  console.log(
    `\nembedded ${embedChars} new chars (~${Math.round(embedChars / 4)} tokens, ~$${((embedChars / 4) * 0.15e-6).toFixed(4)})`
  );
}
main();
