import '../lib/config/env';
import { generateEventImage } from '../lib/ai/imageGeneration';
import * as fs from 'fs';

const testEvents = [
  {
    title: "Live Jazz Night at The Orange Peel",
    description: "Join us for an evening of smooth jazz with local musicians. Great drinks and atmosphere in downtown Asheville.",
    location: "The Orange Peel, Asheville, NC",
    tags: ["Live Music", "Nightlife", "Beer"],
  },
  {
    title: "Sunday Morning Yoga in the Park",
    description: "Start your weekend right with a relaxing outdoor yoga session. All levels welcome.",
    location: "Pack Square Park, Asheville, NC",
    tags: ["Fitness", "Wellness", "Outdoors"],
  },
  {
    title: "Craft Beer Tasting & Trivia",
    description: "Sample local brews while testing your knowledge at our weekly trivia night.",
    location: "Burial Beer Co, Asheville, NC",
    tags: ["Beer", "Trivia", "Nightlife"],
  },
];

async function testSingleEvent(event: typeof testEvents[0], index: number) {
  console.log(`\n--- Test ${index + 1}: ${event.title} ---`);
  console.log('Tags:', event.tags.join(', '));

  try {
    const imageUrl = await generateEventImage(event);

    if (imageUrl) {
      console.log('✓ Image generated successfully!');
      console.log(`  Data URL length: ${(imageUrl.length / 1024).toFixed(1)} KB`);

      // Extract base64 data and save to file for inspection
      const base64Data = imageUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = `test-image-${index + 1}.jpg`;
      fs.writeFileSync(filename, buffer);
      console.log(`  Saved to: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);
      return true;
    } else {
      console.log('✗ No image was generated.');
      return false;
    }
  } catch (error) {
    console.error('✗ Error:', error);
    return false;
  }
}

async function main() {
  console.log('Testing Gemini image generation...');
  console.log(`Running ${testEvents.length} tests...\n`);

  // Run just the first test for quick validation
  const quickTest = process.argv.includes('--quick');
  const eventsToTest = quickTest ? [testEvents[0]] : testEvents;

  let passed = 0;
  for (let i = 0; i < eventsToTest.length; i++) {
    const success = await testSingleEvent(eventsToTest[i], i);
    if (success) passed++;
    // Small delay between requests
    if (i < eventsToTest.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n=== Results: ${passed}/${eventsToTest.length} tests passed ===`);
}

main();
