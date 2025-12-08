import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Create a temporary TypeScript file
const script = `
import '../lib/config/env';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { asc } from 'drizzle-orm';
import { findDuplicates } from '../lib/utils/deduplication';

async function main() {
  const allEvents = await db
    .select({
      id: events.id,
      title: events.title,
      organizer: events.organizer,
      startDate: events.startDate,
      price: events.price,
      description: events.description,
      createdAt: events.createdAt,
      source: events.source,
    })
    .from(events)
    .orderBy(asc(events.startDate))
    .limit(460)
    .offset(440);

  const duplicateGroups = findDuplicates(allEvents);
  
  const result = duplicateGroups.map((group) => {
    const sources = new Set([group.keep.source, ...group.remove.map(r => r.source || 'UNKNOWN')]);
    const confidence = sources.size > 1 ? 'high' : 'medium';

    return {
      event_name: group.keep.title,
      confidence: confidence,
      instances: [
        {
          id: group.keep.id,
          source: group.keep.source || 'UNKNOWN',
          title: group.keep.title,
          keep: true,
          reason: 'Selected for retention (has price or longer description)',
        },
        ...group.remove.map((removed) => ({
          id: removed.id,
          source: removed.source || 'UNKNOWN',
          title: removed.title,
          keep: false,
          reason: 'Duplicate - marked for removal',
        })),
      ],
    };
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
`;

try {
  // Save and execute
  const tmpFile = '/tmp/query-duplicates.ts';
  fs.writeFileSync(tmpFile, script);
  const output = execSync('npx tsx ' + tmpFile, { encoding: 'utf-8', cwd: process.cwd() });
  console.log(output);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
