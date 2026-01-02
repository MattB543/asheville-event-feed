import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte, lte, and, asc, eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

async function exportEventsToMarkdown() {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  console.log('Fetching events for the next 30 days...');
  console.log(`From: ${now.toISOString()}`);
  console.log(`To: ${thirtyDaysFromNow.toISOString()}`);

  const eventList = await db
    .select({
      id: events.id,
      sourceId: events.sourceId,
      source: events.source,
      title: events.title,
      description: events.description,
      startDate: events.startDate,
      location: events.location,
      zip: events.zip,
      organizer: events.organizer,
      price: events.price,
      tags: events.tags,
      // Timestamps
      createdAt: events.createdAt,
      updatedAt: events.updatedAt,
      lastSeenAt: events.lastSeenAt,
      lastVerifiedAt: events.lastVerifiedAt,
      // Moderation
      hidden: events.hidden,
      // Engagement
      interestedCount: events.interestedCount,
      goingCount: events.goingCount,
      favoriteCount: events.favoriteCount,
      // Recurring
      timeUnknown: events.timeUnknown,
      recurringType: events.recurringType,
      recurringEndDate: events.recurringEndDate,
      // AI fields
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
        lte(events.startDate, thirtyDaysFromNow),
        eq(events.hidden, false)
      )
    )
    .orderBy(asc(events.startDate));

  console.log(`Found ${eventList.length} events`);

  // Build markdown
  const lines: string[] = [];
  lines.push('# Asheville Events Export - Next 30 Days');
  lines.push('');
  lines.push(`*Generated: ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET*`);
  lines.push(`*Date Range: ${now.toLocaleDateString()} - ${thirtyDaysFromNow.toLocaleDateString()}*`);
  lines.push(`*Total Events: ${eventList.length}*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const event of eventList) {
    // Title
    lines.push(`## ${event.title}`);
    lines.push('');

    // Date & Time
    const dateStr = event.startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York',
    });
    if (event.timeUnknown) {
      lines.push(`**Date:** ${dateStr} *(time not specified)*`);
    } else {
      const timeStr = event.startDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      });
      lines.push(`**Date:** ${dateStr} at ${timeStr}`);
    }
    lines.push('');

    // Location & Zip
    if (event.location) {
      const locationLine = event.zip ? `${event.location} (${event.zip})` : event.location;
      lines.push(`**Location:** ${locationLine}`);
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

    // Source & ID
    lines.push(`**Source:** ${event.source} (ID: ${event.sourceId})`);
    lines.push('');

    // Tags
    if (event.tags && event.tags.length > 0) {
      lines.push(`**Tags:** ${event.tags.join(', ')}`);
      lines.push('');
    }

    // Recurring info
    if (event.recurringType) {
      const endStr = event.recurringEndDate
        ? ` until ${event.recurringEndDate.toLocaleDateString('en-US', { timeZone: 'America/New_York' })}`
        : '';
      lines.push(`**Recurring:** ${event.recurringType}${endStr}`);
      lines.push('');
    }

    // Engagement metrics
    const engagement: string[] = [];
    if (event.interestedCount !== null && event.interestedCount > 0) {
      engagement.push(`${event.interestedCount} interested`);
    }
    if (event.goingCount !== null && event.goingCount > 0) {
      engagement.push(`${event.goingCount} going`);
    }
    if (event.favoriteCount !== null && event.favoriteCount > 0) {
      engagement.push(`${event.favoriteCount} favorited`);
    }
    if (engagement.length > 0) {
      lines.push(`**Engagement:** ${engagement.join(', ')}`);
      lines.push('');
    }

    // Score section
    if (event.score !== null) {
      lines.push('### Score');
      lines.push('');
      lines.push(`- **Total:** ${event.score}/30`);
      lines.push(`- **Rarity:** ${event.scoreRarity ?? '-'}/10`);
      lines.push(`- **Uniqueness:** ${event.scoreUnique ?? '-'}/10`);
      lines.push(`- **Magnitude:** ${event.scoreMagnitude ?? '-'}/10`);
      if (event.scoreReason) {
        lines.push(`- **Reasoning:** ${event.scoreReason}`);
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

    // Metadata section
    lines.push('<details>');
    lines.push('<summary>Metadata</summary>');
    lines.push('');
    lines.push(`- **Event ID:** ${event.id}`);
    if (event.createdAt) {
      lines.push(`- **Created:** ${event.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    }
    if (event.updatedAt) {
      lines.push(`- **Updated:** ${event.updatedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    }
    if (event.lastSeenAt) {
      lines.push(`- **Last Seen:** ${event.lastSeenAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    }
    if (event.lastVerifiedAt) {
      lines.push(`- **Last Verified:** ${event.lastVerifiedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');

    lines.push('---');
    lines.push('');
  }

  const markdown = lines.join('\n');
  const outputPath = 'scripts/events-export.md';
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`\nExported to ${outputPath}`);
  console.log(`File size: ${(Buffer.byteLength(markdown, 'utf-8') / 1024 / 1024).toFixed(2)} MB`);
}

exportEventsToMarkdown()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
