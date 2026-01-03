/**
 * Fix EXPLORE_ASHEVILLE event times in the database
 *
 * The ExploreAsheville API returns times labeled as UTC (with Z suffix) but they're
 * actually Eastern Time. This script corrects all existing EXPLORE_ASHEVILLE events
 * by adding the appropriate offset (5 hours for EST, 4 hours for EDT).
 */

import 'dotenv/config';
import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Determine if a date falls within Daylight Saving Time (EDT) for US Eastern timezone
 * DST in the US: Second Sunday of March to First Sunday of November
 */
function isEDT(date: Date): boolean {
  const year = date.getUTCFullYear();

  // Find second Sunday of March
  const march1 = new Date(Date.UTC(year, 2, 1)); // March 1
  const marchFirstSunday = new Date(Date.UTC(year, 2, 1 + ((7 - march1.getUTCDay()) % 7)));
  const marchSecondSunday = new Date(marchFirstSunday.getTime() + 7 * 24 * 60 * 60 * 1000);
  // DST starts at 2:00 AM local time (7:00 AM UTC in EST)
  const dstStart = new Date(Date.UTC(year, 2, marchSecondSunday.getUTCDate(), 7, 0, 0));

  // Find first Sunday of November
  const nov1 = new Date(Date.UTC(year, 10, 1)); // November 1
  const novFirstSunday = new Date(Date.UTC(year, 10, 1 + ((7 - nov1.getUTCDay()) % 7)));
  // DST ends at 2:00 AM local time (6:00 AM UTC in EDT)
  const dstEnd = new Date(Date.UTC(year, 10, novFirstSunday.getUTCDate(), 6, 0, 0));

  return date >= dstStart && date < dstEnd;
}

/**
 * Get the hours to add to convert from "fake UTC" (actually ET) to real UTC
 */
function getHoursToAdd(date: Date): number {
  return isEDT(date) ? 4 : 5;
}

async function fixExploreAshevilleTimes() {
  console.log('Fetching EXPLORE_ASHEVILLE events...\n');

  const exploreEvents = await db
    .select()
    .from(events)
    .where(eq(events.source, 'EXPLORE_ASHEVILLE'));

  console.log(`Found ${exploreEvents.length} EXPLORE_ASHEVILLE events to fix\n`);

  if (exploreEvents.length === 0) {
    console.log('No events to fix.');
    return;
  }

  // Show sample before fix
  console.log('Sample events BEFORE fix:');
  for (const event of exploreEvents.slice(0, 5)) {
    const hoursToAdd = getHoursToAdd(event.startDate);
    console.log(`  ${event.title}`);
    console.log(`    Current (wrong): ${event.startDate.toISOString()}`);
    console.log(`    Will add ${hoursToAdd} hours (${hoursToAdd === 5 ? 'EST' : 'EDT'})`);
    const corrected = new Date(event.startDate.getTime() + hoursToAdd * 60 * 60 * 1000);
    console.log(`    Corrected: ${corrected.toISOString()}`);
    console.log();
  }

  // Prompt for confirmation
  console.log('---');
  console.log(`This will update ${exploreEvents.length} events.`);
  console.log('Run with --dry-run to see changes without applying them.');
  console.log('Run with --apply to apply the changes.');
  console.log('---\n');

  const isDryRun = !process.argv.includes('--apply');

  if (isDryRun) {
    console.log('DRY RUN - No changes will be made.\n');
  }

  let updated = 0;
  let errors = 0;

  for (const event of exploreEvents) {
    try {
      const hoursToAdd = getHoursToAdd(event.startDate);
      const newStartDate = new Date(event.startDate.getTime() + hoursToAdd * 60 * 60 * 1000);

      let newRecurringEndDate: Date | null = null;
      if (event.recurringEndDate) {
        const recurringHoursToAdd = getHoursToAdd(event.recurringEndDate);
        newRecurringEndDate = new Date(
          event.recurringEndDate.getTime() + recurringHoursToAdd * 60 * 60 * 1000
        );
      }

      if (!isDryRun) {
        await db
          .update(events)
          .set({
            startDate: newStartDate,
            ...(newRecurringEndDate ? { recurringEndDate: newRecurringEndDate } : {}),
          })
          .where(eq(events.id, event.id));
      }

      updated++;
    } catch (error) {
      console.error(`Error updating event ${event.id} (${event.title}):`, error);
      errors++;
    }
  }

  console.log(`\n${isDryRun ? 'Would update' : 'Updated'}: ${updated} events`);
  if (errors > 0) {
    console.log(`Errors: ${errors}`);
  }

  if (isDryRun) {
    console.log('\nRun with --apply to apply these changes.');
  } else {
    console.log('\nDone! All EXPLORE_ASHEVILLE event times have been corrected.');
  }
}

fixExploreAshevilleTimes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
