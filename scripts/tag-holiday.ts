/**
 * Give every event of a holiday's season, from today through its last day (Eastern), the
 * holiday's tag, and take it off any that aren't, so its page and "See all" link
 * (`tagsInclude=<tag>`) cover the same events. The AI reads each event in the window, by the
 * same rule as the tagging prompt; new events get the tag as they're enriched.
 *
 *   npx tsx scripts/tag-holiday.ts thanksgiving            # dry run: prints what would change
 *   npx tsx scripts/tag-holiday.ts thanksgiving --apply    # writes the tags
 */

import 'dotenv/config';
import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { liveEvent } from '../lib/db/liveEvent';
import { azureChatCompletion, parseJsonFromModel } from '../lib/ai/provider-clients';
import { HOLIDAYS, holidayLastDay } from '../lib/holidays/config';
import { loadSeasons } from '../lib/db/queries/seasonSettings';
import { getDayBoundariesEastern, getTodayStringEastern } from '../lib/utils/timezone';

function usage(): never {
  console.error(
    `Usage: npx tsx scripts/tag-holiday.ts <${HOLIDAYS.map((h) => h.key).join('|')}> [--apply]`
  );
  process.exit(1);
}
const holiday = HOLIDAYS.find((h) => h.key === process.argv[2]) ?? usage();
const TAG = holiday.tag;
const BATCH = 25;
const CONCURRENCY = 4;
const apply = process.argv.includes('--apply');

const SYSTEM_PROMPT = `You decide which Asheville, NC events are ${TAG} events.

Say yes ${holiday.rule} Read the description: a listing whose description calls the event a ${TAG} one is a yes even when the title says nothing. Say no when it only shares a word with the holiday.

Return JSON: {"results": [{"n": <the event's n>, "yes": true|false}]} with one entry per event given.`;

interface Row {
  id: string;
  title: string;
  organizer: string | null;
  location: string | null;
  aiSummary: string | null;
  description: string | null;
  tags: string[] | null;
}

async function classify(batch: Row[]): Promise<Map<string, boolean>> {
  // Numbered rather than keyed by id: the model can mistype a UUID, not a small number
  const lines = batch.map((e, n) =>
    JSON.stringify({
      n,
      title: e.title,
      host: e.organizer,
      venue: e.location?.split(',')[0],
      summary: e.aiSummary,
      description: e.description?.replace(/\s+/g, ' ').slice(0, 600),
    })
  );
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await azureChatCompletion(SYSTEM_PROMPT, lines.join('\n'), {
      jsonMode: true,
      reasoningEffort: 'medium',
      maxTokens: 6000,
    });
    const parsed = parseJsonFromModel<{ results?: { n: number; yes: boolean }[] }>(
      response?.content ?? '',
      'object'
    );
    const results = new Map<string, boolean>();
    for (const r of parsed?.results ?? []) {
      const event = typeof r?.n === 'number' ? batch[r.n] : undefined;
      if (event && typeof r.yes === 'boolean') results.set(event.id, r.yes);
    }
    if (results.size === batch.length) return results;
    console.warn(`\nBatch answered ${results.size}/${batch.length}, retrying (${attempt}/3)`);
  }
  throw new Error(`No complete answer for batch starting ${batch[0].id}`);
}

async function main() {
  const today = getTodayStringEastern();
  const lastDay = holidayLastDay(holiday.key, await loadSeasons(), today);
  const rows: Row[] = await db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      location: events.location,
      aiSummary: events.aiSummary,
      description: events.description,
      tags: events.tags,
    })
    .from(events)
    .where(
      and(
        liveEvent,
        gte(events.startDate, getDayBoundariesEastern(today).start),
        lt(events.startDate, getDayBoundariesEastern(lastDay).end)
      )
    )
    .orderBy(events.startDate);
  console.log(`${rows.length} live events from ${today} through ${lastDay}`);

  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  const verdicts = new Map<string, boolean>();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        for (const [id, yes] of await classify(batch)) verdicts.set(id, yes);
        process.stdout.write(`\r${verdicts.size}/${rows.length} judged`);
      }
    })
  );
  console.log();

  const add = rows.filter((e) => verdicts.get(e.id) && !(e.tags ?? []).includes(TAG));
  const remove = rows.filter((e) => !verdicts.get(e.id) && (e.tags ?? []).includes(TAG));
  const tagged = rows.filter((e) => verdicts.get(e.id));
  console.log(
    `\n${TAG}: ${tagged.length}. Adding the tag to ${add.length}, removing it from ${remove.length}.`
  );
  for (const e of tagged) console.log(`  + ${e.id.slice(0, 8)} ${e.title}`);
  console.log(`\nJudged not ${TAG} but matching a ${TAG} word (check these):`);
  // The page's Postgres word pattern, in JavaScript
  const word = new RegExp(holiday.titleWords.replace(/\\[mM]/g, '\\b'), 'i');
  for (const e of rows.filter(
    (e) => !verdicts.get(e.id) && word.test(`${e.title} ${e.aiSummary ?? ''}`)
  ))
    console.log(`  - ${e.id.slice(0, 8)} ${e.title}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    process.exit(0);
  }
  if (add.length > 0) {
    await db
      .update(events)
      .set({ tags: sql`array_append(COALESCE(${events.tags}, '{}'), ${TAG})` })
      .where(
        and(
          inArray(
            events.id,
            add.map((e) => e.id)
          ),
          sql`NOT (${TAG} = ANY(COALESCE(${events.tags}, '{}')))`
        )
      );
  }
  if (remove.length > 0) {
    await db
      .update(events)
      .set({ tags: sql`array_remove(${events.tags}, ${TAG})` })
      .where(
        inArray(
          events.id,
          remove.map((e) => e.id)
        )
      );
  }
  console.log(`Applied: +${add.length}, -${remove.length}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
