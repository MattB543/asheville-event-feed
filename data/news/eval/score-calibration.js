// Calibrate news_score / Top thresholds on the prototype's clustered stories. No AI calls.
// Usage: node score-calibration.js [stories-minimal-1.json]
const fs = require('fs');
const { hit } = require('./gazetteer.js');
const corpus = Object.fromEntries(require('./corpus.json').map((d) => [d.id, d]));
const enriched = require('./enriched.json');
const assign = JSON.parse(fs.readFileSync(process.argv[2] || 'stories-minimal-1.json', 'utf8'));

const NON_NEWS = new Set(['opinion', 'letter', 'question', 'classified', 'community_post']);
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const etDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const stories = {};
for (const [aid, sid] of Object.entries(assign)) (stories[sid] ??= []).push(aid);

const rows = [];
for (const [sid, ids] of Object.entries(stories)) {
  const newsroom = ids.filter((a) => corpus[a].feed !== 'reddit');
  const community = ids.length - newsroom.length;
  if (!newsroom.length) continue; // community-tier story: Around town, not ranked here
  const e = newsroom.map((a) => enriched[a]);
  const relevant = newsroom.some((a) => {
    const x = enriched[a];
    const d = corpus[a];
    return ['asheville', 'buncombe'].includes(x.geoScope) || hit([d.title, d.dek, x.whatHappened].join(' '));
  });
  if (!relevant) continue;
  const lead = e.reduce((b, x) => ((x.importance ?? 0) > (b.importance ?? 0) ? x : b), e[0]);
  const importance = Math.max(...e.map((x) => x.importance ?? 0));
  const outlets = new Set(newsroom.map((a) => norm(corpus[a].title))).size; // wire copies share a title
  const distinctOutlets = Math.min(outlets, new Set(newsroom.map((a) => corpus[a].outlet)).size);
  const primary = newsroom.some((a) => corpus[a].feed === 'city' || enriched[a].articleType === 'press_release');
  const place = e.some((x) => (x.places ?? []).some((p) => hit(p)));
  const buzz = Math.min(10, community);
  const allNonNews = e.every((x) => NON_NEWS.has(x.articleType));
  const brief = e.every((x) => ['service'].includes(x.articleType) || (x.articleType === 'press_release' && (x.importance ?? 0) <= 3));
  const incident = (lead.topics ?? [])[0] === 'Crime & Courts';
  const V2 = process.env.V2 === '1';
  const newsroomOriginal = newsroom.some((a) => corpus[a].feed !== 'city' && enriched[a].articleType !== 'press_release');
  const coverage = V2
    ? (newsroomOriginal ? 2 : 0) + Math.min(4, 2 * Math.log2(Math.max(1, distinctOutlets)))
    : Math.min(6, 2 * Math.log2(Math.max(1, distinctOutlets)));
  let score = 2 * importance + coverage + (primary ? 1 : 0) + (place ? 1 : 0) + Math.min(2, buzz / 5);
  score = Math.max(0, Math.min(30, Math.round(score)));
  if (V2 && incident) score = Math.min(score, 10);
  if (V2 && brief) score = Math.min(score, 8);
  const day = etDay(newsroom.map((a) => corpus[a].publishedAt).sort().at(-1));
  rows.push({ sid, day, score, importance, outlets: distinctOutlets, brief, incident, opinion: allNonNews, title: corpus[newsroom[0]].title.slice(0, 70) });
}

const days = [...new Set(rows.map((r) => r.day))].sort();
console.log('day        stories eligible  >=15  >=13  >=8   top(5 cap, 2 floor)');
for (const d of days.filter((x) => x >= '2026-09-18')) {
  const all = rows.filter((r) => r.day === d);
  const elig = all.filter((r) => !r.brief && !r.incident && !r.opinion).sort((a, b) => b.score - a.score);
  const ge = (t) => elig.filter((r) => r.score >= t).length;
  let top = elig.filter((r) => r.score >= 15).slice(0, 5);
  if (top.length < 2) top = [...top, ...elig.filter((r) => r.score >= 8 && !top.includes(r))].slice(0, 2);
  console.log(`${d}   ${String(all.length).padStart(5)}  ${String(elig.length).padStart(7)}  ${String(ge(15)).padStart(4)}  ${String(ge(13)).padStart(4)}  ${String(ge(8)).padStart(4)}   ${top.length} (${Math.round((100 * top.length) / Math.max(1, all.length))}% of all, ${Math.round((100 * top.length) / Math.max(1, elig.length))}% of eligible)`);
}
const hist = {};
for (const r of rows.filter((x) => !x.brief && !x.incident && !x.opinion)) hist[r.score] = (hist[r.score] ?? 0) + 1;
console.log('\nscore histogram (eligible):', JSON.stringify(hist));
console.log('\nstories >= 15:');
for (const r of rows.filter((x) => x.score >= 15).sort((a, b) => b.score - a.score))
  console.log(`  ${r.day} ${r.score} imp${r.importance} out${r.outlets}${r.brief ? ' BRIEF' : ''}${r.incident ? ' INCIDENT' : ''}${r.opinion ? ' OPINION' : ''} ${r.title}`);
console.log('\nstories 11-14 (the band that decides quiet days):');
for (const r of rows.filter((x) => x.score >= 11 && x.score < 15 && !x.brief && !x.incident && !x.opinion).sort((a, b) => b.score - a.score))
  console.log(`  ${r.day} ${r.score} imp${r.importance} out${r.outlets} ${r.title}`);
