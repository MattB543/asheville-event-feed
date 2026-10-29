/**
 * Summer camps in the event feed: show what syncCampEvents (lib/camps/feedEvents.ts) would create,
 * update and hide in the events table, or do it.
 *
 * DATABASE_URL is the live database. Scripts can't expire Next's cache, so after --apply the feed
 * shows the change within the hour (the "[Cache] Failed to invalidate" line is expected here).
 *
 * Usage:
 *   npx tsx scripts/camps/sync-feed-events.ts           # dry run: reads only
 *   npx tsx scripts/camps/sync-feed-events.ts --apply
 */
import '../../lib/config/env';
import { planCampEvents, syncCampEvents, type CampEventValues } from '../../lib/camps/feedEvents';
import { formatDateEastern } from '../../lib/utils/timezone';

const SHOW = 15;

function when(values: CampEventValues): string {
  return formatDateEastern(values.startDate, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(values.timeUnknown ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
}

function show<T>(rows: T[], line: (row: T) => string): void {
  for (const row of rows.slice(0, SHOW)) console.log(`  ${line(row)}`);
  if (rows.length > SHOW) console.log(`  ... and ${rows.length - SHOW} more`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const plan = await planCampEvents();

  console.log(
    `Season ${plan.season}: ${plan.camps} live in-radius camps, ${plan.dated} with a ${plan.season} date.`
  );
  console.log(
    `Would create ${plan.create.length}, update ${plan.update.length}, hide ${plan.remove.length}; ` +
      `${plan.unchanged.length} unchanged.`
  );

  if (plan.create.length > 0) {
    console.log('\nCreate:');
    show(
      plan.create,
      (values) =>
        `${when(values)} | ${values.title} | ${values.organizer} | ${values.location ?? '(no location)'} | ` +
        `${values.price ?? '(no price)'} | ${values.tags.join(', ')}`
    );
    const [sample] = plan.create;
    console.log(`\nSample row (${sample.url}):\n${JSON.stringify(sample, null, 2)}`);
  }
  if (plan.update.length > 0) {
    console.log('\nUpdate:');
    show(plan.update, ({ values, changed }) => `${values.title}: ${changed.join(', ')}`);
  }
  if (plan.remove.length > 0) {
    console.log('\nHide:');
    show(plan.remove, ({ title, reason }) => `${title} (${reason})`);
  }

  if (!apply) {
    console.log('\nDry run: nothing written. Run with --apply to write.');
    return;
  }
  const result = await syncCampEvents();
  console.log(
    `\nWrote: ${result.created} created, ${result.updated} updated, ${result.removed} hidden.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
