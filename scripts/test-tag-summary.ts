/**
 * Test script for combined tag + summary generation.
 *
 * Usage: npx tsx scripts/test-tag-summary.ts
 */

import 'dotenv/config';
import { generateTagsAndSummary } from '../lib/ai/tagAndSummarize';

async function main() {
  console.log('Testing combined tag + summary generation...\n');

  const testEvents = [
    {
      title: 'Billy Strings Live at Asheville Music Hall',
      description: 'Grammy-winning bluegrass artist Billy Strings brings his incredible guitar skills and high-energy performances to Asheville for a special two-night run. Known for his virtuosic flatpicking and genre-bending style that incorporates elements of rock, metal, and jam band music into traditional bluegrass.',
      location: 'Asheville Music Hall, Asheville, NC',
      organizer: 'Asheville Music Hall',
      startDate: new Date('2025-02-15T20:00:00'),
    },
    {
      title: 'Weekly Trivia Night',
      description: 'Test your knowledge at our weekly trivia night! Teams of up to 6 players compete for prizes. Free to play, food and drink specials available.',
      location: 'Twin Leaf Brewery',
      organizer: 'Twin Leaf Brewery',
      startDate: new Date('2025-01-08T19:00:00'),
    },
    {
      title: 'Doom Metal Yoga',
      description: 'A unique yoga experience combining slow, heavy doom metal music with restorative yoga poses. No experience necessary. Bring your own mat.',
      location: 'The Mothlight',
      organizer: 'Asheville Weird Wellness',
      startDate: new Date('2025-01-12T10:00:00'),
    },
  ];

  for (const event of testEvents) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${event.title}`);
    console.log('='.repeat(60));

    try {
      const result = await generateTagsAndSummary(event);

      console.log('\nResult:');
      console.log('Tags:', result.tags.join(', '));
      console.log('Summary:', result.summary);
    } catch (error) {
      console.error('Error:', error);
    }

    // Delay between tests
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n\nDone!');
}

main().catch(console.error);
