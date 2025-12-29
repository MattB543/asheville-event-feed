import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { InferSelectModel } from 'drizzle-orm';
import { db } from '../lib/db';
import { events } from '../lib/db/schema';
import { parseEventSlug } from '../lib/utils/slugify';
import { cosineSimilarity, createEmbeddingText, generateEmbedding } from '../lib/ai/embedding';

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

function buildEmbeddingString(event: DbEvent): string {
  return createEmbeddingText(
    event.title,
    event.aiSummary || '',
    event.tags,
    event.organizer
  );
}

async function embedText(label: string, text: string): Promise<number[]> {
  const embedding = await generateEmbedding(text);
  if (!embedding) {
    throw new Error(`Failed to generate embedding for ${label}`);
  }
  return embedding;
}

async function main() {
  const args = process.argv.slice(2);
  const inputs = args.length > 0 ? args : DEFAULT_SLUGS;

  if (inputs.length < 2) {
    console.error('Provide two slugs or IDs to compare.');
    process.exit(1);
  }

  const [inputA, inputB] = inputs;
  const eventA = await getEventByInput(inputA);
  const eventB = await getEventByInput(inputB);

  if (!eventA || !eventB) {
    console.error('Failed to load both events.');
    console.log('Event A found:', !!eventA);
    console.log('Event B found:', !!eventB);
    process.exit(1);
  }

  const textA = buildEmbeddingString(eventA);
  const textB = buildEmbeddingString(eventB);

  console.log('Embedding text A:', textA);
  console.log('Embedding text B:', textB);

  const embeddingA = await embedText('A', textA);
  const embeddingB = await embedText('B', textB);

  const similarity = cosineSimilarity(embeddingA, embeddingB);
  console.log(`\nSimilarity (A vs B): ${similarity.toFixed(4)}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
