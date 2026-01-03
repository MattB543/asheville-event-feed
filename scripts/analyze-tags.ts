/**
 * Analyze all tags in the database
 * Shows tag counts, normalized versions, and whether they're in the default list
 *
 * Usage: npx tsx scripts/analyze-tags.ts
 */

import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { gte } from 'drizzle-orm';
import { ALL_KNOWN_TAGS } from '../lib/config/tagCategories';

const MIN_COUNT = 10; // Filter out tags used less than this many times

// Normalize a tag for comparison (lowercase, replace hyphens with spaces, trim)
function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

// Create a set of normalized known tags for comparison
const normalizedKnownTags = new Set(ALL_KNOWN_TAGS.map(normalizeTag));

async function analyzeTags() {
  console.log('Fetching all events with tags...\n');

  // Get all events with tags (future events only, not hidden)
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const allEvents = await db
    .select({ tags: events.tags })
    .from(events)
    .where(gte(events.startDate, startOfToday));

  console.log(`Found ${allEvents.length} future events\n`);

  // Count raw tags
  const rawTagCounts = new Map<string, number>();
  // Count normalized tags (for grouping similar ones)
  const normalizedTagCounts = new Map<string, { count: number; variants: Set<string> }>();

  for (const event of allEvents) {
    if (event.tags) {
      for (const tag of event.tags) {
        // Raw count
        rawTagCounts.set(tag, (rawTagCounts.get(tag) || 0) + 1);

        // Normalized count
        const normalized = normalizeTag(tag);
        if (!normalizedTagCounts.has(normalized)) {
          normalizedTagCounts.set(normalized, { count: 0, variants: new Set() });
        }
        const entry = normalizedTagCounts.get(normalized)!;
        entry.count++;
        entry.variants.add(tag);
      }
    }
  }

  // Sort by count descending
  const sortedNormalized = Array.from(normalizedTagCounts.entries()).sort(
    (a, b) => b[1].count - a[1].count
  );

  // Categorize (only tags with MIN_COUNT or more usages)
  const knownTags: Array<{ tag: string; count: number; normalized: string }> = [];
  const otherTags: Array<{
    tag: string;
    count: number;
    normalized: string;
    variants: string[];
  }> = [];

  for (const [normalized, data] of sortedNormalized) {
    if (data.count < MIN_COUNT) continue; // Filter out low-usage tags

    const isKnown = normalizedKnownTags.has(normalized);
    const variants = Array.from(data.variants);

    if (isKnown) {
      // Find the canonical version from ALL_KNOWN_TAGS
      const canonical = ALL_KNOWN_TAGS.find((t) => normalizeTag(t) === normalized) || variants[0];
      knownTags.push({
        tag: canonical,
        count: data.count,
        normalized,
      });
    } else {
      otherTags.push({
        tag: variants[0], // Use first variant as display
        count: data.count,
        normalized,
        variants: variants.length > 1 ? variants : [],
      });
    }
  }

  // Build markdown content
  const md: string[] = [];

  md.push('# Tag Analysis Report');
  md.push('');
  md.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
  md.push(`Future events analyzed: ${allEvents.length}`);
  md.push(`Minimum usage threshold: ${MIN_COUNT}`);
  md.push('');

  md.push('## Summary');
  md.push('');
  md.push(`| Metric | Value |`);
  md.push(`|--------|-------|`);
  md.push(`| Total unique tags (raw) | ${rawTagCounts.size} |`);
  md.push(`| Total unique tags (normalized) | ${normalizedTagCounts.size} |`);
  md.push(
    `| Known tags (≥${MIN_COUNT} uses) | ${knownTags.length} (${knownTags.reduce((sum, t) => sum + t.count, 0)} usages) |`
  );
  md.push(
    `| Other tags (≥${MIN_COUNT} uses) | ${otherTags.length} (${otherTags.reduce((sum, t) => sum + t.count, 0)} usages) |`
  );
  md.push('');

  md.push('## Known Tags (in TAG_CATEGORIES)');
  md.push('');
  md.push('| Tag | Count |');
  md.push('|-----|------:|');
  for (const { tag, count } of knownTags) {
    md.push(`| ${tag} | ${count} |`);
  }
  md.push('');

  md.push('## Other Tags (not in TAG_CATEGORIES)');
  md.push('');
  md.push('| Tag | Count | Variants |');
  md.push('|-----|------:|----------|');
  for (const { tag, count, variants } of otherTags) {
    const variantStr = variants.length > 0 ? variants.join(', ') : '-';
    md.push(`| ${tag} | ${count} | ${variantStr} |`);
  }
  md.push('');

  // Write markdown file
  const fs = await import('fs');
  const outputPath = 'scripts/tag-analysis.md';
  fs.writeFileSync(outputPath, md.join('\n'));
  console.log(`Markdown exported to: ${outputPath}`);

  process.exit(0);
}

analyzeTags().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
