import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte, asc } from 'drizzle-orm';
import * as fs from 'fs';

function formatEventsForAI(eventsData: typeof events.$inferSelect[]): string {
  return eventsData.map((event) => {
    const date = new Date(event.startDate).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
    const tags = event.tags?.length ? event.tags.join(', ') : '';
    const desc = event.description || '';

    const lines = [
      event.title,
      `When: ${date}`,
      event.location ? `Where: ${event.location}` : null,
      event.price ? `Price: ${event.price}` : null,
      event.organizer ? `Host: ${event.organizer}` : null,
      tags ? `Tags: ${tags}` : null,
      desc ? `Description: ${desc}` : null,
    ].filter(Boolean);

    return lines.join('\n');
  }).join('\n---\n');
}

async function main() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const allEvents = await db
    .select()
    .from(events)
    .where(gte(events.startDate, startOfToday))
    .orderBy(asc(events.startDate));

  const markdown = formatEventsForAI(allEvents);

  console.log('=== STATS ===');
  console.log('Events:', allEvents.length);
  console.log('Characters:', markdown.length.toLocaleString());
  console.log('Estimated tokens (~4 chars/token):', Math.round(markdown.length / 4).toLocaleString());
  console.log('');

  // Write to file for inspection
  fs.writeFileSync('claude/all-events-markdown.txt', markdown);
  console.log('Full markdown written to: claude/all-events-markdown.txt');
}

main().then(() => process.exit(0));
