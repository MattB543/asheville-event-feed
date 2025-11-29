/**
 * Verify Orange Peel events in database
 *
 * Checks that all events are properly stored and data is clean.
 *
 * Usage: npx tsx scripts/verify-orangepeel.ts
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { eq, desc, and, isNull } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(70));
  console.log('Verifying Orange Peel Events in Database');
  console.log('='.repeat(70));
  console.log();

  // Get all Orange Peel events
  const orangePeelEvents = await db
    .select()
    .from(events)
    .where(eq(events.source, 'ORANGE_PEEL'))
    .orderBy(events.startDate);

  console.log(`Total Orange Peel events in database: ${orangePeelEvents.length}`);
  console.log();

  // Stats
  const stats = {
    total: orangePeelEvents.length,
    fromTM: orangePeelEvents.filter(e => e.sourceId.startsWith('tm-')).length,
    fromWeb: orangePeelEvents.filter(e => e.sourceId.startsWith('op-web-')).length,
    withImage: orangePeelEvents.filter(e => e.imageUrl).length,
    withDescription: orangePeelEvents.filter(e => e.description).length,
    withTags: orangePeelEvents.filter(e => e.tags && e.tags.length > 0).length,
    withPrice: orangePeelEvents.filter(e => e.price && e.price !== 'Unknown').length,
    atPulp: orangePeelEvents.filter(e => e.location === 'Pulp').length,
    hidden: orangePeelEvents.filter(e => e.hidden).length,
  };

  console.log('Statistics:');
  console.log(`  - From Ticketmaster: ${stats.fromTM}`);
  console.log(`  - From Website: ${stats.fromWeb}`);
  console.log(`  - At Pulp venue: ${stats.atPulp}`);
  console.log(`  - With image: ${stats.withImage} (${Math.round(stats.withImage/stats.total*100)}%)`);
  console.log(`  - With description: ${stats.withDescription} (${Math.round(stats.withDescription/stats.total*100)}%)`);
  console.log(`  - With tags: ${stats.withTags} (${Math.round(stats.withTags/stats.total*100)}%)`);
  console.log(`  - With price: ${stats.withPrice} (${Math.round(stats.withPrice/stats.total*100)}%)`);
  console.log(`  - Hidden: ${stats.hidden}`);
  console.log();

  // Data quality checks
  console.log('='.repeat(70));
  console.log('DATA QUALITY CHECKS');
  console.log('='.repeat(70));
  console.log();

  // Check for missing required fields
  const missingTitle = orangePeelEvents.filter(e => !e.title);
  const missingUrl = orangePeelEvents.filter(e => !e.url);
  const missingDate = orangePeelEvents.filter(e => !e.startDate);
  const missingSourceId = orangePeelEvents.filter(e => !e.sourceId);

  console.log('Required fields check:');
  console.log(`  - Missing title: ${missingTitle.length}`);
  console.log(`  - Missing URL: ${missingUrl.length}`);
  console.log(`  - Missing date: ${missingDate.length}`);
  console.log(`  - Missing sourceId: ${missingSourceId.length}`);

  if (missingTitle.length + missingUrl.length + missingDate.length + missingSourceId.length === 0) {
    console.log('  All required fields present');
  }
  console.log();

  // Check for duplicates
  const urlCounts = new Map<string, number>();
  for (const event of orangePeelEvents) {
    urlCounts.set(event.url, (urlCounts.get(event.url) || 0) + 1);
  }
  const duplicateUrls = [...urlCounts.entries()].filter(([_, count]) => count > 1);

  console.log('Duplicate check:');
  if (duplicateUrls.length === 0) {
    console.log('  No duplicate URLs found');
  } else {
    console.log(`  Found ${duplicateUrls.length} duplicate URLs:`);
    for (const [url, count] of duplicateUrls) {
      console.log(`    ${url.slice(0, 60)}... (${count} times)`);
    }
  }
  console.log();

  // Check for valid dates (should be in the future or recent past)
  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const twoYearsFromNow = new Date(now.getTime() + 730 * 24 * 60 * 60 * 1000);

  const oldEvents = orangePeelEvents.filter(e => e.startDate < sixMonthsAgo);
  const farFutureEvents = orangePeelEvents.filter(e => e.startDate > twoYearsFromNow);

  console.log('Date sanity check:');
  console.log(`  - Events before ${sixMonthsAgo.toLocaleDateString()}: ${oldEvents.length}`);
  console.log(`  - Events after ${twoYearsFromNow.toLocaleDateString()}: ${farFutureEvents.length}`);

  if (oldEvents.length > 0) {
    console.log('  Old events:');
    for (const e of oldEvents.slice(0, 5)) {
      console.log(`    - ${e.startDate.toLocaleDateString()}: ${e.title}`);
    }
  }
  console.log();

  // Tag analysis
  console.log('='.repeat(70));
  console.log('TAG ANALYSIS');
  console.log('='.repeat(70));
  console.log();

  const tagCounts = new Map<string, number>();
  for (const event of orangePeelEvents) {
    if (event.tags) {
      for (const tag of event.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Most common tags:');
  for (const [tag, count] of sortedTags.slice(0, 15)) {
    console.log(`  ${tag}: ${count}`);
  }
  console.log();

  // Sample events
  console.log('='.repeat(70));
  console.log('SAMPLE EVENTS (first 10)');
  console.log('='.repeat(70));

  for (const event of orangePeelEvents.slice(0, 10)) {
    const source = event.sourceId.startsWith('tm-') ? '[TM]' : '[WEB]';
    console.log();
    console.log(`${source} ${event.title}`);
    console.log(`  ID: ${event.id}`);
    console.log(`  Date: ${event.startDate.toLocaleDateString()} ${event.startDate.toLocaleTimeString()}`);
    console.log(`  Location: ${event.location}`);
    console.log(`  URL: ${event.url.slice(0, 60)}...`);
    console.log(`  Image: ${event.imageUrl ? 'Yes' : 'No'}`);
    console.log(`  Tags: ${event.tags?.join(', ') || 'None'}`);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('VERIFICATION COMPLETE');
  console.log('='.repeat(70));

  // Summary verdict
  const issues: string[] = [];
  if (missingTitle.length > 0) issues.push(`${missingTitle.length} events missing title`);
  if (missingUrl.length > 0) issues.push(`${missingUrl.length} events missing URL`);
  if (duplicateUrls.length > 0) issues.push(`${duplicateUrls.length} duplicate URLs`);
  if (stats.withImage < stats.total) issues.push(`${stats.total - stats.withImage} events missing images`);

  if (issues.length === 0) {
    console.log('\nDATA IS CLEAN - All checks passed!');
  } else {
    console.log('\nISSUES FOUND:');
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
  }
}

main().catch(console.error);
