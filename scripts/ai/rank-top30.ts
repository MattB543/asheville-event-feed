/**
 * Run the Top 30 head-to-head pass (lib/top30/headToHead.ts) by hand: the AI ranks the
 * "Meet people" and "Asheville weird" candidates against each other. The daily
 * /api/cron/top30-rank job does the same.
 *
 *   npx tsx scripts/ai/rank-top30.ts [social|weird] [--fresh] [--apply]
 *
 * Dry run by default: prints the order it would save ("was" is each event's place in
 * the saved list). --fresh ranks from scratch instead of starting from the saved order
 * (use it after changing the prompt). --apply saves it. The site shows it once its events
 * cache refreshes: within the hour, or at the next cron that changes events.
 */
import { RANKED_CATEGORIES, rankTop30Category, saveTop30Ranking } from '../../lib/top30/headToHead';

const DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
});

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fresh = args.includes('--fresh');
  const named = args.filter((a) => !a.startsWith('--'));
  const unknown = args.filter(
    (a) => !['--apply', '--fresh'].includes(a) && !RANKED_CATEGORIES.some((c) => c === a)
  );
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(' ')}. Lists: ${RANKED_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  for (const category of RANKED_CATEGORIES.filter((c) => named.length === 0 || named.includes(c))) {
    const started = Date.now();
    const ranking = await rankTop30Category(category, { fresh });
    console.log(
      `\n${category.toUpperCase()}: ${ranking.ranked.length} of ${ranking.candidates} candidates ranked in ${Math.round((Date.now() - started) / 1000)}s`
    );
    ranking.ranked.forEach((entry, i) => {
      const was = entry.previousRank === null ? 'new' : `was ${entry.previousRank}`;
      console.log(
        `${String(i + 1).padStart(2)}. ${was.padEnd(7)} | ${String(entry.score).padStart(2)} | ${DAY.format(entry.startDate).padEnd(6)} | ${entry.title.slice(0, 60)} | ${(entry.organizer ?? '').slice(0, 30)}`
      );
    });
    if (apply) console.log(`Saved ${await saveTop30Ranking(ranking)} ranked rows.`);
  }
  if (!apply) console.log('\nDry run. Add --apply to save.');
  process.exit(0);
}

void main();
