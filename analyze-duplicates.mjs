import { neon } from '@neondatabase/serverless';
import 'dotenv/config.js';

(async () => {
  try {
    const sql = neon(process.env.DATABASE_URL);
    
    const result = await sql`
      SELECT id, title, source, organizer, start_date, price, description
      FROM events
      ORDER BY start_date ASC
      LIMIT 460 OFFSET 440
    `;
    
    // Group by date
    const eventsByDate = {};
    
    for (const event of result) {
      const dateKey = event.start_date.toISOString().split('T')[0];
      if (!eventsByDate[dateKey]) {
        eventsByDate[dateKey] = [];
      }
      eventsByDate[dateKey].push(event);
    }
    
    let duplicateGroups = [];
    let processedIds = new Set();
    
    for (const date of Object.keys(eventsByDate).sort()) {
      const eventsOnDate = eventsByDate[date];
      
      if (eventsOnDate.length > 1) {
        for (let i = 0; i < eventsOnDate.length; i++) {
          const e1 = eventsOnDate[i];
          
          if (processedIds.has(e1.id)) continue;
          
          for (let j = i + 1; j < eventsOnDate.length; j++) {
            const e2 = eventsOnDate[j];
            
            if (processedIds.has(e2.id)) continue;
            
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
            
            // Determine if these are duplicates
            const crossSource = e1.source !== e2.source;
            const sameOrganizer = e1.organizer && e2.organizer && 
                                  e1.organizer.toLowerCase() === e2.organizer.toLowerCase();
            const exactTitleMatch = title1 === title2;
            const significant_shared_words = sharedCount >= 2;
            
            let isDuplicate = false;
            let confidence = 'low';
            
            if (exactTitleMatch && sameOrganizer && crossSource) {
              isDuplicate = true;
              confidence = 'high';
            } else if (exactTitleMatch && sameOrganizer) {
              isDuplicate = true;
              confidence = 'high';
            } else if (exactTitleMatch && crossSource) {
              isDuplicate = true;
              confidence = 'high';
            } else if (significant_shared_words && sameOrganizer && crossSource) {
              isDuplicate = true;
              confidence = 'high';
            } else if (significant_shared_words && sameOrganizer) {
              isDuplicate = true;
              confidence = 'medium';
            } else if (significant_shared_words && crossSource) {
              isDuplicate = true;
              confidence = 'medium';
            }
            
            if (isDuplicate && confidence !== 'low') {
              // Determine which to keep (prefer: known price > longer description > newer)
              let keepEvent = e1;
              let removeEvent = e2;
              
              const e1HasPrice = e1.price && e1.price !== 'Unknown';
              const e2HasPrice = e2.price && e2.price !== 'Unknown';
              
              if (e2HasPrice && !e1HasPrice) {
                keepEvent = e2;
                removeEvent = e1;
              } else if (e1HasPrice === e2HasPrice) {
                const desc1Len = e1.description?.length || 0;
                const desc2Len = e2.description?.length || 0;
                if (desc2Len > desc1Len) {
                  keepEvent = e2;
                  removeEvent = e1;
                }
              }
              
              duplicateGroups.push({
                event_name: keepEvent.title,
                confidence: confidence,
                instances: [
                  {
                    id: keepEvent.id,
                    source: keepEvent.source || 'UNKNOWN',
                    title: keepEvent.title,
                    keep: true,
                    reason: 'Primary version - ' + (keepEvent.price && keepEvent.price !== 'Unknown' ? 'has known price' : keepEvent.description?.length > 50 ? 'longer description' : 'newer')
                  },
                  {
                    id: removeEvent.id,
                    source: removeEvent.source || 'UNKNOWN',
                    title: removeEvent.title,
                    keep: false,
                    reason: 'Duplicate of above - ' + (exactTitleMatch ? 'exact title match' : significant_shared_words ? 'shares key words' : 'similar event')
                  }
                ]
              });
              
              processedIds.add(e1.id);
              processedIds.add(e2.id);
              break;
            }
          }
        }
      }
    }
    
    // Filter to only HIGH and MEDIUM confidence
    const filtered = duplicateGroups.filter(d => d.confidence === 'high' || d.confidence === 'medium');
    
    console.log(JSON.stringify(filtered, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
