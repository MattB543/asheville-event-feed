/**
 * Prototype of story synthesis + incremental update with citation validation. No DB.
 * Usage: npx tsx synth.ts <effort> <initialIds comma-sep> <updateIds comma-sep>
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getAzureClient,
  getAzureDeploymentName,
  parseJsonFromModel,
} from '../../../../../../../../projects/asheville-event-feed/lib/ai/provider-clients';

const P = __dirname;
const corpus = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(P, 'corpus.json'), 'utf8')).map((d: any) => [d.id, d])
);
const enriched: Record<string, any> = JSON.parse(fs.readFileSync(path.join(P, 'enriched.json'), 'utf8'));

export const SYNTH_SYSTEM = `You write and maintain the story card for AVL GO, a local news feed for Asheville and Western North Carolina. A story combines reporting from several sources about ONE matter. Readers get a short, neutral, fully sourced account and click through to the outlets for the full reporting.

RULES
1. Use ONLY the numbered facts given. Every sentence cites the fact ids it rests on, e.g. ["a25.1","a157.1"]. Uncited sentences are deleted automatically, and so is any number, date or name that does not appear in a cited fact.
2. Attribute. Official statements go to the body that made them ("the city said"); reporting goes to the outlet ("the Citizen Times reported"); allegations stay allegations ("charged with", "accused of").
3. If sources disagree on a fact, do not choose. State both with attribution and add a discrepancy. If a later official figure replaces an earlier one, say so ("up from X").
4. Neutral and plain: no judgment adjectives, no speculation, no significance claims the sources do not make.
5. Facts from opinion pieces and community posts are never evidence. Mention them only as "a community post said ..." and only if nothing better exists.
6. Headline-only sources: you know only the headline. Do not infer details beyond it.
7. Do not copy more than 8 consecutive words from any fact except one short quote (max 15 words) with attribution.
8. Length: title max 90 characters (your own neutral headline, not an outlet's); summary 2-4 sentences and max 80 words total; keyFacts max 5, each max 20 words.

UPDATE MODE (when a CURRENT STORY is given): rewrite the summary to reflect everything now known, keep still-valid keyFacts, and list only genuinely new information in newDevelopments. materialChange is false when the new articles only repeat what the story already says (syndication, rewrites, a second outlet confirming the same facts).

Return JSON:
{"title": str,
 "summary": [{"text": str, "cites": [factId]}],
 "keyFacts": [{"text": str, "cites": [factId]}],
 "newDevelopments": [{"date": "YYYY-MM-DD", "text": str, "cites": [factId]}],
 "whatsNew": {"text": str, "cites": [factId]} | null,
 "materialChange": bool,
 "discrepancies": [{"about": str, "claims": [{"text": str, "cites": [factId]}]}],
 "status": "developing" | "ongoing" | "resolved",
 "nextMilestone": {"date": "YYYY-MM-DD" | null, "what": str, "cites": [factId]} | null,
 "importance": 0-10}`;

type Fact = { id: string; text: string; attribution: string | null; kind: string };

function factsFor(id: string): Fact[] {
  const e = enriched[id];
  return (e.facts ?? []).map((f: any, i: number) => ({
    id: `${id}.${i + 1}`,
    text: f.text,
    attribution: f.attribution,
    kind: f.kind,
  }));
}

function articleBlock(id: string): string {
  const d = corpus[id];
  const e = enriched[id];
  const head = `[${id}] ${d.outlet}, ${d.publishedAt.slice(0, 10)}, ${e.articleType}, ${d.availability === 'headline' ? 'HEADLINE ONLY' : d.availability === 'excerpt' ? 'excerpt only' : 'full text'}: "${d.title}"`;
  return [head, ...factsFor(id).map((f) => `  ${f.id} (${f.kind}${f.attribution ? `, per ${f.attribution}` : ''}): ${f.text}`)].join('\n');
}

/** Server-side validation: drop uncited or badly cited sentences; flag numbers not present in cited facts. */
function validate(out: any, known: Map<string, Fact>) {
  const report: string[] = [];
  const numbers = (s: string) => (s.match(/\$?\d[\d,.]*\s*(?:million|billion|m\b|k\b)?/gi) ?? []).map((n) => n.replace(/[,\s]/g, '').toLowerCase());
  const check = (item: any, where: string) => {
    const cites: string[] = item?.cites ?? [];
    const bad = cites.filter((c) => !known.has(c));
    if (!cites.length || bad.length === cites.length) {
      report.push(`DROP ${where} (no valid cites): ${item?.text}`);
      return false;
    }
    const citedText = cites.filter((c) => known.has(c)).map((c) => known.get(c)!.text).join(' ').replace(/[,\s]/g, '').toLowerCase();
    const missing = numbers(item.text).filter((n) => !citedText.includes(n.replace(/^\$/, '')));
    if (missing.length) {
      report.push(`DROP ${where} (numbers not in cited facts: ${missing.join(', ')}): ${item.text}`);
      return false;
    }
    return true;
  };
  out.summary = (out.summary ?? []).filter((s: any, i: number) => check(s, `summary[${i}]`));
  out.keyFacts = (out.keyFacts ?? []).filter((s: any, i: number) => check(s, `keyFacts[${i}]`));
  out.newDevelopments = (out.newDevelopments ?? []).filter((s: any, i: number) => check(s, `newDevelopments[${i}]`));
  if (out.whatsNew && !check(out.whatsNew, 'whatsNew')) out.whatsNew = null;
  const words = out.summary.map((s: any) => s.text).join(' ').split(/\s+/).length;
  report.push(`summary words=${words}, sentences kept=${out.summary.length}`);
  return report;
}

