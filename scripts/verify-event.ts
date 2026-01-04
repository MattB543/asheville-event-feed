/**
 * Verify a single event against its source URL
 *
 * Usage: npx tsx scripts/verify-event.ts <shortId> [--update]
 *
 * Examples:
 *   npx tsx scripts/verify-event.ts e4df13
 *   npx tsx scripts/verify-event.ts e4df13 --update
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { sql, eq } from 'drizzle-orm';
import { env, isJinaEnabled } from '../lib/config/env';
import { azureChatCompletion, isAzureAIEnabled } from '../lib/ai/provider-clients';

interface VerificationResult {
  isValid: boolean;
  action: 'keep' | 'update' | 'hide';
  confidence: number;
  reason: string;
  updates?: {
    title?: string;
    startDate?: string;
    location?: string;
    price?: string;
    description?: string;
  };
}

async function fetchPageContent(url: string): Promise<string | null> {
  if (!isJinaEnabled()) {
    console.error('ERROR: JINA_API_KEY not configured');
    return null;
  }

  try {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;

    const response = await fetch(jinaUrl, {
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        'x-respond-with': 'markdown',
        'x-timeout': '30',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch page: ${response.status}`);
      return null;
    }

    return await response.text();
  } catch (error) {
    console.error('Error fetching page:', error);
    return null;
  }
}

async function verifyWithAI(
  event: {
    title: string;
    startDate: Date;
    location: string | null;
    price: string | null;
    description: string | null;
    organizer: string | null;
    url: string;
  },
  pageContent: string
): Promise<VerificationResult> {
  if (!isAzureAIEnabled()) {
    return {
      isValid: false,
      action: 'keep',
      confidence: 0,
      reason: 'Azure AI not configured',
    };
  }

  const eventDate = event.startDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });

  const eventTime = event.startDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });

  const truncatedContent =
    pageContent.length > 10000
      ? pageContent.slice(0, 10000) + '\n\n[Content truncated...]'
      : pageContent;

  const systemPrompt = `You compare stored event data with live web page content to verify accuracy.

Your task:
1. Check if the event is CANCELLED, POSTPONED, or no longer valid
2. Compare date, time, location, price, and description
3. Identify any differences that need updating

Response format (JSON only):
{
  "action": "keep" | "update" | "hide",
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "updates": {
    "title": "corrected title or null",
    "startDate": "ISO 8601 datetime if different, or null",
    "location": "corrected location or null",
    "price": "corrected price or null",
    "description": "corrected description or null"
  }
}

Guidelines:
- "keep" = Event data matches the page
- "update" = Event is valid but details differ
- "hide" = Event is cancelled/postponed/not found
- Only include fields in "updates" that need changing
- Be conservative - only mark updates for clear differences`;

  const userPrompt = `## Stored Event Data
Title: ${event.title}
Date: ${eventDate}
Time: ${eventTime}
Location: ${event.location || 'Not specified'}
Organizer: ${event.organizer || 'Not specified'}
Price: ${event.price || 'Unknown'}
Description: ${event.description?.slice(0, 500) || 'None'}
URL: ${event.url}

## Web Page Content
${truncatedContent}`;

  try {
    const response = await azureChatCompletion(systemPrompt, userPrompt, {
      maxTokens: 2000,
    });

    if (!response?.content) {
      return {
        isValid: false,
        action: 'keep',
        confidence: 0,
        reason: 'No AI response',
      };
    }

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        isValid: false,
        action: 'keep',
        confidence: 0,
        reason: 'Invalid AI response format',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isValid: true,
      action: parsed.action || 'keep',
      confidence: parsed.confidence || 0,
      reason: parsed.reason || 'No reason provided',
      updates: parsed.updates,
    };
  } catch (error) {
    return {
      isValid: false,
      action: 'keep',
      confidence: 0,
      reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function main() {
  const shortId = process.argv[2];
  const shouldUpdate = process.argv.includes('--update');

  if (!shortId) {
    console.log('Usage: npx tsx scripts/verify-event.ts <shortId> [--update]');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx scripts/verify-event.ts e4df13');
    console.log('  npx tsx scripts/verify-event.ts e4df13 --update');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Event Verification');
  console.log('='.repeat(60));

  // Find event by short ID
  const results = await db
    .select()
    .from(events)
    .where(sql`${events.id}::text LIKE ${shortId + '%'}`);

  if (results.length === 0) {
    console.error(`ERROR: No event found with ID starting with: ${shortId}`);
    process.exit(1);
  }

  const event = results[0];
  console.log('\nStored Event:');
  console.log(`  ID: ${event.id}`);
  console.log(`  Title: ${event.title}`);
  console.log(`  Source: ${event.source}`);
  console.log(
    `  Date: ${event.startDate.toLocaleString('en-US', { timeZone: 'America/New_York' })}`
  );
  console.log(`  Location: ${event.location || 'N/A'}`);
  console.log(`  Price: ${event.price || 'Unknown'}`);
  console.log(`  URL: ${event.url}`);

  console.log('\nFetching page content...');
  const pageContent = await fetchPageContent(event.url);

  if (!pageContent) {
    console.error('ERROR: Could not fetch page content');
    process.exit(1);
  }

  console.log(`Page fetched (${pageContent.length} chars)`);
  console.log('\nAnalyzing with AI...');

  const result = await verifyWithAI(
    {
      title: event.title,
      startDate: event.startDate,
      location: event.location,
      price: event.price,
      description: event.description,
      organizer: event.organizer,
      url: event.url,
    },
    pageContent
  );

  console.log('\n' + '='.repeat(60));
  console.log('Verification Result');
  console.log('='.repeat(60));
  console.log(`Action: ${result.action.toUpperCase()}`);
  console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`Reason: ${result.reason}`);

  if (
    result.updates &&
    Object.keys(result.updates).some((k) => result.updates![k as keyof typeof result.updates])
  ) {
    console.log('\nSuggested Updates:');
    if (result.updates.title) console.log(`  Title: ${result.updates.title}`);
    if (result.updates.startDate) console.log(`  Date: ${result.updates.startDate}`);
    if (result.updates.location) console.log(`  Location: ${result.updates.location}`);
    if (result.updates.price) console.log(`  Price: ${result.updates.price}`);
    if (result.updates.description)
      console.log(`  Description: ${result.updates.description.slice(0, 100)}...`);
  }

  // Apply updates if --update flag is set
  if (shouldUpdate && result.action === 'update' && result.updates) {
    console.log('\n' + '='.repeat(60));
    console.log('Applying Updates...');
    console.log('='.repeat(60));

    const updateData: Partial<typeof event> = {};

    if (result.updates.title) updateData.title = result.updates.title;
    if (result.updates.location) updateData.location = result.updates.location;
    if (result.updates.price) updateData.price = result.updates.price;
    if (result.updates.description) updateData.description = result.updates.description;
    if (result.updates.startDate) {
      updateData.startDate = new Date(result.updates.startDate);
    }

    if (Object.keys(updateData).length > 0) {
      await db.update(events).set(updateData).where(eq(events.id, event.id));
      console.log('Event updated successfully!');

      // Show updated values
      for (const [key, value] of Object.entries(updateData)) {
        console.log(`  ${key}: ${value instanceof Date ? value.toISOString() : value}`);
      }
    } else {
      console.log('No updates to apply.');
    }
  } else if (shouldUpdate && result.action === 'hide') {
    console.log('\n' + '='.repeat(60));
    console.log('Hiding Event...');
    console.log('='.repeat(60));

    await db.update(events).set({ hidden: true }).where(eq(events.id, event.id));
    console.log('Event hidden successfully!');
  } else if (result.action === 'update' && !shouldUpdate) {
    console.log('\nTo apply these updates, run with --update flag:');
    console.log(`  npx tsx scripts/verify-event.ts ${shortId} --update`);
  }

  console.log('\n' + '='.repeat(60));
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
