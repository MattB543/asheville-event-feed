import 'dotenv/config';
import { and, isNotNull, lt } from 'drizzle-orm';
import { db } from '../lib/db';
import { matchingEnrichmentItems } from '../lib/db/schema';

function parseDaysArg(argv: string[]): number {
  const idx = argv.findIndex((arg) => arg === '--days');
  if (idx < 0 || idx + 1 >= argv.length) return 30;
  const parsed = Number(argv[idx + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid --days value. Must be a positive number.');
  }
  return Math.floor(parsed);
}

async function main() {
  const days = parseDaysArg(process.argv.slice(2));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`[Matching Cleanup] Nulling raw_payload older than ${days} days`);
  console.log(`[Matching Cleanup] Cutoff: ${cutoff.toISOString()}`);

  const updatedRows = await db
    .update(matchingEnrichmentItems)
    .set({
      rawPayload: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        lt(matchingEnrichmentItems.createdAt, cutoff),
        isNotNull(matchingEnrichmentItems.rawPayload)
      )
    )
    .returning({ id: matchingEnrichmentItems.id });

  console.log(`[Matching Cleanup] Updated rows: ${updatedRows.length}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('[Matching Cleanup] Fatal error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
