/**
 * Insert a custom event into the events table.
 *
 * Usage:
 *   npx tsx scripts/insert-event.ts <path-to-json>
 *   npx tsx scripts/insert-event.ts <path-to-json> --dry-run
 *
 * The JSON file should contain an object with event fields:
 *   - title (required)
 *   - startDate (required, ISO 8601 string)
 *   - url (required, unique identifier — used for upsert)
 *   - source (default: "MANUAL")
 *   - sourceId (default: generated from title)
 *   - description, location, zip, organizer, price, imageUrl, tags, timeUnknown
 *
 * Example JSON:
 *   {
 *     "title": "My Event",
 *     "startDate": "2026-04-18T21:00:00Z",
 *     "url": "https://example.com/my-event",
 *     "location": "Asheville, NC",
 *     "organizer": "Someone",
 *     "price": "Free",
 *     "tags": ["community", "social"]
 *   }
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';

interface EventInput {
  title: string;
  startDate: string;
  url: string;
  source?: string;
  sourceId?: string;
  description?: string;
  location?: string;
  zip?: string;
  organizer?: string;
  price?: string;
  imageUrl?: string;
  tags?: string[];
  timeUnknown?: boolean;
}

function generateSourceId(title: string): string {
  return (
    'manual-' +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
  );
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: npx tsx scripts/insert-event.ts <path-to-json> [--dry-run]');
    process.exit(1);
  }

  const fullPath = resolve(filePath);
  let raw: string;
  try {
    raw = readFileSync(fullPath, 'utf-8');
  } catch {
    console.error(`Could not read file: ${fullPath}`);
    process.exit(1);
  }

  let input: EventInput;
  try {
    input = JSON.parse(raw);
  } catch {
    console.error('File is not valid JSON.');
    process.exit(1);
  }

  // Validate required fields
  if (!input.title) {
    console.error('Missing required field: title');
    process.exit(1);
  }
  if (!input.startDate) {
    console.error('Missing required field: startDate');
    process.exit(1);
  }
  if (!input.url) {
    console.error('Missing required field: url');
    process.exit(1);
  }

  const startDate = new Date(input.startDate);
  if (isNaN(startDate.getTime())) {
    console.error(`Invalid date: ${input.startDate}`);
    process.exit(1);
  }

  const source = input.source || 'MANUAL';
  const sourceId = input.sourceId || generateSourceId(input.title);

  const row = {
    sourceId,
    source,
    title: input.title,
    description: input.description ?? null,
    startDate,
    location: input.location ?? null,
    zip: input.zip ?? null,
    organizer: input.organizer ?? null,
    price: input.price ?? null,
    url: input.url,
    imageUrl: input.imageUrl ?? null,
    tags: input.tags ?? [],
    timeUnknown: input.timeUnknown ?? false,
  };

  console.log('\nEvent to insert:');
  console.log(`  Title:     ${row.title}`);
  console.log(`  Date:      ${row.startDate.toISOString()}`);
  console.log(`  Location:  ${row.location || '(none)'}`);
  console.log(`  Organizer: ${row.organizer || '(none)'}`);
  console.log(`  Price:     ${row.price || '(none)'}`);
  console.log(`  Source:    ${row.source} / ${row.sourceId}`);
  console.log(`  URL:       ${row.url}`);
  console.log(`  Image:     ${row.imageUrl ? 'yes' : '(none)'}`);
  console.log(`  Tags:      ${row.tags.length ? row.tags.join(', ') : '(none)'}`);

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made.');
    process.exit(0);
  }

  const result = await db
    .insert(events)
    .values(row)
    .onConflictDoUpdate({
      target: events.url,
      set: {
        title: row.title,
        description: row.description,
        startDate: row.startDate,
        location: row.location,
        zip: row.zip,
        organizer: row.organizer,
        price: row.price,
        imageUrl: row.imageUrl,
        tags: row.tags,
        timeUnknown: row.timeUnknown,
        updatedAt: new Date(),
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: events.id, title: events.title });

  console.log(`\nInserted/updated event: ${result[0].id}`);
  console.log(`  "${result[0].title}"`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
