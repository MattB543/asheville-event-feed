import fs from 'fs';
import path from 'path';

async function main() {
  // Manually read .env to ensure we get the absolute latest version on disk
  const envPath = path.join(process.cwd(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const match = envContent.match(/GEMINI_API_KEY=(.*)/);
  
  if (!match) {
    console.error("Could not find GEMINI_API_KEY in .env file directly.");
    return;
  }
  
  const apiKey = match[1].trim();
  console.log(`Read API Key from .env: ${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 4)}`);
  console.log(`Key length: ${apiKey.length}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{
      parts: [{ text: "Hello, this is a test." }]
    }]
  };

  console.log("Sending raw HTTP request to gemini-2.5-flash-lite...");
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    const data = await response.json();
    console.log("Response Body:");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Fetch error:", error);
  }
}

main();
