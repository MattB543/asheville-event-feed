import { db } from '../../lib/db';
import { events } from '../../lib/db/schema';
import { matchesDefaultFilter } from '../../lib/config/defaultFilters';
import { writeFileSync } from 'fs';

async function main() {
  const allEvents = await db.select().from(events);

  const filtered = allEvents.filter((event) => {
    const textToCheck = `${event.title} ${event.description || ''} ${event.organizer || ''}`;
    return matchesDefaultFilter(textToCheck);
  });

  // Sort by start date
  filtered.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  let md = '# Events Filtered by Default Filter\n\n';
  md += `Total filtered: ${filtered.length} out of ${allEvents.length} events\n\n`;

  for (const event of filtered) {
    md += '---\n\n';
    md += `## ${event.title}\n\n`;
    md += `| Field | Value |\n`;
    md += `|-------|-------|\n`;
    md += `| **ID** | ${event.id} |\n`;
    md += `| **Source** | ${event.source} |\n`;
    md += `| **Source ID** | ${event.sourceId} |\n`;
    md += `| **Date/Time** | ${new Date(event.startDate).toLocaleString()} |\n`;
    md += `| **Time Unknown** | ${event.timeUnknown ? 'Yes' : 'No'} |\n`;
    md += `| **Location** | ${event.location || 'N/A'} |\n`;
    md += `| **Zip** | ${event.zip || 'N/A'} |\n`;
    md += `| **Organizer** | ${event.organizer || 'N/A'} |\n`;
    md += `| **Price** | ${event.price || 'N/A'} |\n`;
    md += `| **Tags** | ${event.tags?.join(', ') || 'N/A'} |\n`;
    md += `| **Interested Count** | ${event.interestedCount ?? 'N/A'} |\n`;
    md += `| **Going Count** | ${event.goingCount ?? 'N/A'} |\n`;
    md += `| **Favorite Count** | ${event.favoriteCount ?? 0} |\n`;
    md += `| **Recurring Type** | ${event.recurringType || 'N/A'} |\n`;
    md += `| **Recurring End Date** | ${event.recurringEndDate ? new Date(event.recurringEndDate).toLocaleString() : 'N/A'} |\n`;
    md += `| **Hidden** | ${event.hidden ? 'Yes' : 'No'} |\n`;
    md += `| **Created At** | ${event.createdAt ? new Date(event.createdAt).toLocaleString() : 'N/A'} |\n`;
    md += `| **URL** | ${event.url} |\n`;
    md += `| **Image URL** | ${event.imageUrl ? (event.imageUrl.startsWith('data:') ? '[Base64 Data]' : event.imageUrl) : 'N/A'} |\n`;
    md += `\n**Description:**\n\n${event.description || 'N/A'}\n\n`;
  }

  writeFileSync('filtered-events.md', md);
  console.log(`Wrote ${filtered.length} filtered events to filtered-events.md`);
}

main();
