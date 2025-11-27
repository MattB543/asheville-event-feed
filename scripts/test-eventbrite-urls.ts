

const URLS = [
  "https://www.eventbrite.com/d/nc--asheville/events/",
  "https://www.eventbrite.com/d/nc--asheville/events--today/",
  "https://www.eventbrite.com/d/nc--asheville/events--tomorrow/",
  "https://www.eventbrite.com/d/nc--asheville/events--this-weekend/",
  "https://www.eventbrite.com/d/nc--asheville/events--this-week/",
  "https://www.eventbrite.com/d/nc--asheville/events--next-month/"
];

async function testUrls() {
  const allIds = new Set<string>();

  for (const url of URLS) {
    try {
      console.log(`Fetching ${url}...`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      const html = await response.text();
      const matches = html.matchAll(/https:\/\/www\.eventbrite\.com\/e\/[^"]*-tickets-(\d+)/g);
      
      let count = 0;
      for (const match of matches) {
        allIds.add(match[1]);
        count++;
      }
      console.log(`Found ${count} IDs. Total unique so far: ${allIds.size}`);
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
    }
  }
}

testUrls();
