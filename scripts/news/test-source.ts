/**
 * Run one or more news sources and report what came back.
 *
 * Usage:
 *   npx tsx scripts/news/test-source.ts bpr            # lib/news/sources/bpr.ts
 *   npx tsx scripts/news/test-source.ts bpr wlos
 *   npx tsx scripts/news/test-source.ts --all
 *   npx tsx scripts/news/test-source.ts bpr --out <dir>   # also write <dir>/<name>.json
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { NewsSourceModule, ScrapedArticle } from '../../lib/news/types';

const SOURCES_DIR = path.join(__dirname, '../../lib/news/sources');

function pct(n: number, total: number): string {
  return total ? `${Math.round((n / total) * 100)}%` : '-';
}

function validate(articles: ScrapedArticle[], key: string): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const now = Date.now();
  for (const a of articles) {
    const label = `"${a.title?.slice(0, 50)}"`;
    if (a.source !== key) problems.push(`${label}: source "${a.source}" != module key "${key}"`);
    if (!a.title?.trim()) problems.push(`${a.url}: empty title`);
    if (!/^https?:\/\//.test(a.url)) problems.push(`${label}: url not absolute: ${a.url}`);
    if (!(a.publishedAt instanceof Date) || isNaN(a.publishedAt.getTime()))
      problems.push(`${label}: invalid publishedAt`);
    else if (a.publishedAt.getTime() > now + 60 * 60 * 1000) problems.push(`${label}: publishedAt in the future`);
    if (ids.has(a.sourceId)) problems.push(`${label}: duplicate sourceId ${a.sourceId}`);
    ids.add(a.sourceId);
    if (a.summary && /<[a-z][^>]*>/i.test(a.summary)) problems.push(`${label}: summary contains HTML`);
    if (a.contentText && /<[a-z][^>]*>/i.test(a.contentText)) problems.push(`${label}: contentText contains HTML`);
  }
  return problems;
}

async function runOne(file: string, outDir?: string): Promise<boolean> {
  const name = path.basename(file, '.ts');
  const mod = (await import(pathToFileURL(file).href)).default as NewsSourceModule;
  console.log('='.repeat(70));
  console.log(`${mod.name} (${mod.key}) - ${mod.method}${mod.localOnly ? ', localOnly' : ''}`);
  console.log('='.repeat(70));

  const started = Date.now();
  let articles: ScrapedArticle[];
  try {
    articles = await mod.scrape();
  } catch (err) {
    console.log(`FAILED after ${Date.now() - started}ms:`, err instanceof Error ? err.message : err);
    return false;
  }
  const n = articles.length;
  const dates = articles.map((a) => a.publishedAt.getTime()).filter((t) => !isNaN(t));
  console.log(`${n} articles in ${Date.now() - started}ms`);
  if (dates.length) {
    console.log(
      `published ${new Date(Math.min(...dates)).toISOString().slice(0, 10)} .. ${new Date(Math.max(...dates)).toISOString().slice(0, 10)}`
    );
  }
  const has = (f: (a: ScrapedArticle) => unknown) => pct(articles.filter(f).length, n);
  console.log(
    `coverage: summary ${has((a) => a.summary)} | contentText ${has((a) => a.contentText)} | image ${has((a) => a.imageUrl)} | author ${has((a) => a.author)} | categories ${has((a) => a.categories?.length)} | paywalled ${has((a) => a.paywalled)}`
  );
  const avgBody = n ? Math.round(articles.reduce((s, a) => s + (a.contentText?.length ?? 0), 0) / n) : 0;
  console.log(`avg contentText length: ${avgBody} chars`);

  for (const a of articles.slice(0, 3)) {
    console.log('-'.repeat(70));
    console.log(`${a.publishedAt.toISOString()}  ${a.title}`);
    console.log(`  ${a.url}`);
    if (a.author) console.log(`  by ${a.author}`);
    if (a.categories?.length) console.log(`  [${a.categories.join(', ')}]`);
    if (a.summary) console.log(`  summary: ${a.summary.slice(0, 200)}`);
    if (a.contentText) console.log(`  body: ${a.contentText.slice(0, 200).replace(/\n+/g, ' / ')}`);
  }

  if (mod.fetchFullText) {
    const needBody = articles.filter((a) => !a.contentText && !a.paywalled).slice(0, 3);
    console.log('-'.repeat(70));
    console.log(`fetchFullText on ${needBody.length} article(s) without a body:`);
    for (const a of needBody) {
      try {
        const body = await mod.fetchFullText(a.url);
        if (body) a.contentText = body;
        const flag = !body ? 'EMPTY' : /<[a-z][^>]*>/i.test(body) ? 'HAS HTML' : 'ok';
        console.log(`  ${flag}  ${body?.length ?? 0} chars  ${a.url}`);
        if (body) console.log(`        ${body.slice(0, 160).replace(/\n+/g, ' / ')}`);
      } catch (err) {
        console.log(`  FAILED  ${a.url}: ${err instanceof Error ? err.message : err}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const problems = validate(articles, mod.key);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 15)) console.log(`  - ${p}`);
  }

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(articles, null, 2));
  }
  console.log();
  return n > 0 && problems.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const names = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));

  const files = args.includes('--all')
    ? fs
        .readdirSync(SOURCES_DIR)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => path.join(SOURCES_DIR, f))
    : names.map((n) => path.join(SOURCES_DIR, `${n}.ts`));

  if (!files.length) {
    console.error('Usage: npx tsx scripts/news/test-source.ts <name...> | --all [--out <dir>]');
    process.exit(1);
  }

  const results: Array<[string, boolean]> = [];
  for (const file of files) results.push([path.basename(file, '.ts'), await runOne(file, outDir)]);

  console.log('SUMMARY');
  for (const [name, ok] of results) console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

main();
