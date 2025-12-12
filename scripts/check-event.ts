import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { like } from 'drizzle-orm';

async function main() {
  const search = process.argv[2] || 'Blind Wine';
  console.log(`Searching for events matching: "${search}"\n`);

  const results = await db
    .select()
    .from(events)
    .where(like(events.title, `%${search}%`));

  console.log(`Found ${results.length} events:\n`);

  for (const e of results) {
    console.log(`Title: ${e.title}`);
    console.log(`Source: ${e.source}`);
    console.log(`Start Date (stored UTC): ${e.startDate.toISOString()}`);
    console.log(`Start Date (displayed as ET): ${e.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    console.log(`URL: ${e.url}`);
    console.log();
  }

  process.exit(0);
}

main();
