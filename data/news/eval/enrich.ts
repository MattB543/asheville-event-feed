/**
 * Prototype of the article enrichment call (triage + enrichment in one pass).
 * Usage: npx tsx enrich.ts <effort> <limit> [ids...]
 * Writes enriched.json (merged) and prints token usage + $ estimate. No DB.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getAzureClient,
  getAzureDeploymentName,
  parseJsonFromModel,
} from '../../../../../../../../projects/asheville-event-feed/lib/ai/provider-clients';

const P = __dirname;
const IN_PRICE = 0.25e-6; // gpt-5-mini list $/token
const OUT_PRICE = 2.0e-6;

export const TOPICS = [
  'City & County Government',
  'Elections & Politics',
  'State & Federal',
  'Crime & Courts',
  'Public Safety',
  'Housing & Homelessness',
  'Development & Growth',
  'Transportation',
  'Utilities & Infrastructure',
  'Environment & Outdoors',
  'Weather',
  'Helene Recovery',
  'Education',
  'Health',
  'Business & Economy',
  'Food & Drink',
  'Arts & Culture',
  'Sports',
  'Community & People',
];

export const SYSTEM_PROMPT = `You are the intake editor for AVL GO, a local news feed for Asheville and Western North Carolina (WNC). You read ONE item pulled from a news feed and return JSON describing it. Use ONLY the text provided. Never add facts, names, numbers or dates that are not in the input.

WNC = Buncombe, Henderson, Haywood, Madison, Yancey, Mitchell, Avery, McDowell, Rutherford, Polk, Transylvania, Jackson, Macon, Swain, Graham, Cherokee, Clay, Burke and Watauga counties, plus the Qualla Boundary. FOX Carolina, WYFF and WSPA are Greenville/Spartanburg SC stations: their "Upstate" means South Carolina, not WNC.

Return:
- geoScope: "asheville" | "buncombe" (elsewhere in Buncombe) | "wnc" | "nc" (statewide) | "national" | "elsewhere"
- wncRelevant: true if the item is about WNC, or is a state/national item that names WNC or directly changes things for its residents (e.g. Helene aid). A national story that merely mentions Asheville in passing is false.
- articleType: "news" | "analysis" | "opinion" | "letter" | "press_release" | "event_announcement" | "roundup" | "obituary" | "crime_blotter" | "sponsored" | "service" (forecast, how-to-watch, listicle, gas prices) | "community_post" | "question" (someone asking for advice) | "classified" | "sports_result" | "other"
- topics: 1-3 from this list, most relevant first: ${TOPICS.join('; ')}
- places: specific WNC places named (neighborhoods, towns, roads, rivers, venues), as commonly written.
- entities: up to 8 {name, type: "person"|"org"|"place"|"matter", role} using full canonical names ("Asheville Police Department", not "APD"). A "matter" is a specific thing that can be followed over time: a project, program, lawsuit, ordinance, incident or named event (e.g. "I-40 Pigeon River Gorge repair", "$4.7M homelessness prevention program").
- whatHappened: ONE neutral sentence, max 30 words, in the form "[who] [did what] [about what] [where]". Leave out anything not stated (never write "date not stated"), and leave out dates unless the date itself is the news. Write it the way it would read no matter which outlet reported it: no outlet names, no adjectives, no quotes. For an opinion piece, state the argument's subject ("Columnist argues ..."). For a question or classified, say what is asked or offered.
- summary: 1-2 sentences, max 45 words, for readers. Attribute claims to their source ("police said", "according to the city"). Allegations stay allegations ("charged with", never "committed").
- facts: up to 6 {text, evidence, attribution, kind}. evidence = an exact quote of at most 20 words copied character-for-character from the input that supports the fact. attribution = who asserts it ("Buncombe County Sheriff's Office") or null if the outlet reports it directly. kind = "official" | "reported" | "allegation" | "claim" | "opinion". If the input is only a headline, facts may come only from the headline.
- importance: 0-10 for a WNC resident. 9-10 affects most residents' safety or daily life (boil-water notice, I-40 closure, major storm). 7-8 significant decision or change (council vote on a major item, new police chief or superintendent, large closure). 5-6 notable local news (a development, a lawsuit, a serious crime). 3-4 minor or niche. 0-2 trivia, service content, or not WNC.
- developing: true if the outcome is still pending or the situation is unfolding.
- nextMilestone: {date: "YYYY-MM-DD" or null, what} if the text names a scheduled next step (vote, hearing, meeting, trial, deadline, opening); otherwise null.
- event: {name, date: "YYYY-MM-DD" or null, venue} if the item announces or promotes an attendable public event; otherwise null.
- sensitive: {privatePersonAccused: boolean, minorInvolved: boolean, death: boolean}

JSON only, keys in the order above.`;

type Doc = {
  id: string;
  outlet: string;
  title: string;
  dek: string;
  text: string;
  publishedAt: string;
  availability: string;
};

export function userPrompt(d: Doc, maxBodyChars = 4000): string {
  return [
    `Outlet: ${d.outlet}`,
    `Published: ${d.publishedAt.slice(0, 10)}`,
    `Headline: ${d.title}`,
    d.dek ? `Dek: ${d.dek}` : null,
    d.text ? `Body${d.text.length > maxBodyChars ? ' (truncated)' : ''}:\n${d.text.slice(0, maxBodyChars)}` : '(Only the headline is available.)',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Drop facts whose evidence is not literally in the input - the cheap hallucination guard. */
