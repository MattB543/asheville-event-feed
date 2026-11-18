/**
 * Hide upcoming events that happen entirely online (Zoom, webinars). The AI cron
 * does this for new events as it tags them; this covers events tagged before it
 * did. Only events that mention being online are judged, with the same AI call
 * the cron uses. Remote public meetings (ONLINE_ALLOWED_SOURCES) are left alone.
 *
 *   npx tsx scripts/hide-online-events.ts            # dry run: prints what would be hidden
 *   npx tsx scripts/hide-online-events.ts --apply    # sets hidden = true
 *
 * Restore one with: UPDATE events SET hidden = false WHERE id = '<id>';
 */

import 'dotenv/config';
import { and, gte, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { liveEvent } from '../lib/db/liveEvent';
import { generateTagsAndSummary, ONLINE_ALLOWED_SOURCES } from '../lib/ai/tagAndSummarize';

const CONCURRENCY = 5;
const apply = process.argv.includes('--apply');

// What the tagging call reads: the title, the location and the description's first 500 chars
const MENTIONS_ONLINE = `(zoom|online|virtual|webinar|livestream|live stream|google meet|video call|via teams|microsoft teams)`;

async function main() {
  const candidates = await db
    .select({
      id: events.id,
      source: events.source,
      title: events.title,
      description: events.description,
      location: events.location,
      organizer: events.organizer,
      startDate: events.startDate,
    })
    .from(events)
    .where(
      and(
        gte(events.startDate, new Date()),
        liveEvent,
        notInArray(events.source, [...ONLINE_ALLOWED_SOURCES, 'CAMPS']),
        sql`(${events.title} ~* ${MENTIONS_ONLINE} OR ${events.location} ~* ${MENTIONS_ONLINE} OR left(${events.description}, 500) ~* ${MENTIONS_ONLINE})`
      )
    )
    .orderBy(events.startDate);

  console.log(`${candidates.length} upcoming events mention being online. Judging each...\n`);

  const online: typeof candidates = [];
  let failed = 0;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    await Promise.all(
      candidates.slice(i, i + CONCURRENCY).map(async (event) => {
        const result = await generateTagsAndSummary(event);
        if (!result.ok) failed++;
        else if (result.onlineOnly) online.push(event);
      })
    );
  }

  online.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  for (const e of online) {
    console.log(
      `${e.id.slice(0, 8)} | ${e.source} | ${e.startDate.toISOString().slice(0, 10)} | ${e.title.slice(0, 70)} | ${(e.location ?? '').slice(0, 50)}`
    );
  }
  console.log(
    `\n${online.length} online-only, ${candidates.length - online.length - failed} in person or hybrid, ${failed} could not be judged`
  );

  if (apply && online.length > 0) {
    await db
      .update(events)
      .set({ hidden: true })
      .where(
        inArray(
          events.id,
          online.map((e) => e.id)
        )
      );
    console.log(`Hid ${online.length} events.`);
  } else if (!apply) {
    console.log('Dry run. Add --apply to hide them.');
  }
  process.exit(0);
}

void main();
