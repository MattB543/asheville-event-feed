/**
 * Test script for event scoring.
 *
 * Usage: npx tsx scripts/ai/test-scoring.ts
 */

import 'dotenv/config';
import { generateEventScore, getRecurringEventScore } from '../../lib/ai/scoring';

async function main() {
  console.log('Testing event scoring...\n');

  // Test recurring event scores
  console.log('Recurring event scores:');
  console.log('Daily:', getRecurringEventScore('daily'));
  console.log('Weekly:', getRecurringEventScore('weekly'));

  // Test AI scoring
  const testEvents = [
    {
      event: {
        id: 'test-1',
        title: 'Bob Dylan: Rough And Rowdy Ways Tour',
        description: 'Living legend Bob Dylan performs in Asheville as part of his Rough And Rowdy Ways world tour. Phone-free show - all phones will be locked in Yondr pouches.',
        location: 'Harrahs Cherokee Center',
        organizer: 'Live Nation',
        tags: ['Live Music', 'Nightlife'],
        aiSummary: 'Legendary musician Bob Dylan performs at Harrahs Cherokee Center as part of his Rough And Rowdy Ways Tour, featuring a phone-free concert experience.',
        startDate: new Date('2025-03-15T20:00:00'),
        price: '$150+',
      },
      similarEvents: [], // No similar events - unique
    },
    {
      event: {
        id: 'test-2',
        title: 'Weekly Trivia Night',
        description: 'Test your knowledge at our weekly trivia night! Teams compete for prizes.',
        location: 'Twin Leaf Brewery',
        organizer: 'Twin Leaf Brewery',
        tags: ['Trivia', 'Beer', 'Nightlife'],
        aiSummary: 'Weekly pub trivia competition at Twin Leaf Brewery with team play and prizes.',
        startDate: new Date('2025-01-08T19:00:00'),
        price: 'Free',
      },
      similarEvents: [
        { title: 'Trivia Tuesday', location: 'Archetype Brewing', organizer: 'Archetype Brewing', startDate: new Date('2025-01-07T19:00:00'), similarity: 0.85 },
        { title: 'Wednesday Trivia', location: 'Highland Brewing', organizer: 'Highland Brewing', startDate: new Date('2025-01-08T18:30:00'), similarity: 0.82 },
        { title: 'Pub Quiz Night', location: 'Wicked Weed', organizer: 'Wicked Weed', startDate: new Date('2025-01-09T19:00:00'), similarity: 0.78 },
      ],
    },
    {
      event: {
        id: 'test-3',
        title: 'Doom Metal Yoga',
        description: 'A unique yoga experience combining slow, heavy doom metal music with restorative yoga poses.',
        location: 'The Mothlight',
        organizer: 'Asheville Weird Wellness',
        tags: ['Fitness', 'Live Music', 'Wellness'],
        aiSummary: 'Unique yoga class at The Mothlight combining restorative poses with doom metal music for a meditative yet heavy experience.',
        startDate: new Date('2025-01-12T10:00:00'),
        price: '$20',
      },
      similarEvents: [
        { title: 'Morning Yoga Flow', location: 'Asheville Yoga Center', organizer: 'AYC', startDate: new Date('2025-01-12T09:00:00'), similarity: 0.45 },
      ],
    },
  ];

  for (const { event, similarEvents } of testEvents) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${event.title}`);
    console.log(`Similar events: ${similarEvents.length}`);
    console.log('='.repeat(60));

    try {
      const result = await generateEventScore(event, similarEvents);

      if (result) {
        console.log('\nResult:');
        console.log(`  Total Score: ${result.score}/30`);
        console.log(`  Rarity: ${result.rarity}/10`);
        console.log(`  Unique: ${result.unique}/10`);
        console.log(`  Magnitude: ${result.magnitude}/10`);
        console.log(`  Reason: ${result.reason}`);
      } else {
        console.log('No result returned');
      }
    } catch (error) {
      console.error('Error:', error);
    }

    // Delay between tests
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n\nDone!');
}

main().catch(console.error);
