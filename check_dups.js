require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  
  const results = await sql`
    SELECT id, title, source, organizer, "startDate", price, url
    FROM events 
    ORDER BY "startDate" 
    LIMIT 460 OFFSET 1340
  `;
  
  console.log('Total events:', results.length);
  
  // Group by title + date
  const groups = {};
  for (const evt of results) {
    const key = evt.title.toLowerCase().trim() + '|' + new Date(evt.startDate).toISOString().substring(0, 16);
    if (!groups[key]) groups[key] = [];
    groups[key].push(evt);
  }
  
  // Find cross-source duplicates
  let count = 0;
  const dups = [];
  for (const [key, group] of Object.entries(groups)) {
    if (group.length > 1) {
      const sources = new Set(group.map(e => e.source));
      if (sources.size > 1) {
        count++;
        if (count <= 30) {
          dups.push({
            title: group[0].title,
            date: group[0].startDate,
            instances: group.map(e => ({
              id: e.id.substring(0, 8),
              source: e.source,
              organizer: e.organizer,
            }))
          });
        }
      }
    }
  }
  
  console.log('Cross-source duplicate groups:', count);
  console.log(JSON.stringify(dups, null, 2));
}

main().catch(console.error);
