import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import { writeFileSync } from 'fs';

async function exportEventsToMarkdown() {
  const now = new Date();

  console.log('Fetching next 2000 events...');

  const eventList = await db
    .select({
      title: events.title,
      description: events.description,
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
    .where(gte(events.startDate, now))
    .orderBy(asc(events.startDate))
    .limit(2000);

  console.log(`Found ${eventList.length} events`);

  // Build markdown
  const lines: string[] = [];
  lines.push('# Asheville Events Export');
  lines.push('');
  lines.push(`*Generated: ${now.toISOString()}*`);
  lines.push(`*Total Events: ${eventList.length}*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const event of eventList) {
    // Title
    lines.push(`## ${event.title}`);
    lines.push('');

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

    // Score
    if (event.score !== null) {
      lines.push(`**Score:** ${event.score}/30 (Rarity: ${event.scoreRarity ?? '-'}, Unique: ${event.scoreUnique ?? '-'}, Magnitude: ${event.scoreMagnitude ?? '-'})`);
      if (event.scoreReason) {
        lines.push(`**Score Reason:** ${event.scoreReason}`);
      }
      lines.push('');
    }

    // AI Summary
    if (event.aiSummary) {
      lines.push(`**AI Summary:** ${event.aiSummary}`);
      lines.push('');
    }

    // Description
    if (event.description) {
      lines.push('### Description');
      lines.push('');
      // Trim long descriptions
      const desc = event.description.length > 2000
        ? event.description.slice(0, 2000) + '...'
        : event.description;
      lines.push(desc);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  const markdown = lines.join('\n');
  const outputPath = 'scripts/events-export.md';
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`Exported to ${outputPath}`);
  console.log(`File size: ${(Buffer.byteLength(markdown, 'utf-8') / 1024 / 1024).toFixed(2)} MB`);
}

exportEventsToMarkdown()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
