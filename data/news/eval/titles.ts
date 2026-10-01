import * as fs from 'fs';
import * as path from 'path';
import { parseFeed } from '../../../../../../../../projects/asheville-event-feed/lib/news/feeds';
const SP = process.argv[2];
for (const f of process.argv.slice(3)) {
  const items = parseFeed(fs.readFileSync(path.join(SP, f), 'utf8'));
  console.log('== ' + f);
  for (const i of items) console.log(`  ${i.publishedAt?.toISOString().slice(0,16)} | ${i.title.slice(0,110)} | [${i.categories.slice(0,3).join(',')}]`);
}
