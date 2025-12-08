import { neon } from '@neondatabase/serverless';
import 'dotenv/config.js';

(async () => {
  try {
    const sql = neon(process.env.DATABASE_URL);
    
    const result = await sql`
      SELECT id, title, source, organizer, start_date, price
      FROM events
      ORDER BY start_date ASC
      LIMIT 460 OFFSET 440
    `;
    
    console.log('Total events retrieved:', result.length);
    
    // Group by date
    const eventsByDate = {};
    
    for (const event of result) {
      const dateKey = event.start_date.toISOString().split('T')[0];
      if (!eventsByDate[dateKey]) {
        eventsByDate[dateKey] = [];
      }
      eventsByDate[dateKey].push(event);
    }
    
    let potentialDuplicates = [];
    
    for (const date of Object.keys(eventsByDate).sort()) {
      const eventsOnDate = eventsByDate[date];
      
      if (eventsOnDate.length > 1) {
        console.log('Date: ' + date + ' (' + eventsOnDate.length + ' events)');
        
        for (let i = 0; i < eventsOnDate.length; i++) {
          const e1 = eventsOnDate[i];
          const titleShort = e1.title.substring(0, 70);
          console.log('  [' + e1.source + '] ' + titleShort);
          
          for (let j = i + 1; j < eventsOnDate.length; j++) {
            const e2 = eventsOnDate[j];
            
            const title1 = e1.title.toLowerCase();
            const title2 = e2.title.toLowerCase();
            
            const words1Arr = title1.split(/\W+/).filter(w => w.length > 3);
            const words2Arr = title2.split(/\W+/).filter(w => w.length > 3);
            const words1 = new Set(words1Arr);
            const words2 = new Set(words2Arr);
            
            let sharedCount = 0;
            for (const word of words1) {
              if (words2.has(word)) sharedCount++;
            }
            
            if (sharedCount >= 2 || (e1.organizer === e2.organizer && sharedCount >= 1)) {
              potentialDuplicates.push({
                date: date,
                shared_words: sharedCount,
                event1: {
                  id: e1.id,
                  source: e1.source,
                  title: e1.title,
                  organizer: e1.organizer
                },
                event2: {
                  id: e2.id,
                  source: e2.source,
                  title: e2.title,
                  organizer: e2.organizer
                }
              });
            }
          }
        }
      }
    }
    
    console.log('\n=== DUPLICATES ===');
    if (potentialDuplicates.length === 0) {
      console.log('[]');
    } else {
      console.log(JSON.stringify(potentialDuplicates, null, 2));
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
