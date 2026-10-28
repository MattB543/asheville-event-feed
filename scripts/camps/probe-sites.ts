/**
 * Camps pilot, step 0: read every camp URL in the exa seed sheet with fetchPageText and report which
 * rung of the fetch ladder each needed, plus the registration platforms each page links. Used to pick
 * the pilot set (a blocked site, a Jackrabbit / iClassPro catalog) and as a test of the fetcher.
 *
 * Usage:
 *   npx tsx scripts/camps/probe-sites.ts            # writes data/camps/pilot/site-probe.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPageTextFetcher, FetchPageError } from '../../lib/camps/fetchPageText';
import { detectPlatforms } from '../../lib/camps/platforms';
import { fetchSeedSheet } from '../../lib/camps/seedSheet';

const OUT = join(process.cwd(), 'data', 'camps', 'pilot', 'site-probe.json');
const CONCURRENCY = 6;

async function main() {
  const rows = await fetchSeedSheet();
  const targets = rows.filter((row) => row.url && !/avlgo\.com/.test(row.url));
  console.log(`${targets.length} sheet rows with a URL`);

  const fetcher = createPageTextFetcher({ cacheTtlMs: 0 });
  const results: Array<Record<string, unknown>> = [];
  let next = 0;

  async function worker() {
    while (next < targets.length) {
      const row = targets[next++];
      try {
        const page = await fetcher.get(row.url);
        const platforms = detectPlatforms(page.links.map((link) => link.href));
        results.push({
          name: row.name,
          url: row.url,
          method: page.method,
          kind: page.kind,
          chars: page.text.length,
          ms: page.ms,
          attempts: page.attempts,
          finalUrl: page.finalUrl,
          platforms,
          pdfLinks: page.links.filter((link) => /\.pdf(?:$|\?)/i.test(link.href)).length,
          mentions2027: /\b2027\b/.test(page.text),
        });
        console.log(
          `${page.method.padEnd(10)} ${String(page.text.length).padStart(6)}  ${row.name}${platforms.length ? `  [${platforms.join(', ')}]` : ''}`
        );
      } catch (error) {
        const attempts = error instanceof FetchPageError ? error.attempts : [String(error)];
        results.push({ name: row.name, url: row.url, method: 'failed', attempts });
        console.log(`FAILED     ${row.name}: ${attempts.join(' | ')}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await fetcher.close();

  const byMethod: Record<string, number> = {};
  for (const result of results) {
    const method = String(result.method);
    byMethod[method] = (byMethod[method] ?? 0) + 1;
  }
  console.log('\nBy method:', byMethod);

  await mkdir(join(process.cwd(), 'data', 'camps', 'pilot'), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ probedAt: new Date().toISOString(), byMethod, results }, null, 2) + '\n'
  );
  console.log(`Wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
