import 'dotenv/config';
import { cosineSimilarity, generateEmbedding } from '../lib/ai/embedding';

const TEXT_A =
  'AI Hacks and Hops - Exploring practical AI use cases for nontechnical professionals through short talks, group discussions, and casual beer-friendly networking.';
const TEXT_B =
  'Mashup Mondays w/JLloyd - Featuring rotating guest DJs delivering genre-blending mashups across funk, soul, afrobeat, reggae, and breakbeat.';

async function main() {
  console.log('Embedding text A:', TEXT_A);
  console.log('Embedding text B:', TEXT_B);

  const embeddingA = await generateEmbedding(TEXT_A);
  const embeddingB = await generateEmbedding(TEXT_B);

  if (!embeddingA || !embeddingB) {
    console.error('Failed to generate one or both embeddings.');
    process.exit(1);
  }

  const similarity = cosineSimilarity(embeddingA, embeddingB);
  console.log(`\nSimilarity (A vs B): ${similarity.toFixed(4)}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
