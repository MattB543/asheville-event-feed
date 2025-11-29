import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('claude/scraping-results/harrahs-raw.json', 'utf-8'));

console.log('Total events:', data.length);

console.log('\nSource breakdown:');
const tmEvents = data.filter((e: any) => e.sourceId.startsWith('tm-'));
const htmlEvents = data.filter((e: any) => e.sourceId.startsWith('harrahs-'));
console.log('  Ticketmaster:', tmEvents.length);
console.log('  HTML:', htmlEvents.length);

console.log('\nData completeness:');
console.log('  With description:', data.filter((e: any) => e.description).length);
console.log('  With image:', data.filter((e: any) => e.imageUrl).length);
console.log('  With price (not Unknown):', data.filter((e: any) => e.price !== 'Unknown').length);

console.log('\nDate range:');
const dates = data.map((e: any) => new Date(e.startDate)).sort((a: Date, b: Date) => a.getTime() - b.getTime());
console.log('  First event:', dates[0].toLocaleDateString());
console.log('  Last event:', dates[dates.length-1].toLocaleDateString());
console.log('  Span:', Math.round((dates[dates.length-1].getTime() - dates[0].getTime()) / (1000*60*60*24)), 'days');

console.log('\nSample event structures:');
console.log('\n--- Ticketmaster Event ---');
console.log(JSON.stringify(tmEvents[0], null, 2));
console.log('\n--- HTML Event ---');
console.log(JSON.stringify(htmlEvents[0], null, 2));
