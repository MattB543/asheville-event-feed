/**
 * Debug Enrichment Script
 *
 * Runs extraction on events and saves detailed logs to analyze failures.
 * Outputs a JSON file with all inputs, prompts, responses, and outcomes.
 *
 * Usage:
 *   npx tsx scripts/debug-enrichment.ts              # Process 20 events
 *   npx tsx scripts/debug-enrichment.ts --limit 50   # Process 50 events
 */

import '../lib/config/env';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';
import { tryExtractPrice } from '@/lib/utils/extractPrice';
import { tryExtractAndApplyTime } from '@/lib/utils/extractTime';
import { azureChatCompletion, isAzureAIEnabled } from '@/lib/ai/azure-client';
import { fetchAndConvertToMarkdown } from '@/lib/utils/htmlToMarkdown';
import * as fs from 'fs';

// Type interface for DB query rows
interface EventDbRow {
  id: string;
  title: string;
  source: string;
  organizer: string | null;
  url: string;
  price: string | null;
  time_unknown: boolean | null;
  description: string | null;
  start_date: string;
}

interface DebugEntry {
  eventId: string;
  title: string;
  source: string;
  organizer: string | null;
  url: string;
  originalPrice: string | null;
  originalTimeUnknown: boolean | null;
  description: string | null;
  descriptionLength: number;

  // Regex step
  regexPriceResult: string | null;
  regexTimeResult: string | null;
  regexSuccess: boolean;

  // AI step (if needed)
  aiAttempted: boolean;
  pageMarkdown: string | null;
  pageMarkdownLength: number;
  contentSource: 'page' | 'description' | 'none';
  aiPrompt: string | null;
  aiRawResponse: string | null;
  aiParsedResponse: Record<string, unknown> | null;
  aiParseError: string | null;
  aiPriceResult: string | null;
  aiTimeResult: string | null;
  aiSuccess: boolean;

  // Final outcome
  finalPrice: string | null;
  finalTimeExtracted: boolean;
  outcome: 'regex_success' | 'ai_success' | 'partial_success' | 'failure';
  failureReason: string | null;
}

// Parse CLI arguments
const args = process.argv.slice(2);
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1], 10) : 20;

const EXTRACTION_SYSTEM_PROMPT = `You are a data extraction assistant. Extract event pricing and timing information from event descriptions and web page content.

IMPORTANT RULES:
1. Extract information that is EXPLICITLY stated OR strongly implied in the content
2. Common price phrases to recognize:
   - "$20 at the door", "20 bucks", "$15-25" → extract the price
   - "free event", "no cover", "free admission", "open to all" → "Free"
   - "buy tickets", "tickets available", "ticketed event" without price → "Ticketed"
   - Community events, meetups, public gatherings without price mentioned → likely "Free"
3. For time, extract if a specific start time is mentioned (e.g., "7pm", "19:00", "doors at 6, show at 7", "starting at 8")
4. Return time in 24-hour format (e.g., "19:00" not "7:00 PM")
5. If you see a "doors" time and "show" time, return the show time
6. Use your judgment - if it's clearly a free community event or paid concert, indicate that

Return ONLY a JSON object with this structure (no markdown, no explanation):
{"price": "$25" | "Free" | "Ticketed" | null, "time": "19:00" | null, "confidence": "high" | "medium" | "low"}`;

