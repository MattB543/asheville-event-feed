/**
 * Verify a single event against its source URL, with the same verifier and
 * write policy as the verify cron (lib/ai/eventVerification.ts).
 *
 * Usage: npx tsx scripts/verify-event.ts <idPrefix> [--update]
 *
 * Without --update this only reports what verification concludes. With it, the
 * result is applied exactly as the cron would apply it (confidence threshold,
 * description protection, dead-link rule).
 *
 * Examples:
 *   npx tsx scripts/verify-event.ts e4df13
 *   npx tsx scripts/verify-event.ts e4df13 --update
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql } from 'drizzle-orm';
import { applyVerification, isVerificationEnabled, verifyEvent } from '../lib/ai/eventVerification';

async function main() {
  const idPrefix = process.argv[2];
  const shouldUpdate = process.argv.includes('--update');

  if (!idPrefix) {
    console.log('Usage: npx tsx scripts/verify-event.ts <idPrefix> [--update]');
    process.exit(1);
  }
  if (!isVerificationEnabled()) {
    console.error('ERROR: Azure AI is not configured');
    process.exit(1);
  }

  // The 6-character id in event URLs is not unique, so refuse to guess
  const matches = await db
    .select()
    .from(events)
    .where(sql`${events.id}::text LIKE ${idPrefix + '%'}`);
  if (matches.length === 0) {
    console.error(`ERROR: No event found with ID starting with: ${idPrefix}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`ERROR: ${matches.length} events start with ${idPrefix}; use a longer prefix:`);
    for (const m of matches) console.error(`  ${m.id}  ${m.title}`);
    process.exit(1);
  }
  const event = matches[0];

  console.log('Stored Event:');
  console.log(`  ID: ${event.id}`);
  console.log(`  Title: ${event.title}`);
  console.log(`  Source: ${event.source}`);
  console.log(
    `  Date: ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
  );
  console.log(`  Location: ${event.location || 'N/A'}`);
  console.log(`  Price: ${event.price || 'Unknown'}`);
  console.log(`  Description: ${event.description?.length ?? 0} chars`);
  console.log(`  URL: ${event.url}`);

  const result = await verifyEvent(event);

  console.log('\nVerification Result:');
  console.log(`  Action: ${result.action.toUpperCase()}${result.error ? ' (error)' : ''}`);
  console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`  Reason: ${result.error ?? result.reason}`);
  for (const [field, value] of Object.entries(result.updates ?? {})) {
    console.log(`  Update ${field}: ${value.length > 200 ? `${value.slice(0, 200)}...` : value}`);
  }

  if (shouldUpdate) {
    const outcome = await applyVerification(event, result, new Date(), { allowDead: true });
    console.log(`\nApplied: ${outcome.outcome} - ${outcome.reason}`);
  } else if (result.action !== 'keep') {
    console.log(`\nTo apply this, run: npx tsx scripts/verify-event.ts ${idPrefix} --update`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
