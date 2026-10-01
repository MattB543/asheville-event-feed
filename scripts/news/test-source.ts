/**
 * Run one or more news sources and report what came back.
 *
 * Usage:
 *   npx tsx scripts/news/test-source.ts bpr            # by file name or module key
 *   npx tsx scripts/news/test-source.ts bpr WLOS
 *   npx tsx scripts/news/test-source.ts --all          # every module in NEWS_SOURCES
 *   npx tsx scripts/news/test-source.ts bpr --out <dir>   # also write <dir>/<key>.json
 *   npx tsx scripts/news/test-source.ts bpr --budget 60   # scrape deadline in seconds (default 120)
 *
 * A name that matches a file in lib/news/sources/ is loaded from that file, so a
 * module can be tried before it is added to the registry.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { moduleDomain } from '../../lib/news/identity';
import { NEWS_SOURCES } from '../../lib/news/registry';
import type { FullText, NewsSourceModule, ScrapedArticle } from '../../lib/news/types';

const SOURCES_DIR = path.join(__dirname, '../../lib/news/sources');

/** The ingest cron gives each module 120s (docs/news/05-v1-plan.md §6.1). */
const DEFAULT_BUDGET_S = 120;

const HAS_HTML = /<[a-z][^>]*>/i;
const HAS_ENTITY = /&(#\d+|#x[0-9a-f]+|[a-z]+);/i;

interface Result {
  key: string;
  ok: boolean;
  items: number;
  body: string;
  image: string;
  localOnly: boolean;
  domain: string;
  error?: string;
}

function pct(n: number, total: number): string {
  return total ? `${Math.round((n / total) * 100)}%` : '-';
}

function validate(articles: ScrapedArticle[], key: string): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const urls = new Set<string>();
  const now = Date.now();
  for (const a of articles) {
    const label = `"${a.title?.slice(0, 50)}"`;
    if (a.source !== key) problems.push(`${label}: source "${a.source}" != module key "${key}"`);
    if (!a.title?.trim()) problems.push(`${a.url}: empty title`);
    if (!/^https?:\/\//.test(a.url)) problems.push(`${label}: url not absolute: ${a.url}`);
    if (a.linkedUrl && !/^https?:\/\//.test(a.linkedUrl))
      problems.push(`${label}: linkedUrl not absolute: ${a.linkedUrl}`);
    if (a.imageUrl && !/^https?:\/\//.test(a.imageUrl))
      problems.push(`${label}: imageUrl not absolute: ${a.imageUrl}`);
    if (a.publisher && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(a.publisher.domain))
      problems.push(`${label}: bad publisher domain "${a.publisher.domain}"`);
    if (!(a.publishedAt instanceof Date) || isNaN(a.publishedAt.getTime()))
      problems.push(`${label}: invalid publishedAt`);
    else if (a.publishedAt.getTime() > now + 60 * 60 * 1000)
      problems.push(`${label}: publishedAt in the future`);
    if (ids.has(a.sourceId)) problems.push(`${label}: duplicate sourceId ${a.sourceId}`);
    ids.add(a.sourceId);
    if (urls.has(a.url)) problems.push(`${label}: duplicate url ${a.url}`);
    urls.add(a.url);
    for (const [field, value] of [
      ['title', a.title],
      ['summary', a.summary],
      ['contentText', a.contentText],
    ] as const) {
      if (value && HAS_HTML.test(value)) problems.push(`${label}: ${field} contains HTML`);
      if (value && HAS_ENTITY.test(value))
        problems.push(`${label}: ${field} contains an entity: ${value.match(HAS_ENTITY)?.[0]}`);
    }
  }
  return problems;
}

function splitFullText(full: FullText | undefined): { text?: string; imageUrl?: string } {
  if (full === undefined) return {};
  return typeof full === 'string' ? { text: full } : full;
}

async function runOne(mod: NewsSourceModule, budgetMs: number, outDir?: string): Promise<Result> {
  const domain = moduleDomain(mod);
  console.log('='.repeat(70));
  console.log(
    `${mod.name} (${mod.key}) - ${mod.kind}, ${mod.method}, ${domain}${mod.localOnly ? ', localOnly' : ''}`
  );
  console.log('='.repeat(70));
  const result: Result = {
    key: mod.key,
    ok: false,
    items: 0,
    body: '-',
    image: '-',
    localOnly: !!mod.localOnly,
    domain,
  };

  const started = Date.now();
  let articles: ScrapedArticle[];
  try {
    articles = await mod.scrape({ deadline: started + budgetMs });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.log(`FAILED after ${Date.now() - started}ms:`, result.error);
    return result;
  }
  const elapsed = Date.now() - started;
  const n = articles.length;
  const dates = articles.map((a) => a.publishedAt.getTime()).filter((t) => !isNaN(t));
  console.log(`${n} articles in ${elapsed}ms${elapsed > budgetMs ? ' (PAST THE DEADLINE)' : ''}`);
  if (dates.length) {
    console.log(
      `published ${new Date(Math.min(...dates)).toISOString().slice(0, 10)} .. ${new Date(Math.max(...dates)).toISOString().slice(0, 10)}`
    );
  }
  const count = (f: (a: ScrapedArticle) => unknown) => articles.filter(f).length;
  const has = (f: (a: ScrapedArticle) => unknown) => pct(count(f), n);
  console.log(
    `coverage: summary ${has((a) => a.summary)} | contentText ${has((a) => a.contentText)} | image ${has((a) => a.imageUrl)} | author ${has((a) => a.author)} | categories ${has((a) => a.categories?.length)} | paywalled ${has((a) => a.paywalled)} | publisher ${has((a) => a.publisher)} | linkedUrl ${has((a) => a.linkedUrl)}`
  );
  const avgBody = n
    ? Math.round(articles.reduce((s, a) => s + (a.contentText?.length ?? 0), 0) / n)
    : 0;
  console.log(`avg contentText length: ${avgBody} chars`);

  for (const a of articles.slice(0, 3)) {
    console.log('-'.repeat(70));
    console.log(`${a.publishedAt.toISOString()}  ${a.title}`);
    console.log(`  ${a.url}`);
    if (a.publisher) console.log(`  publisher: ${a.publisher.name} (${a.publisher.domain})`);
    if (a.linkedUrl) console.log(`  links to: ${a.linkedUrl}`);
    if (a.author) console.log(`  by ${a.author}`);
    if (a.categories?.length) console.log(`  [${a.categories.join(', ')}]`);
    if (a.imageUrl) console.log(`  image: ${a.imageUrl}`);
    if (a.summary) console.log(`  summary: ${a.summary.slice(0, 200)}`);
    if (a.contentText) console.log(`  body: ${a.contentText.slice(0, 200).replace(/\n+/g, ' / ')}`);
  }

  let fullTextTried = 0;
  let fullTextGot = 0;
  if (mod.fetchFullText) {
    const needBody = articles.filter((a) => !a.contentText && !a.paywalled).slice(0, 3);
    fullTextTried = needBody.length;
    console.log('-'.repeat(70));
    console.log(`fetchFullText on ${needBody.length} article(s) without a body:`);
    for (const a of needBody) {
      try {
        const { text, imageUrl } = splitFullText(await mod.fetchFullText(a.url));
        if (text) {
          a.contentText = text;
          fullTextGot++;
        }
        if (imageUrl && !a.imageUrl) a.imageUrl = imageUrl;
        const flag = !text
          ? 'EMPTY'
          : HAS_HTML.test(text)
            ? 'HAS HTML'
            : HAS_ENTITY.test(text)
              ? 'HAS ENTITY'
              : 'ok';
        console.log(`  ${flag}  ${text?.length ?? 0} chars  ${a.url}`);
        if (imageUrl) console.log(`        image: ${imageUrl}`);
        if (text) console.log(`        ${text.slice(0, 160).replace(/\n+/g, ' / ')}`);
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
    fs.writeFileSync(path.join(outDir, `${mod.key}.json`), JSON.stringify(articles, null, 2));
  }
  console.log();

  const inFeed = count((a) => a.contentText) - fullTextGot;
  result.items = n;
  result.body =
    [
      inFeed ? `feed ${pct(inFeed, n)}` : '',
      fullTextTried ? `fetchFullText ${fullTextGot}/${fullTextTried}` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'none';
  result.image = has((a) => a.imageUrl);
  result.ok = n > 0 && problems.length === 0;
  return result;
}

async function loadModule(name: string): Promise<NewsSourceModule | undefined> {
  const byKey = NEWS_SOURCES.find((m) => m.key.toLowerCase() === name.toLowerCase());
  if (byKey) return byKey;
  const file = path.join(SOURCES_DIR, `${name}.ts`);
  if (!fs.existsSync(file)) return undefined;
  return (await import(pathToFileURL(file).href)).default as NewsSourceModule;
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const outDir = valueOf('--out');
  const budgetMs = Number(valueOf('--budget') ?? DEFAULT_BUDGET_S) * 1000;
  const names = args.filter(
    (a, i) => !a.startsWith('--') && !['--out', '--budget'].includes(args[i - 1])
  );

  const modules: NewsSourceModule[] = [];
  if (args.includes('--all')) {
    modules.push(...NEWS_SOURCES);
  } else {
    for (const name of names) {
      const mod = await loadModule(name);
      if (!mod) {
        console.error(
          `No module "${name}" (neither a key in NEWS_SOURCES nor lib/news/sources/${name}.ts)`
        );
        process.exit(1);
      }
      modules.push(mod);
    }
  }

  if (!modules.length) {
    console.error(
      'Usage: npx tsx scripts/news/test-source.ts <name|KEY...> | --all [--out <dir>] [--budget <s>]'
    );
    process.exit(1);
  }

  const results: Result[] = [];
  for (const mod of modules) results.push(await runOne(mod, budgetMs, outDir));

  console.log('SUMMARY');
  for (const r of results) {
    console.log(
      `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.key.padEnd(28)} ${String(r.items).padStart(3)} items | body ${r.body} | image ${r.image} | ${r.domain}${r.localOnly ? ' | localOnly' : ''}${r.error ? ` | ${r.error.slice(0, 80)}` : ''}`
    );
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main();