async function debugEnrichment() {
  console.log('\n=== DEBUG ENRICHMENT ===\n');
  console.log(`Processing ${limit} events with detailed logging...\n`);

  if (!isAzureAIEnabled()) {
    console.error('Azure AI is not configured. Cannot run AI enrichment.');
    process.exit(1);
  }

  const nowISO = new Date().toISOString();

  // Query events needing enrichment
  const results = await db.execute(sql`
    SELECT id, source, title, description, organizer, price, time_unknown, start_date, url
    FROM events
    WHERE start_date >= ${nowISO}::timestamp
      AND (
        price IS NULL
        OR price = 'Unknown'
        OR time_unknown = true
      )
    ORDER BY RANDOM()
    LIMIT ${limit}
  `);

  const rows = ((results as { rows?: unknown[] }).rows || (results as unknown[])) as EventDbRow[];
  const debugEntries: DebugEntry[] = [];

  let regexSuccessCount = 0;
  let aiSuccessCount = 0;
  let partialSuccessCount = 0;
  let failureCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const progress = `[${i + 1}/${rows.length}]`;
    console.log(`${progress} Processing: ${row.title}`);

    const entry: DebugEntry = {
      eventId: row.id,
      title: row.title,
      source: row.source,
      organizer: row.organizer,
      url: row.url,
      originalPrice: row.price,
      originalTimeUnknown: row.time_unknown,
      description: row.description,
      descriptionLength: row.description?.length || 0,
      regexPriceResult: null,
      regexTimeResult: null,
      regexSuccess: false,
      aiAttempted: false,
      pageMarkdown: null,
      pageMarkdownLength: 0,
      contentSource: 'none',
      aiPrompt: null,
      aiRawResponse: null,
      aiParsedResponse: null,
      aiParseError: null,
      aiPriceResult: null,
      aiTimeResult: null,
      aiSuccess: false,
      finalPrice: null,
      finalTimeExtracted: false,
      outcome: 'failure',
      failureReason: null,
    };

    const needsPrice = !row.price || row.price === 'Unknown';
    const needsTime = row.time_unknown === true;

    // Step 1: Try regex extraction
    if (needsPrice) {
      const extractedPrice = tryExtractPrice(row.description, row.price, row.organizer);
      if (extractedPrice !== 'Unknown') {
        entry.regexPriceResult = extractedPrice;
        entry.finalPrice = extractedPrice;
      }
    }

    if (needsTime) {
      const startDate = new Date(row.start_date);
      const timeResult = tryExtractAndApplyTime(startDate, row.description);
      if (timeResult.timeUpdated) {
        entry.regexTimeResult = timeResult.extractedTime || null;
        entry.finalTimeExtracted = true;
      }
    }

    // Check if regex was sufficient
    const regexGotPrice = entry.regexPriceResult !== null;
    const regexGotTime = !needsTime || entry.finalTimeExtracted;
    entry.regexSuccess = (needsPrice ? regexGotPrice : true) && (needsTime ? regexGotTime : true);

    if (entry.regexSuccess) {
      entry.outcome = 'regex_success';
      regexSuccessCount++;
      console.log(`    ✅ Regex success: price=${entry.finalPrice}, time=${entry.regexTimeResult}`);
      debugEntries.push(entry);
      continue;
    }

    // Step 2: Try AI extraction
    entry.aiAttempted = true;
    const stillNeedsPrice = needsPrice && !entry.regexPriceResult;
    const stillNeedsTime = needsTime && !entry.finalTimeExtracted;

    // Try to fetch page content
    let pageMarkdown = await fetchAndConvertToMarkdown(row.url, 12000);

    if (pageMarkdown) {
      entry.pageMarkdown = pageMarkdown.slice(0, 2000) + (pageMarkdown.length > 2000 ? '...[truncated]' : '');
      entry.pageMarkdownLength = pageMarkdown.length;
      entry.contentSource = 'page';
    } else if (row.description && row.description.trim().length > 10) {
      pageMarkdown = row.description;
      entry.pageMarkdown = row.description;
      entry.pageMarkdownLength = row.description.length;
      entry.contentSource = 'description';
      console.log(`    📝 Using description fallback`);
    } else {
      entry.contentSource = 'none';
      entry.failureReason = 'No content: page fetch failed and no description';
      entry.outcome = 'failure';
      failureCount++;
      console.log(`    ❌ No content available`);
      debugEntries.push(entry);
      continue;
    }

    // Build AI prompt
    const userPrompt = `Event: "${row.title}"
Organizer: ${row.organizer || 'Unknown'}
URL: ${row.url}
${stillNeedsPrice ? 'NEED TO EXTRACT: Price (currently unknown)' : ''}
${stillNeedsTime ? 'NEED TO EXTRACT: Event start time (currently unknown)' : ''}

${entry.contentSource === 'page' ? 'Page content' : 'Event description'}:
---
${pageMarkdown}
---

Extract the requested information. If the event appears to be a free community event/meetup with no price mentioned, return "Free". If it's clearly a ticketed show (concert, comedy, theater) but no price is shown, return "Ticketed".`;

    entry.aiPrompt = userPrompt.slice(0, 3000) + (userPrompt.length > 3000 ? '...[truncated]' : '');

    try {
      const result = await azureChatCompletion(
        EXTRACTION_SYSTEM_PROMPT,
        userPrompt,
        { maxTokens: 4000 }
      );

      entry.aiRawResponse = result?.content || null;

      if (!result || !result.content) {
        entry.failureReason = 'AI returned empty response';
      } else {
        // Try to parse JSON
        try {
          const cleanContent = result.content
            .replace(/```json\s*/g, '')
            .replace(/```\s*/g, '')
            .trim();
          const parsed = JSON.parse(cleanContent);
          entry.aiParsedResponse = parsed;

          // Validate and extract price
          if (stillNeedsPrice && parsed.price) {
            if (
              parsed.price === 'Free' ||
              parsed.price === 'Ticketed' ||
              /^\$\d+(\.\d{2})?\+?$/.test(parsed.price) ||
              /^\$\d+\s*-\s*\$\d+$/.test(parsed.price)
            ) {
              entry.aiPriceResult = parsed.price;
              entry.finalPrice = parsed.price;
            } else if (parsed.price.toLowerCase().startsWith('free')) {
              // Handle "Free (suggested donation $X)" or similar
              entry.aiPriceResult = 'Free';
              entry.finalPrice = 'Free';
              console.log(`    📝 Normalized: "${parsed.price}" → "Free"`);
            } else {
              // Try to extract just the dollar amount from complex formats
              const priceMatch = parsed.price.match(/^\$(\d+(?:\.\d{2})?)/);
              if (priceMatch) {
                const normalized = `$${Math.round(parseFloat(priceMatch[1]))}`;
                entry.aiPriceResult = normalized;
                entry.finalPrice = normalized;
                console.log(`    📝 Normalized price: "${parsed.price}" → "${normalized}"`);
              } else {
                entry.failureReason = `Invalid price format: ${parsed.price}`;
              }
            }
          }

          // Validate and extract time
          if (stillNeedsTime && parsed.time) {
            const timeMatch = parsed.time.match(/^(\d{1,2}):(\d{2})$/);
            if (timeMatch) {
              const hour = parseInt(timeMatch[1], 10);
              const minute = parseInt(timeMatch[2], 10);
              if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                entry.aiTimeResult = parsed.time;
                entry.finalTimeExtracted = true;
              } else {
                entry.failureReason = `Invalid time value: ${parsed.time}`;
              }
            }
          }

          // If AI returned null for both, check why
          if (parsed.price === null && parsed.time === null) {
            entry.failureReason = `AI could not extract data (returned nulls). Confidence: ${parsed.confidence}`;
          }

        } catch (parseErr) {
          entry.aiParseError = `JSON parse error: ${parseErr}`;
          entry.failureReason = `Failed to parse AI response: ${result.content.slice(0, 200)}`;
        }
      }
    } catch (error) {
      entry.failureReason = `AI call error: ${error}`;
    }

    // Determine final outcome
    const aiGotPrice = entry.aiPriceResult !== null;
    const aiGotTime = entry.aiTimeResult !== null;
    entry.aiSuccess = (stillNeedsPrice ? aiGotPrice : true) && (stillNeedsTime ? aiGotTime : true);

    if (entry.aiSuccess) {
      entry.outcome = 'ai_success';
      aiSuccessCount++;
      console.log(`    ✅ AI success: price=${entry.finalPrice}, time=${entry.aiTimeResult}`);
    } else if (entry.regexPriceResult || entry.aiPriceResult || entry.finalTimeExtracted) {
      entry.outcome = 'partial_success';
      partialSuccessCount++;
      console.log(`    ⚠️ Partial: price=${entry.finalPrice}, time=${entry.aiTimeResult || entry.regexTimeResult}`);
    } else {
      entry.outcome = 'failure';
      failureCount++;
      console.log(`    ❌ Failed: ${entry.failureReason}`);
    }

    debugEntries.push(entry);

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // Save debug output
  const outputPath = 'debug-enrichment-output.json';
  fs.writeFileSync(outputPath, JSON.stringify(debugEntries, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('DEBUG SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${rows.length}`);
  console.log(`Regex success: ${regexSuccessCount} (${Math.round(regexSuccessCount / rows.length * 100)}%)`);
  console.log(`AI success: ${aiSuccessCount} (${Math.round(aiSuccessCount / rows.length * 100)}%)`);
  console.log(`Partial success: ${partialSuccessCount} (${Math.round(partialSuccessCount / rows.length * 100)}%)`);
  console.log(`Failures: ${failureCount} (${Math.round(failureCount / rows.length * 100)}%)`);
  console.log(`\nDetailed output saved to: ${outputPath}`);

  // Analyze failures
  const failures = debugEntries.filter(e => e.outcome === 'failure');
  if (failures.length > 0) {
    console.log('\n--- FAILURE ANALYSIS ---');
    const reasonCounts: Record<string, number> = {};
    for (const f of failures) {
      const reason = f.failureReason || 'Unknown';
      const category = reason.includes('No content') ? 'No content available'
        : reason.includes('empty response') ? 'AI empty response'
        : reason.includes('parse') ? 'JSON parse error'
        : reason.includes('null') ? 'AI returned null (no data found)'
        : reason.includes('Invalid') ? 'Invalid format'
        : 'Other';
      reasonCounts[category] = (reasonCounts[category] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  // Show sample failures for investigation
  console.log('\n--- SAMPLE FAILURES (first 5) ---');
  for (const f of failures.slice(0, 5)) {
    console.log(`\nEvent: ${f.title}`);
    console.log(`  Source: ${f.source}`);
    console.log(`  URL: ${f.url}`);
    console.log(`  Description length: ${f.descriptionLength}`);
    console.log(`  Content source: ${f.contentSource}`);
    console.log(`  Failure reason: ${f.failureReason}`);
    if (f.aiRawResponse) {
      console.log(`  AI response: ${f.aiRawResponse.slice(0, 200)}...`);
    }
  }
}

debugEnrichment()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