async function call(user: string, effort: string) {
  const r = await getAzureClient()!.chat.completions.create({
    model: getAzureDeploymentName(),
    messages: [
      { role: 'system', content: SYNTH_SYSTEM },
      { role: 'user', content: user },
    ],
    max_completion_tokens: 8000,
    response_format: { type: 'json_object' },
    reasoning_effort: effort,
  } as any);
  const u: any = r.usage;
  return { out: parseJsonFromModel<any>(r.choices[0].message.content ?? ''), inTok: u.prompt_tokens, outTok: u.completion_tokens };
}

function show(label: string, out: any, usage: { inTok: number; outTok: number }, report: string[]) {
  console.log(`\n==================== ${label}  (in=${usage.inTok} out=${usage.outTok} $${(usage.inTok * 0.25e-6 + usage.outTok * 2e-6).toFixed(4)})`);
  console.log('TITLE:', out.title, '| status:', out.status, '| importance:', out.importance, '| materialChange:', out.materialChange);
  console.log('SUMMARY:');
  for (const s of out.summary) console.log('  -', s.text, JSON.stringify(s.cites));
  console.log('KEY FACTS:');
  for (const s of out.keyFacts) console.log('  -', s.text, JSON.stringify(s.cites));
  if (out.newDevelopments?.length) {
    console.log('NEW DEVELOPMENTS:');
    for (const s of out.newDevelopments) console.log('  -', s.date, s.text, JSON.stringify(s.cites));
  }
  if (out.whatsNew) console.log('WHATS NEW:', out.whatsNew.text, JSON.stringify(out.whatsNew.cites));
  if (out.discrepancies?.length) console.log('DISCREPANCIES:', JSON.stringify(out.discrepancies));
  if (out.nextMilestone) console.log('NEXT:', JSON.stringify(out.nextMilestone));
  console.log('VALIDATION:', report.join(' || '));
}

async function main() {
  const [effort = 'low', initial = '', update = ''] = process.argv.slice(2);
  const initialIds = initial.split(',').filter(Boolean);
  const updateIds = update.split(',').filter(Boolean);
  const known = new Map<string, Fact>();
  for (const id of [...initialIds, ...updateIds]) for (const f of factsFor(id)) known.set(f.id, f);

  const u1 = `NEW ARTICLES\n${initialIds.map(articleBlock).join('\n\n')}`;
  const r1 = await call(u1, effort);
  const rep1 = validate(r1.out, known);
  show('INITIAL SYNTHESIS', r1.out, r1, rep1);
  if (!updateIds.length) return;

  const current = {
    title: r1.out.title,
    summary: r1.out.summary,
    keyFacts: r1.out.keyFacts,
    status: r1.out.status,
    sources: initialIds.map((id) => `${id} ${corpus[id].outlet}`),
  };
  const u2 = `CURRENT STORY\n${JSON.stringify(current, null, 1)}\n\nNEW ARTICLES\n${updateIds.map(articleBlock).join('\n\n')}`;
  const r2 = await call(u2, effort);
  const rep2 = validate(r2.out, known);
  show('INCREMENTAL UPDATE', r2.out, r2, rep2);
}
main();
