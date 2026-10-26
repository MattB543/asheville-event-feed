/**
 * Give every Halloween event from today through Oct 31 (Eastern) the "Halloween" tag,
 * and take it off any that aren't, so the /halloween page and its "See all" link
 * (`tagsInclude=Halloween`) cover the same events. The AI reads each event in the
 * window; new events get the tag from the tagging prompt as they're enriched.
 *
 *   npx tsx scripts/tag-halloween.ts            # dry run: prints what would change
 *   npx tsx scripts/tag-halloween.ts --apply    # writes the tags
 */

import 'dotenv/config';
import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { liveEvent } from '../lib/db/liveEvent';
import { azureChatCompletion, parseJsonFromModel } from '../lib/ai/provider-clients';
import { getDayBoundariesEastern, getTodayStringEastern } from '../lib/utils/timezone';

const TAG = 'Halloween';
const BATCH = 25;
const CONCURRENCY = 4;
const apply = process.argv.includes('--apply');

const SYSTEM_PROMPT = `You decide which Asheville, NC events are Halloween events.

Say yes when the event itself is themed around Halloween or the spooky season: a Halloween party, costume party or contest, trick-or-treating, trunk-or-treat, haunted house or trail, ghost or haunted tour, Halloween-themed class, craft, workout, market, run, story time or concert, Day of the Dead / Samhain celebrations, a "spooky", "boo", "creepy", "monster mash" or similar themed edition of a regular event. Horror, gothic, monster or witch-themed plays, films, readings and shows running this month count too: they are spooky-season fare (Dracula, Misery, Rocky Horror, Frankenstein, a horror film screening, ghost stories). Read the description: a listing whose description calls the night a Halloween show, party or celebration, or invites costumes for Halloween, is a yes even when the title says nothing.

Say no when the event only happens to fall in late October, or only shares a word: a masquerade gala or fashion show with no Halloween theme, a band, tour or venue whose name merely contains "ghost", "haunt" or "monster", a fall festival, corn maze or pumpkin patch with no Halloween theme, a regular drag, comedy, trivia or music night with nothing seasonal in its listing, generic networking.

Return JSON: {"results": [{"n": <the event's n>, "halloween": true|false}]} with one entry per event given.`;

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
    const parsed = parseJsonFromModel<{ results?: { n: number; halloween: boolean }[] }>(
      response?.content ?? '',
      'object'
    );
    const results = new Map<string, boolean>();
    for (const r of parsed?.results ?? []) {
      const event = typeof r?.n === 'number' ? batch[r.n] : undefined;
      if (event && typeof r.halloween === 'boolean') results.set(event.id, r.halloween);
    }
    if (results.size === batch.length) return results;
    console.warn(`\nBatch answered ${results.size}/${batch.length}, retrying (${attempt}/3)`);
  }
  throw new Error(`No complete answer for batch starting ${batch[0].id}`);
}

async function main() {
  const today = getTodayStringEastern();
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
        lt(events.startDate, getDayBoundariesEastern(`${today.slice(0, 4)}-10-31`).end)
      )
    )
    .orderBy(events.startDate);
  console.log(`${rows.length} live events from ${today} through Oct 31`);

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
  const halloween = rows.filter((e) => verdicts.get(e.id));
  console.log(
    `\nHalloween: ${halloween.length}. Adding the tag to ${add.length}, removing it from ${remove.length}.`
  );
  for (const e of halloween) console.log(`  + ${e.id.slice(0, 8)} ${e.title}`);
  console.log('\nJudged not Halloween but matching a Halloween word (check these):');
  const word =
    /\b(hallowe|spook|haunt|zombie|costume|ghost|witch|monster|vampire|horror|goth|creep|masquerade|muertos|trick.or.treat|boo\b)/i;
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
