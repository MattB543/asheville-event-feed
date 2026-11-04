/**
 * Restore upcoming events that were removed as duplicates and no longer
 * duplicate anything live.
 *
 * Until the scrape upsert started clearing `dedupedAt` on a title or start-time
 * change, a duplicate verdict was permanent. When an event was rescheduled, the
 * copy whose source kept listing it moved to the new date while staying removed,
 * and the copy it lost to stayed live on the old date (2026-11-03: "Mystery
 * Spirit ReMix" never showed on its real date). The upsert fix only covers
 * changes from now on; this finds the rows already stuck.
 *
 * A candidate is a removed duplicate that is upcoming, not hidden or dead, and
 * still scraped after it was removed. Each one is checked pair by pair, with the
 * same rule-based dedup the crons use, against every row on its Eastern day:
 *   - a duplicate of a live row (dedupSkip rows included): left alone
 *   - a duplicate of a hidden or dead row: left alone (moderation)
 *   - removed during the AI dedup cron's run (08:00-08:15 UTC): left alone,
 *     since the rules can't recognise what the AI matched
 *   - anything else is stranded and is restored with --apply. A restored row
 *     that does still duplicate something is removed again by the next scrape.
 *
 * `scripts/run-dedup-local.ts` also runs the AI dedup, at any hour, so the time
 * window can't catch every AI removal. Read the dry run before applying: each
 * stranded row lists live rows that day sharing title words, and
 * `--skip <idPrefix,...>` leaves any that look like the same event.
 *
 * This writes straight to the DB, outside any Next.js request, so restored
 * events appear after the next cron run invalidates the `events` cache tag.
 *
 * Usage:
 *   npx tsx scripts/restore-stranded-dedups.ts                       # dry run
 *   npx tsx scripts/restore-stranded-dedups.ts --apply [--skip 1a2b3c4d,...]
 */
import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { liveEvent } from '../lib/db/liveEvent';
import {
  countSharedTitleWords,
  findDuplicates,
  type EventForDedup,
} from '../lib/utils/deduplication';

const fmtET = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const dayET = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** The AI dedup cron runs daily at 08:00 UTC; the rule-based passes never run then. */
function removedByAIDedup(dedupedAt: Date): boolean {
  return dedupedAt.getUTCHours() === 8 && dedupedAt.getUTCMinutes() < 15;
}

const dedupColumns = {
  id: events.id,
  title: events.title,
  organizer: events.organizer,
  location: events.location,
  startDate: events.startDate,
  price: events.price,
  description: events.description,
  createdAt: events.createdAt,
  source: events.source,
  dedupedAt: events.dedupedAt,
  lastSeenAt: events.lastSeenAt,
};

