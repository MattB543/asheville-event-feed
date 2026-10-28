/**
 * Camps pilot: read Asheville Parks & Rec's WebTrac catalog (deterministic, no model) and save the
 * summer camp rows + detail pages to data/camps/pilot/webtrac.json. build-pilot.ts turns them into
 * cards with lib/camps/webtrac.ts.
 *
 * Usage:
 *   npx tsx scripts/camps/read-webtrac.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readWebTracCatalog, webTracCards } from '../../lib/camps/webtrac';

const OUT = join(process.cwd(), 'data', 'camps', 'pilot', 'webtrac.json');

async function main() {
  const started = Date.now();
  const catalog = await readWebTracCatalog();
  await mkdir(join(process.cwd(), 'data', 'camps', 'pilot'), { recursive: true });
  await writeFile(OUT, JSON.stringify({ ...catalog, ms: Date.now() - started }, null, 2) + '\n');

  const cards = webTracCards(catalog);
  console.log(
    `${catalog.activities} activities in the catalog, ${catalog.rows.length} summer camp rows -> ${cards.length} cards (${Math.round((Date.now() - started) / 1000)}s)`
  );
  for (const card of cards) {
    console.log(
      `  ${card.name} | ${card.variant ?? '-'} | ${card.type} | ages ${card.ages?.min}-${card.ages?.max} | ${card.sessions.length} sessions | ${card.availability?.status}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
