/**
 * Migrate data from Neon to Supabase
 *
 * Usage:
 *   1. Export from Neon (with current DATABASE_URL):
 *      npx tsx scripts/maintenance/migrate-to-supabase.ts export
 *
 *   2. Update your .env with the new Supabase DATABASE_URL
 *
 *   3. Push schema to Supabase:
 *      npx drizzle-kit push
 *
 *   4. Import to Supabase:
 *      npx tsx scripts/maintenance/migrate-to-supabase.ts import
 */

import { neon } from '@neondatabase/serverless';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';
import { events, submittedEvents } from '../../lib/db/schema';
import { env } from '../../lib/config/env';

const EXPORT_FILE = path.join(process.cwd(), 'neon-export.json');

async function exportData() {
  console.log('Connecting to Neon database...');
  console.log(`URL: ${env.DATABASE_URL?.substring(0, 60)}...`);

  const sql = neon(env.DATABASE_URL);

  console.log('\nExporting events...');
  const allEvents = await sql`SELECT * FROM events`;
  console.log(`  Found ${allEvents.length} events`);

  console.log('Exporting submitted_events...');
  const allSubmitted = await sql`SELECT * FROM submitted_events`;
  console.log(`  Found ${allSubmitted.length} submitted events`);

  const exportedData = {
    exportedAt: new Date().toISOString(),
    events: allEvents,
    submittedEvents: allSubmitted,
  };

  fs.writeFileSync(EXPORT_FILE, JSON.stringify(exportedData, null, 2));
  console.log(`\nExported to: ${EXPORT_FILE}`);
  console.log(`File size: ${(fs.statSync(EXPORT_FILE).size / 1024 / 1024).toFixed(2)} MB`);

  console.log('\nDone! Next steps:');
  console.log('  1. Create your Supabase project at https://supabase.com');
  console.log('  2. Update your .env with the Supabase DATABASE_URL (Connection Pooler)');
  console.log('  3. Run: npx drizzle-kit push');
  console.log('  4. Run: npx tsx scripts/maintenance/migrate-to-supabase.ts import');
}

async function importData() {
  if (!fs.existsSync(EXPORT_FILE)) {
    console.error(`Export file not found: ${EXPORT_FILE}`);
    console.error('Run "npx tsx scripts/maintenance/migrate-to-supabase.ts export" first');
    process.exit(1);
  }

  console.log('Reading export file...');
  const data = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf-8'));
  console.log(`  Exported at: ${data.exportedAt}`);
  console.log(`  Events: ${data.events.length}`);
  console.log(`  Submitted events: ${data.submittedEvents.length}`);

  console.log('\nConnecting to database...');
  console.log(`URL: ${env.DATABASE_URL?.substring(0, 60)}...`);

  const client = postgres(env.DATABASE_URL, { prepare: false });
  const db = drizzlePostgres(client, { schema: { events, submittedEvents } });

  // Check if tables exist
  console.log('\nChecking tables...');
  try {
    const result = await client`SELECT COUNT(*) FROM events`;
    console.log(`  events table exists (${result[0].count} rows)`);
  } catch {
    console.error('\nError: events table does not exist. Run this first:');
    console.error('  npx drizzle-kit push');
    await client.end();
    process.exit(1);
  }

  // Import events in batches
  console.log('\nImporting events...');
  const BATCH_SIZE = 50;
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < data.events.length; i += BATCH_SIZE) {
    const batch = data.events.slice(i, i + BATCH_SIZE);

    for (const event of batch) {
      try {
        await db.insert(events).values({
          id: event.id,
          sourceId: event.source_id,
          source: event.source,
          title: event.title,
          description: event.description,
          startDate: new Date(event.start_date),
          location: event.location,
          zip: event.zip,
          organizer: event.organizer,
          price: event.price,
          url: event.url,
          imageUrl: event.image_url,
          createdAt: event.created_at ? new Date(event.created_at) : undefined,
          hidden: event.hidden,
          tags: event.tags,
          interestedCount: event.interested_count,
          goingCount: event.going_count,
          timeUnknown: event.time_unknown,
          recurringType: event.recurring_type,
          recurringEndDate: event.recurring_end_date ? new Date(event.recurring_end_date) : null,
          favoriteCount: event.favorite_count,
        }).onConflictDoNothing();
        imported++;
      } catch {
        skipped++;
      }
    }

    process.stdout.write(`  Progress: ${Math.min(i + BATCH_SIZE, data.events.length)}/${data.events.length} (imported: ${imported}, skipped: ${skipped})\r`);
  }
  console.log(`\n  Imported ${imported} events, skipped ${skipped}`);

  // Import submitted events
  if (data.submittedEvents.length > 0) {
    console.log('\nImporting submitted events...');
    let submittedImported = 0;
    let submittedSkipped = 0;

    for (const event of data.submittedEvents) {
      try {
        await db.insert(submittedEvents).values({
          id: event.id,
          title: event.title,
          description: event.description,
          startDate: new Date(event.start_date),
          endDate: event.end_date ? new Date(event.end_date) : null,
          location: event.location,
          organizer: event.organizer,
          price: event.price,
          url: event.url,
          imageUrl: event.image_url,
          submitterEmail: event.submitter_email,
          submitterName: event.submitter_name,
          notes: event.notes,
          status: event.status,
          reviewedAt: event.reviewed_at ? new Date(event.reviewed_at) : null,
          createdAt: event.created_at ? new Date(event.created_at) : undefined,
          source: event.source,
        }).onConflictDoNothing();
        submittedImported++;
      } catch {
        submittedSkipped++;
      }
    }
    console.log(`  Imported ${submittedImported} submitted events, skipped ${submittedSkipped}`);
  }

  await client.end();

  console.log('\nMigration complete!');
  console.log('You can verify with: npm run db:count');
  console.log('Then delete neon-export.json when ready');
}

async function main() {
  const command = process.argv[2];

  if (command === 'export') {
    await exportData();
  } else if (command === 'import') {
    await importData();
  } else {
    console.log('Neon to Supabase Migration Tool');
    console.log('================================');
    console.log('');
    console.log('Usage:');
    console.log('  npx tsx scripts/maintenance/migrate-to-supabase.ts export  - Export from Neon');
    console.log('  npx tsx scripts/maintenance/migrate-to-supabase.ts import  - Import to Supabase');
    console.log('');
    console.log('Steps:');
    console.log('  1. Run export (with Neon DATABASE_URL in .env)');
    console.log('  2. Create Supabase project');
    console.log('  3. Update .env with Supabase DATABASE_URL');
    console.log('  4. Run: npx drizzle-kit push');
    console.log('  5. Run import');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
