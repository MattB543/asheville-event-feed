import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte, desc, isNotNull, and } from 'drizzle-orm';
import { writeFileSync } from 'fs';

async function exportTopScoredEvents() {
  const now = new Date();

  console.log('Fetching top 50 scored events...');

  const eventList = await db
    .select({
      title: events.title,
      startDate: events.startDate,
      location: events.location,
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
    })
    .from(events)
    .where(
      and(
        gte(events.startDate, now),
        isNotNull(events.score)
      )
    )
    .orderBy(desc(events.score), events.startDate)
    .limit(50);

  console.log(`Found ${eventList.length} scored events`);

  // Build markdown
  const lines: string[] = [];
  lines.push('# Top 50 Scored Events');
  lines.push('');
  lines.push(`*Generated: ${now.toISOString()}*`);
  lines.push('');
  lines.push('Events ranked by AI quality score (0-30 total = Rarity + Unique + Magnitude)');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (let i = 0; i < eventList.length; i++) {
    const event = eventList[i];
    const rank = i + 1;

    // Title with rank
    lines.push(`## ${rank}. ${event.title}`);
    lines.push('');

    // Score prominently
    lines.push(`**SCORE: ${event.score}/30** (Rarity: ${event.scoreRarity}, Unique: ${event.scoreUnique}, Magnitude: ${event.scoreMagnitude})`);
    lines.push('');

    // Score reason
    if (event.scoreReason) {
      lines.push(`> ${event.scoreReason}`);
      lines.push('');
    }

    // Date
    const dateStr = event.startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const timeStr = event.startDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    lines.push(`**Date:** ${dateStr} at ${timeStr}`);
    lines.push('');

    // Location
    if (event.location) {
      lines.push(`**Location:** ${event.location}`);
      lines.push('');
    }

    // Organizer
    if (event.organizer) {
      lines.push(`**Organizer:** ${event.organizer}`);
      lines.push('');
    }

    // Price
    if (event.price) {
      lines.push(`**Price:** ${event.price}`);
      lines.push('');
    }

    // Source
    lines.push(`**Source:** ${event.source}`);
    lines.push('');

    // Tags
    if (event.tags && event.tags.length > 0) {
      lines.push(`**Tags:** ${event.tags.join(', ')}`);
      lines.push('');
    }

    // AI Summary
    if (event.aiSummary) {
      lines.push(`**AI Summary:** ${event.aiSummary}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  const markdown = lines.join('\n');
  const outputPath = 'scripts/top-50-scored-events.md';
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`Exported to ${outputPath}`);

  // Also print a quick summary
  console.log('\n=== TOP 10 SUMMARY ===\n');
  for (let i = 0; i < Math.min(10, eventList.length); i++) {
    const e = eventList[i];
    console.log(`${i + 1}. [${e.score}/30] ${e.title}`);
    console.log(`   ${e.startDate.toLocaleDateString()} | ${e.location || 'Unknown'}`);
    console.log(`   Reason: ${e.scoreReason?.slice(0, 80)}...`);
    console.log('');
  }
}

exportTopScoredEvents()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