export function groundFacts(facts: any[], d: Doc): { kept: any[]; dropped: any[] } {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[‘’“”"']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const hay = norm([d.title, d.dek, d.text].join(' '));
  const kept: any[] = [];
  const dropped: any[] = [];
  for (const f of facts ?? []) (f?.evidence && hay.includes(norm(f.evidence)) ? kept : dropped).push(f);
  return { kept, dropped };
}

async function main() {
  const [effort = 'low', limitArg = '5', ...only] = process.argv.slice(2);
  const corpus: Doc[] = JSON.parse(fs.readFileSync(path.join(P, 'corpus.json'), 'utf8'));
  const golden = JSON.parse(fs.readFileSync(path.join(P, 'golden.json'), 'utf8'));
  const outFile = path.join(P, 'enriched.json');
  const out: Record<string, any> = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  const todo = corpus
    .filter((d) => !golden.excludeOutlets.includes(d.outlet))
    .filter((d) => (only.length ? only.includes(d.id) : !out[d.id]))
    .slice(0, Number(limitArg));

  const client = getAzureClient()!;
  let inTok = 0;
  let outTok = 0;
  let reasonTok = 0;
  let droppedFacts = 0;
  let totalFacts = 0;
  const started = Date.now();
  const latencies: number[] = [];

  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(
      todo.slice(i, i + 8).map(async (d) => {
        const t0 = Date.now();
        try {
          const r = await client.chat.completions.create({
            model: getAzureDeploymentName(),
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt(d) },
            ],
            max_completion_tokens: 6000,
            response_format: { type: 'json_object' },
            reasoning_effort: effort,
          } as any);
          latencies.push(Date.now() - t0);
          const u: any = r.usage;
          inTok += u.prompt_tokens;
          outTok += u.completion_tokens;
          reasonTok += u.completion_tokens_details?.reasoning_tokens ?? 0;
          const parsed = parseJsonFromModel<any>(r.choices[0].message.content ?? '');
          if (!parsed) return console.log(d.id, 'PARSE FAIL');
          const { kept, dropped } = groundFacts(parsed.facts, d);
          totalFacts += (parsed.facts ?? []).length;
          droppedFacts += dropped.length;
          out[d.id] = { ...parsed, facts: kept, droppedFacts: dropped, _usage: { in: u.prompt_tokens, out: u.completion_tokens }, _effort: effort };
        } catch (e) {
          console.log(d.id, 'ERR', (e as Error).message.slice(0, 160));
        }
      })
    );
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  }
  const cost = inTok * IN_PRICE + outTok * OUT_PRICE;
  latencies.sort((a, b) => a - b);
  console.log(
    `${todo.length} docs effort=${effort} in=${inTok} out=${outTok} (reasoning ${reasonTok}) cost=$${cost.toFixed(4)} per-doc=$${(cost / Math.max(1, todo.length)).toFixed(5)} ` +
      `p50=${latencies[Math.floor(latencies.length / 2)]}ms p90=${latencies[Math.floor(latencies.length * 0.9)]}ms wall=${Date.now() - started}ms facts=${totalFacts} dropped=${droppedFacts}`
  );
}

if (require.main === module) main();
