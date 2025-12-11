import '../lib/config/env';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { like } from 'drizzle-orm';
import * as fs from 'fs';

async function main() {
  const outputFile = process.argv[2] || 'ai-image-events.md';

  console.log('Finding events with AI-generated images...\n');

  // Find events where imageUrl starts with "data:" (base64 data URLs from AI generation)
  const eventsWithAIImages = await db
    .select()
    .from(events)
    .where(like(events.imageUrl, 'data:%'))
    .orderBy(events.startDate);

  if (eventsWithAIImages.length === 0) {
    console.log('No events with AI-generated images found!');
    return;
  }

  console.log(`Found ${eventsWithAIImages.length} events with AI-generated images.\n`);

  // Group by organizer to help identify patterns
  const byOrganizer = new Map<string, typeof eventsWithAIImages>();
  for (const event of eventsWithAIImages) {
    const org = event.organizer || 'Unknown';
    if (!byOrganizer.has(org)) {
      byOrganizer.set(org, []);
    }
    byOrganizer.get(org)!.push(event);
  }

  // Build markdown content
  let markdown = `# Events with AI-Generated Images

Total: ${eventsWithAIImages.length} events

---

## Summary by Organizer/Venue

| Organizer | Count |
|-----------|-------|
${Array.from(byOrganizer.entries())
  .sort((a, b) => b[1].length - a[1].length)
  .map(([org, evts]) => `| ${org} | ${evts.length} |`)
  .join('\n')}

---

## All Events

`;

  for (const event of eventsWithAIImages) {
    const startDate = new Date(event.startDate);
    const formattedDate = startDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const formattedTime = event.timeUnknown
      ? 'Time TBD'
      : startDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        });

    markdown += `### ${event.title}

- **Date:** ${formattedDate} @ ${formattedTime}
- **Location:** ${event.location || 'TBD'}
- **Organizer:** ${event.organizer || 'Unknown'}
- **Price:** ${event.price || 'Unknown'}
- **Source:** ${event.source}
- **Tags:** ${event.tags?.join(', ') || 'None'}
- **URL:** ${event.url}

---

`;
  }

  fs.writeFileSync(outputFile, markdown);
  console.log(`Done! Exported to ${outputFile}`);
}

main().catch(console.error);
