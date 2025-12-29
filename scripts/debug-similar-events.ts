import 'dotenv/config';
import { sql, eq } from 'drizzle-orm';
import { InferSelectModel } from 'drizzle-orm';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { parseEventSlug } from '../lib/utils/slugify';
import { createEmbeddingText, cosineSimilarity } from '../lib/ai/embedding';
import { findSimilarEvents } from '../lib/db/similaritySearch';

type DbEvent = InferSelectModel<typeof events>;

const DEFAULT_SLUGS = [
  'ai-hacks-and-hops-2026-01-14-07fa3d',
  'mashup-mondays-wjlloyd-2026-02-02-a33af4',
];

function toShortId(input: string): string | null {
  const parsed = parseEventSlug(input);
  if (parsed) return parsed.shortId;
  if (/^[a-f0-9]{6}$/i.test(input)) return input;
  return null;
}

async function getEventByInput(input: string): Promise<DbEvent | null> {
  const shortId = toShortId(input);
  if (shortId) {
    const result = await db
      .select()
      .from(events)
      .where(sql`${events.id}::text LIKE ${shortId + '%'}`)
      .limit(1);
    return result[0] || null;
  }

  if (/^[a-f0-9-]{36}$/i.test(input)) {
    const result = await db
      .select()
      .from(events)
      .where(eq(events.id, input))
      .limit(1);
    return result[0] || null;
  }

  return null;
}

function formatTags(tags: string[] | null): string {
  if (!tags || tags.length === 0) return '(none)';
  return tags.join(', ');
}

function formatTextPreview(value: string | null | undefined, max = 240): string {
  if (!value) return '(none)';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function buildLegacyEmbeddingText(event: DbEvent): string {
  return `${event.title}: ${event.aiSummary || ''}`.trim();
}

async function printSimilarEvents(
  event: DbEvent,
  options?: { futureOnly?: boolean; limit?: number; minSimilarity?: number }
) {
  const { futureOnly = false, limit = 10, minSimilarity = 0.3 } = options || {};
  const similar = await findSimilarEvents(event.id, {
    limit,
    minSimilarity,
    futureOnly,
    orderBy: 'similarity',
  });

  console.log('\nSimilar events (top 10, min 0.30):');
  if (similar.length === 0) {
    console.log('  (none)');
    return;
  }

  for (const item of similar) {
    console.log(`  ${item.similarity.toFixed(3)} - ${item.title} (${item.id.slice(0, 6)})`);
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const futureOnly = rawArgs.includes('--future-only') || rawArgs.includes('--future');
  const limitArg = rawArgs.find((arg) => arg.startsWith('--limit='));
  const minArg = rawArgs.find((arg) => arg.startsWith('--min='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 10;
  const minSimilarity = minArg ? Number(minArg.split('=')[1]) : 0.3;
  const inputs = rawArgs.filter((arg) => !arg.startsWith('--'));
  const effectiveInputs = inputs.length > 0 ? inputs : DEFAULT_SLUGS;

  if (effectiveInputs.length === 1) {
    const event = await getEventByInput(effectiveInputs[0]);
    if (!event) {
      console.error('Failed to load the event.');
      process.exit(1);
    }

    console.log('=== EVENT ===');
    console.log('ID:', event.id);
    console.log('Title:', event.title);
    console.log('Date:', event.startDate.toISOString());
    console.log('Location:', event.location || '(none)');
    console.log('Organizer:', event.organizer || '(none)');
    console.log('Tags:', formatTags(event.tags));
    console.log('AI Summary:', formatTextPreview(event.aiSummary));
    console.log('Description:', formatTextPreview(event.description));
    console.log('Embedding:', event.embedding ? `yes (${event.embedding.length})` : 'no');
    console.log('Embedding Text (stored format):', buildLegacyEmbeddingText(event));
    console.log(
      'Embedding Text (new format):',
      createEmbeddingText(event.title, event.aiSummary || '', event.tags, event.organizer)
    );

    console.log('\n=== TOP SIMILAR EVENTS ===');
    await printSimilarEvents(event, { futureOnly, limit, minSimilarity });
    return;
  }

  if (effectiveInputs.length < 2) {
    console.error('Provide one or two slugs/IDs.');
    process.exit(1);
  }

  const [inputA, inputB] = effectiveInputs;
  const eventA = await getEventByInput(inputA);
  const eventB = await getEventByInput(inputB);

  if (!eventA || !eventB) {
    console.error('Failed to load both events.');
    console.log('Event A found:', !!eventA);
    console.log('Event B found:', !!eventB);
    process.exit(1);
  }

  console.log('=== EVENT A ===');
  console.log('ID:', eventA.id);
  console.log('Title:', eventA.title);
  console.log('Date:', eventA.startDate.toISOString());
  console.log('Location:', eventA.location || '(none)');
  console.log('Organizer:', eventA.organizer || '(none)');
  console.log('Tags:', formatTags(eventA.tags));
  console.log('AI Summary:', formatTextPreview(eventA.aiSummary));
  console.log('Description:', formatTextPreview(eventA.description));
  console.log('Embedding:', eventA.embedding ? `yes (${eventA.embedding.length})` : 'no');
  console.log('Embedding Text (stored format):', buildLegacyEmbeddingText(eventA));
  console.log(
    'Embedding Text (new format):',
    createEmbeddingText(eventA.title, eventA.aiSummary || '', eventA.tags, eventA.organizer)
  );

  console.log('\n=== EVENT B ===');
  console.log('ID:', eventB.id);
  console.log('Title:', eventB.title);
  console.log('Date:', eventB.startDate.toISOString());
  console.log('Location:', eventB.location || '(none)');
  console.log('Organizer:', eventB.organizer || '(none)');
  console.log('Tags:', formatTags(eventB.tags));
  console.log('AI Summary:', formatTextPreview(eventB.aiSummary));
  console.log('Description:', formatTextPreview(eventB.description));
  console.log('Embedding:', eventB.embedding ? `yes (${eventB.embedding.length})` : 'no');
  console.log('Embedding Text (stored format):', buildLegacyEmbeddingText(eventB));
  console.log(
    'Embedding Text (new format):',
    createEmbeddingText(eventB.title, eventB.aiSummary || '', eventB.tags, eventB.organizer)
  );

  if (eventA.embedding && eventB.embedding) {
    const similarity = cosineSimilarity(
      eventA.embedding as number[],
      eventB.embedding as number[]
    );
    console.log('\n=== DIRECT SIMILARITY ===');
    console.log(`Similarity (A vs B): ${similarity.toFixed(4)}`);
  } else {
    console.log('\n=== DIRECT SIMILARITY ===');
    console.log('Missing embeddings for one or both events.');
  }

  console.log('\n=== TOP SIMILAR EVENTS FOR A ===');
  await printSimilarEvents(eventA, { futureOnly, limit, minSimilarity });

  console.log('\n=== TOP SIMILAR EVENTS FOR B ===');
  await printSimilarEvents(eventB, { futureOnly, limit, minSimilarity });
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
