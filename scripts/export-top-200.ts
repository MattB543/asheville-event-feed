import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte, lte, and, desc, isNotNull, eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

async function exportTopScoredEvents() {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  console.log('Fetching top 200 scored events in next 30 days...');
  console.log(`From: ${now.toISOString()}`);
  console.log(`To: ${thirtyDaysFromNow.toISOString()}`);

  const eventList = await db
    .select({
      title: events.title,
      startDate: events.startDate,
      location: events.location,
      zip: events.zip,
      organizer: events.organizer,
      price: events.price,
      source: events.source,
      tags: events.tags,
      aiSummary: events.aiSummary,
      score: events.score,
      scoreRarity: events.scoreRarity,
      scoreUnique: events.scoreUnique,
      scoreMagnitude: events.scoreMagnitude,
      scoreReason: events.scoreReason,
      url: events.url,
      interestedCount: events.interestedCount,
      goingCount: events.goingCount,
    })
    .from(events)
    .where(
      and(
        gte(events.startDate, now),
        lte(events.startDate, thirtyDaysFromNow),
        isNotNull(events.score),
        eq(events.hidden, false)
      )
    )
    .orderBy(desc(events.score), events.startDate)
    .limit(200);

  console.log(`Found ${eventList.length} scored events`);

  const lines: string[] = [];
  lines.push('# Top 200 Scored Events - Next 30 Days');
  lines.push('');
  lines.push(`*Generated: ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET*`);
  lines.push(
    `*Date Range: ${now.toLocaleDateString()} - ${thirtyDaysFromNow.toLocaleDateString()}*`
  );
  lines.push('');
  lines.push('Events ranked by AI quality score (0-30 total = Rarity + Unique + Magnitude)');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (let i = 0; i < eventList.length; i++) {
    const event = eventList[i];
    const rank = i + 1;

    lines.push(`## ${rank}. ${event.title}`);
    lines.push('');
    lines.push(
      `**SCORE: ${event.score}/30** (Rarity: ${event.scoreRarity}, Unique: ${event.scoreUnique}, Magnitude: ${event.scoreMagnitude})`
    );
    lines.push('');

    if (event.scoreReason) {
      lines.push(`> ${event.scoreReason}`);
      lines.push('');
    }

    const dateStr = event.startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York',
    });
    const timeStr = event.startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
    lines.push(`**Date:** ${dateStr} at ${timeStr}`);
    lines.push('');

    if (event.location) {
      const locationLine = event.zip ? `${event.location} (${event.zip})` : event.location;
      lines.push(`**Location:** ${locationLine}`);
      lines.push('');
    }

    if (event.organizer) {
      lines.push(`**Organizer:** ${event.organizer}`);
      lines.push('');
    }

    if (event.price) {
      lines.push(`**Price:** ${event.price}`);
      lines.push('');
    }

    lines.push(`**Source:** ${event.source}`);
    lines.push('');

    if (event.tags && event.tags.length > 0) {
      lines.push(`**Tags:** ${event.tags.join(', ')}`);
      lines.push('');
    }

    const engagement: string[] = [];
    if (event.interestedCount && event.interestedCount > 0) {
      engagement.push(`${event.interestedCount} interested`);
    }
    if (event.goingCount && event.goingCount > 0) {
      engagement.push(`${event.goingCount} going`);
    }
    if (engagement.length > 0) {
      lines.push(`**Engagement:** ${engagement.join(', ')}`);
      lines.push('');
    }

    if (event.aiSummary) {
      lines.push(`**AI Summary:** ${event.aiSummary}`);
      lines.push('');
    }

    if (event.url) {
      lines.push(`**Link:** ${event.url}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  const markdown = lines.join('\n');
  const outputPath = 'top-200-scored-events.md';
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`\nExported to ${outputPath}`);
  console.log(`File size: ${(Buffer.byteLength(markdown, 'utf-8') / 1024).toFixed(1)} KB`);

  // Quick summary of top 10
  console.log('\n=== TOP 10 SUMMARY ===\n');
  for (let i = 0; i < Math.min(10, eventList.length); i++) {
    const e = eventList[i];
    console.log(`${i + 1}. [${e.score}/30] ${e.title}`);
    console.log(`   ${e.startDate.toLocaleDateString()} | ${e.location || 'Unknown'}`);
    console.log('');
  }
}

exportTopScoredEvents()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
