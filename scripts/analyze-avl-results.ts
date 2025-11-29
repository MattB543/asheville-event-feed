import * as fs from 'fs';
import * as path from 'path';

// Read the saved results
const resultsPath = path.join(process.cwd(), 'claude', 'scraping-results', 'avltoday-raw.json');
const rawData = fs.readFileSync(resultsPath, 'utf-8');
const data = JSON.parse(rawData);

console.log('========================================');
console.log('AVL Today Scraper - Results Analysis');
console.log('========================================\n');

console.log('Metadata:');
console.log(`  Timestamp: ${data.metadata.timestamp}`);
console.log(`  Total Count: ${data.metadata.totalCount}`);
console.log(`  Duration: ${data.metadata.scrapeDuration}`);
console.log(`  Source: ${data.metadata.source}\n`);

// Analyze events
const events = data.events;

// Price distribution
const priceCategories = {
  free: 0,
  paid: 0,
  unknown: 0,
};

events.forEach((event: any) => {
  if (event.price === 'Free') priceCategories.free++;
  else if (event.price === 'Unknown') priceCategories.unknown++;
  else priceCategories.paid++;
});

console.log('Price Distribution:');
console.log(`  Free: ${priceCategories.free} (${((priceCategories.free / events.length) * 100).toFixed(1)}%)`);
console.log(`  Paid: ${priceCategories.paid} (${((priceCategories.paid / events.length) * 100).toFixed(1)}%)`);
console.log(`  Unknown: ${priceCategories.unknown} (${((priceCategories.unknown / events.length) * 100).toFixed(1)}%)\n`);

// Organizer distribution (top 10)
const organizerCounts = new Map<string, number>();
events.forEach((event: any) => {
  const org = event.organizer || 'Unknown';
  organizerCounts.set(org, (organizerCounts.get(org) || 0) + 1);
});

const topOrganizers = Array.from(organizerCounts.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log('Top 10 Organizers:');
topOrganizers.forEach(([org, count]) => {
  console.log(`  ${count.toString().padStart(3)} - ${org}`);
});

// Show diverse sample of events
console.log('\n========================================');
console.log('Sample Events (Diverse Selection):');
console.log('========================================\n');

// Get events at different intervals to show diversity
const sampleIndices = [0, 50, 100, 150, 200, 250, 299];

sampleIndices.forEach((idx, i) => {
  const event = events[idx];
  console.log(`${i + 1}. ${event.title}`);
  console.log(`   Organizer: ${event.organizer}`);
  console.log(`   Price: ${event.price}`);
  console.log(`   Location: ${event.location}`);
  console.log(`   Date: ${new Date(event.startDate).toLocaleDateString()}`);
  console.log(`   URL: ${event.url.substring(0, 60)}${event.url.length > 60 ? '...' : ''}`);
  console.log('');
});

// Check for events with images
const eventsWithImages = events.filter((e: any) => e.imageUrl && e.imageUrl.trim().length > 0);
console.log(`Events with images: ${eventsWithImages.length} (${((eventsWithImages.length / events.length) * 100).toFixed(1)}%)\n`);

// Location analysis
const locationCounts = new Map<string, number>();
events.forEach((event: any) => {
  const loc = event.location || 'Unknown';
  locationCounts.set(loc, (locationCounts.get(loc) || 0) + 1);
});

const topLocations = Array.from(locationCounts.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log('Top 10 Locations:');
topLocations.forEach(([loc, count]) => {
  console.log(`  ${count.toString().padStart(3)} - ${loc}`);
});

console.log('\n========================================');
