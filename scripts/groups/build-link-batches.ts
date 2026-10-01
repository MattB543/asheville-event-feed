/**
 * Group directory, step 8b: build the inputs for the links + format pass.
 *
 * One record per group currently in data/groups/directory.json, plus the business-networking records
 * an earlier pass rejected, so they can be re-judged on Matt's 2026-10-01 rule: keep networking groups
 * that are legit and valuable (a known brand, real in-person meetings), cut low-value or scammy ones.
 * Each record carries its current listing and the live-event context from the research inputs.
 *
 * Writes data/groups/research/links/input/batch-NN.json (one Sonnet agent per file, see
 * data/groups/research/links/LINKS_AGENT.md). build-directory.ts reads the results.
 *
 * Run: npx tsx scripts/groups/build-link-batches.ts
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BATCH_SIZE = 26;
const DIR = join(process.cwd(), 'data', 'groups');
const RESEARCH = join(DIR, 'research');
const OUT = join(RESEARCH, 'links', 'input');

// Rejected as business networking by research or overrides. Not here: the IBN chapters and KW Wealth
// Club (Matt rejected those himself) and the grey entries he never greenlit.
const NETWORKING_RECHECK = [
  'c:asheville-alignable-alliance',
  'c:beyond-the-cap-collective',
  'c:momentum-collective',
  'm:asheville-small-business-growth',
  'm:asheville-small-business-growth-and-marketing',
  'm:asheville-area-business-association',
  'm:asheville-business-referral-networking-meetup-group',
  'm:smoke-filled-room',
  'm:asheville-business-strategy-meetup-group',
  'm:asheville-health-wellness-networking',
  'm:ashebuilt-networking-for-the-commercial-building-industry',
  'm:dealmaker-wnc',
  'm:bpasheville',
  'm:meetup-group-dvpbavmv',
  'm:she-owns-it-avl',
  'm:using-ai-in-small-business',
];

type Rec = Record<string, unknown> & { key: string };

function readBatches(dir: string, field: 'records' | 'results'): Map<string, Rec> {
  const out = new Map<string, Rec>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const r of JSON.parse(readFileSync(join(dir, f), 'utf8'))[field] as Rec[])
      out.set(r.key, r);
  }
  return out;
}

const inputs = readBatches(join(RESEARCH, 'input'), 'records');
const results = readBatches(join(RESEARCH, 'results'), 'results');
const directory = JSON.parse(readFileSync(join(DIR, 'directory.json'), 'utf8')) as {
  groups: {
    directory_key: string;
    name: string;
    description: string | null;
    category: string;
    website: string | null;
    meetup_url: string | null;
    schedule: string | null;
    home_base: string | null;
  }[];
};

function context(key: string) {
  const i = inputs.get(key);
  if (!i) throw new Error(`No research input for ${key}`);
  return {
    event_count: i.event_count,
    future_count: i.future_count,
    first_seen: i.first_seen,
    last_seen: i.last_seen,
    organizers: i.organizers,
    locations: i.locations,
    sample_titles: i.sample_titles,
    sample_urls: i.sample_urls,
    description_excerpt: i.description_excerpt,
  };
}

const records: Rec[] = directory.groups.map((g) => ({
  key: g.directory_key,
  status: 'listed',
  name: g.name,
  description: g.description,
  category: g.category,
  current_website: g.website,
  meetup_url: g.meetup_url,
  schedule: g.schedule,
  home_base: g.home_base,
  ...context(g.directory_key),
}));

for (const key of NETWORKING_RECHECK) {
  const r = results.get(key);
  if (!r) throw new Error(`No research result for ${key}`);
  records.push({
    key,
    status: 'networking_recheck',
    name: r.name,
    description: r.description,
    category: r.category,
    current_website: r.website,
    meetup_url: inputs.get(key)?.meetup_url ?? null,
    schedule: r.schedule,
    home_base: r.home_base,
    earlier_reject_note: r.notes,
    ...context(key),
  });
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(join(RESEARCH, 'links', 'results'), { recursive: true });

// Interleave so every batch gets a similar mix (and the networking rechecks spread out).
const batchCount = Math.ceil(records.length / BATCH_SIZE);
const batches: Rec[][] = Array.from({ length: batchCount }, () => []);
records.forEach((r, i) => batches[i % batchCount].push(r));
batches.forEach((b, i) =>
  writeFileSync(
    join(OUT, `batch-${String(i + 1).padStart(2, '0')}.json`),
    JSON.stringify({ batch: i + 1, records: b }, null, 2)
  )
);

console.log(
  `Records: ${records.length} (${directory.groups.length} listed, ${NETWORKING_RECHECK.length} networking rechecks)`
);
console.log(`Batches: ${batchCount} x ~${BATCH_SIZE} -> ${OUT}`);
