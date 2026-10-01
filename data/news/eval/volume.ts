import * as fs from 'fs';
import * as path from 'path';
import { parseFeed } from '../../../../../../../../projects/asheville-event-feed/lib/news/feeds';
const SP = process.argv[2];
const files = [
  'news/wlos-rss.xml','news/fox-rss.xml','news/bpr-bpr-news.rss','news/bpr-local-nc-news.rss','news/bpr-helene-recovery.rss',
  'news/bpr-politics-government.rss','news/bpr-growth-development.rss','news/bpr-education.rss','news/bpr-health.rss',
  'news/bpr-climate-environment.rss','news/bpr-arts-performance.rss','news/probe/avl-feed.xml','news/probe/feed_ashvegas.com.xml',
  'news/probe/feed_ashevillemade.com.xml','news/raw/reddit_asheville.rss','news/wyff-rss.html'];
for (const f of files) {
  const p = path.join(SP, f);
  if (!fs.existsSync(p)) { console.log(f, 'MISSING'); continue; }
  try {
    const items = parseFeed(fs.readFileSync(p, 'utf8'));
    const ds = items.map(i => i.publishedAt?.getTime()).filter(Boolean) as number[];
    const min = ds.length ? new Date(Math.min(...ds)) : null, max = ds.length ? new Date(Math.max(...ds)) : null;
    const days = min && max ? Math.max(1, (max.getTime()-min.getTime())/86400000) : 0;
    const body = items.filter(i => (i.contentHtml?.length ?? 0) > 500).length;
    console.log(`${f.padEnd(42)} n=${String(items.length).padStart(3)} ${min?.toISOString().slice(0,10)}..${max?.toISOString().slice(0,10)} ~${days? (items.length/days).toFixed(1):'-'}/day fullbody=${body}`);
  } catch (e) { console.log(f, 'ERR', (e as Error).message); }
}
