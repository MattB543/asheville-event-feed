/** Build an offline article corpus from feeds already on disk. No network, no DB. */
import * as fs from 'fs';
import * as path from 'path';
import { parseFeed, htmlToText, canonicalizeUrl } from '../../../../../../../../projects/asheville-event-feed/lib/news/feeds';

const P = process.argv[2];
const NEWS = path.join(P, '..', 'news');
const since = new Date('2026-09-16T00:00:00Z').getTime();

type Doc = { id: string; outlet: string; feed: string; title: string; dek: string; text: string; publishedAt: string; url: string; availability: 'full' | 'excerpt' | 'headline'; categories: string[] };
const docs: Doc[] = [];
const seen = new Set<string>();

function add(feed: string, outlet: string | null, file: string) {
  if (!fs.existsSync(file)) return;
  for (const it of parseFeed(fs.readFileSync(file, 'utf8'))) {
    if (!it.publishedAt || it.publishedAt.getTime() < since) continue;
    let title = it.title, o = outlet;
    if (!o) { // Google News: "Headline - Outlet"
      const m = title.match(/^(.*) - ([^-]+)$/);
      if (m) { title = m[1].trim(); o = m[2].trim(); } else o = 'GoogleNews?';
    }
    const url = canonicalizeUrl(it.link);
    const key = o + '|' + title.toLowerCase();
    if (seen.has(url) || seen.has(key)) continue;
    seen.add(url); seen.add(key);
    const text = htmlToText(it.contentHtml) ?? '';
    const dek = (htmlToText(it.descriptionHtml) ?? '').slice(0, 400);
    const deckIsTitle = dek.toLowerCase().startsWith(title.toLowerCase().slice(0, 30));
    docs.push({
      id: `a${docs.length + 1}`, outlet: o!, feed, title,
      dek: feed.startsWith('gnews') || deckIsTitle ? '' : dek,
      text: text.slice(0, 8000), publishedAt: it.publishedAt.toISOString(), url,
      availability: text.length > 800 ? 'full' : dek && !feed.startsWith('gnews') ? 'excerpt' : 'headline',
      categories: it.categories,
    });
  }
}

add('city', 'City of Asheville', path.join(NEWS, 'probe/avl-feed.xml'));
add('watchdog', 'Asheville Watchdog', path.join(P, 'feeds/watchdog.xml'));
add('mx', 'Mountain Xpress', path.join(P, 'feeds/mountainx.xml'));
for (const f of fs.readdirSync(NEWS).filter((f) => f.startsWith('bpr-') && f.endsWith('.rss'))) add('bpr', 'BPR', path.join(NEWS, f));
add('fox', 'FOX Carolina', path.join(NEWS, 'fox-rss.xml'));
add('smn', 'Smoky Mountain News', path.join(P, 'feeds/smn.xml'));
add('cpp', 'Carolina Public Press', path.join(P, 'feeds/cpp.xml'));
add('reddit', 'r/asheville', path.join(NEWS, 'raw/reddit_asheville.rss'));
add('gnews', null, path.join(P, 'feeds/gnews-asheville.xml'));
add('gnews', null, path.join(P, 'feeds/gnews-buncombe.xml'));

fs.writeFileSync(path.join(P, 'corpus.json'), JSON.stringify(docs, null, 2));
const by: Record<string, number> = {};
for (const d of docs) by[d.feed + ':' + d.availability] = (by[d.feed + ':' + d.availability] ?? 0) + 1;
console.log(docs.length, 'docs', by);