async function main() {
  const apply = process.argv.includes('--apply');
  let skip: string[] = [];
  if (process.argv.includes('--skip')) {
    const skipArg = process.argv[process.argv.indexOf('--skip') + 1] ?? '';
    skip = skipArg
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (skipArg.startsWith('--') || skip.length === 0) {
      console.error('--skip needs a comma-separated list of id prefixes');
      process.exit(1);
    }
  }
  // Dedup only matches rows on the same day, so nothing before yesterday matters
  const from = sql`now() - interval '1 day'`;

  const candidates = await db
    .select(dedupColumns)
    .from(events)
    .where(
      and(
        isNotNull(events.dedupedAt),
        sql`${events.hidden} IS NOT TRUE`,
        isNull(events.deadAt),
        sql`${events.dedupSkip} IS NOT TRUE`,
        gt(events.startDate, sql`now()`),
        sql`${events.lastSeenAt} > ${events.dedupedAt}`
      )
    );
  const others = await db
    .select({ ...dedupColumns, live: sql<boolean>`${liveEvent}` })
    .from(events)
    .where(
      and(
        gt(events.startDate, from),
        or(liveEvent, sql`${events.hidden} IS TRUE`, isNotNull(events.deadAt))
      )
    );

  const othersByDay = new Map<string, typeof others>();
  for (const o of others) {
    const day = dayET(o.startDate);
    othersByDay.set(day, [...(othersByDay.get(day) ?? []), o]);
  }
  // Pair by pair: grouping everything at once can put a row in another group
  // and hide a direct match.
  const isDuplicate = (a: EventForDedup, b: EventForDedup) => findDuplicates([a, b]).length > 0;
  const sameDay = (c: (typeof candidates)[number]) => othersByDay.get(dayET(c.startDate)) ?? [];

  const stillDuplicate: typeof candidates = [];
  const matchesModerated: typeof candidates = [];
  const byAI: typeof candidates = [];
  const stranded: typeof candidates = [];
  for (const c of candidates) {
    const matches = sameDay(c).filter((o) => isDuplicate(c, o));
    if (matches.some((o) => o.live)) stillDuplicate.push(c);
    else if (matches.length > 0) matchesModerated.push(c);
    else if (removedByAIDedup(c.dedupedAt!)) byAI.push(c);
    else stranded.push(c);
  }
  const toRestore = stranded.filter((s) => !skip.some((p) => s.id.startsWith(p)));

  console.log(`Candidates (removed duplicates still scraped, upcoming): ${candidates.length}`);
  console.log(`  still a duplicate of a live row:  ${stillDuplicate.length}`);
  console.log(`  duplicate of a hidden/dead row:   ${matchesModerated.length}`);
  console.log(`  removed by AI dedup (left alone): ${byAI.length}`);
  console.log(`  stranded:                         ${stranded.length}`);
  console.log(`  skipped by --skip:                ${stranded.length - toRestore.length}\n`);

  // Same-title rows on other dates show what each stranded row lost to (often
  // the old date); live rows that day sharing title words may be the same event.
  const titles = [...new Set(stranded.map((s) => s.title.toLowerCase()))];
  const sameTitle =
    titles.length === 0
      ? []
      : await db
          .select({
            title: events.title,
            source: events.source,
            startDate: events.startDate,
            live: sql<boolean>`${liveEvent}`,
          })
          .from(events)
          .where(inArray(sql`lower(${events.title})`, titles));

  for (const s of stranded.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())) {
    const skipped = toRestore.includes(s) ? '' : '  (skipped)';
    console.log(
      `  ${s.id.slice(0, 8)} [${s.source}] ${fmtET(s.startDate)}  "${s.title.slice(0, 70)}"${skipped}`
    );
    console.log(
      `      removed ${s.dedupedAt!.toISOString().slice(0, 16)}Z, last seen ${s.lastSeenAt!.toISOString().slice(0, 10)}`
    );
    for (const o of sameTitle.filter(
      (o) =>
        o.title.toLowerCase() === s.title.toLowerCase() &&
        o.startDate.getTime() !== s.startDate.getTime()
    )) {
      console.log(
        `      same title: [${o.source}] ${fmtET(o.startDate)}${o.live ? '' : ' (not live)'}`
      );
    }
    for (const o of sameDay(s).filter(
      (o) => o.live && o.id !== s.id && countSharedTitleWords(o.title, s.title) >= 2
    )) {
      console.log(
        `      same day, similar title: [${o.source}] ${fmtET(o.startDate)} "${o.title.slice(0, 60)}"`
      );
    }
  }
  if (byAI.length > 0) {
    console.log('\nRemoved by AI dedup (not restored; check by hand if any look wrong):');
    for (const s of byAI) {
      console.log(
        `  ${s.id.slice(0, 8)} [${s.source}] ${fmtET(s.startDate)}  "${s.title.slice(0, 70)}"`
      );
    }
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply (and --skip for any to leave) to restore.');
    process.exit(0);
  }
  if (toRestore.length > 0) {
    // Only rows exactly as audited: a scrape since may have changed or re-judged them
    const restored = await db
      .update(events)
      .set({ dedupedAt: null })
      .where(
        or(
          ...toRestore.map((s) =>
            and(
              eq(events.id, s.id),
              eq(events.dedupedAt, s.dedupedAt!),
              eq(events.title, s.title),
              eq(events.startDate, s.startDate),
              sql`${events.hidden} IS NOT TRUE`,
              isNull(events.deadAt),
              sql`${events.dedupSkip} IS NOT TRUE`
            )
          )
        )
      )
      .returning({ id: events.id });
    console.log(`\nRestored ${restored.length} of ${toRestore.length} events.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
