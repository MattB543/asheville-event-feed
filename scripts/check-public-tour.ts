import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { like } from 'drizzle-orm';
import { findDuplicates, getIdsToRemove } from '../lib/utils/deduplication';

async function check() {
  const results = await db.select()
    .from(events)
    .where(like(events.title, '%Public Tour:%'));

  console.log('Found', results.length, 'Public Tour events:\n');
  results.forEach(e => {
    console.log('ID:', e.id);
    console.log('Title:', e.title);
    console.log('Source:', e.source);
    console.log('Organizer:', e.organizer);
    console.log('Location:', e.location);
    console.log('StartDate:', e.startDate);
    console.log('URL:', e.url);
    console.log('---');
  });

  // Test deduplication logic on these events
  if (results.length >= 2) {
    console.log('\n=== Testing Deduplication Logic ===\n');

    const eventsForDedup = results.map(e => ({
      id: e.id,
      title: e.title,
      organizer: e.organizer,
      startDate: e.startDate,
      price: e.price,
      description: e.description,
      createdAt: e.createdAt,
    }));

    const duplicateGroups = findDuplicates(eventsForDedup);
    console.log('Duplicate groups found:', duplicateGroups.length);

    if (duplicateGroups.length === 0) {
      console.log('\nNo duplicates detected. Checking why...\n');

      // Manual comparison of first two events
      const e1 = results[0];
      const e2 = results[1];

      console.log('Event 1 organizer:', JSON.stringify(e1.organizer));
      console.log('Event 2 organizer:', JSON.stringify(e2.organizer));
      console.log('Organizers match:', e1.organizer === e2.organizer);

      console.log('\nEvent 1 startDate:', e1.startDate);
      console.log('Event 2 startDate:', e2.startDate);
      console.log('Times match:', e1.startDate.getTime() === e2.startDate.getTime());

      // Check time components
      console.log('\nEvent 1 time components:');
      console.log('  Year:', e1.startDate.getFullYear());
      console.log('  Month:', e1.startDate.getMonth());
      console.log('  Date:', e1.startDate.getDate());
      console.log('  Hours:', e1.startDate.getHours());
      console.log('  Minutes:', e1.startDate.getMinutes());

      console.log('\nEvent 2 time components:');
      console.log('  Year:', e2.startDate.getFullYear());
      console.log('  Month:', e2.startDate.getMonth());
      console.log('  Date:', e2.startDate.getDate());
      console.log('  Hours:', e2.startDate.getHours());
      console.log('  Minutes:', e2.startDate.getMinutes());

      // Check title words
      const extractWords = (title: string) => {
        const STOP_WORDS = new Set([
          'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
          'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        ]);
        return new Set(
          title
            .toLowerCase()
            .replace(/[^\w\s-]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length >= 3 && !STOP_WORDS.has(word))
        );
      };

      const words1 = extractWords(e1.title);
      const words2 = extractWords(e2.title);
      console.log('\nEvent 1 significant words:', [...words1]);
      console.log('Event 2 significant words:', [...words2]);

      const shared = [...words1].filter(w => words2.has(w));
      console.log('Shared words:', shared);
    } else {
      duplicateGroups.forEach((group, i) => {
        console.log(`Group ${i + 1}:`);
        console.log('  Keep:', group.keep.title);
        console.log('  Remove:', group.remove.map(e => e.title));
      });
    }
  }

  process.exit(0);
}

check().catch(console.error);
