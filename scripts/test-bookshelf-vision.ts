/**
 * Test Azure GPT-5.2 vision with bookshelf images.
 * Resizes images to max 2048px, compresses to JPEG q85, sends both in one call.
 *
 * Run with: npx tsx scripts/test-bookshelf-vision.ts
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { AzureOpenAI } from 'openai';

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 85;

async function compressImage(
  imagePath: string
): Promise<{ base64: string; originalSize: string; compressedSize: string; dimensions: string }> {
  const raw = readFileSync(imagePath);
  const originalSize = `${(raw.length / 1024).toFixed(0)} KB`;

  // Get original dimensions
  const metadata = await sharp(raw).metadata();
  const origW = metadata.width || 0;
  const origH = metadata.height || 0;

  // Resize so longest side <= MAX_DIMENSION, then compress to JPEG
  const compressed = await sharp(raw)
    .resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const compressedMeta = await sharp(compressed).metadata();
  const compressedSize = `${(compressed.length / 1024).toFixed(0)} KB`;
  const dimensions = `${origW}x${origH} → ${compressedMeta.width}x${compressedMeta.height}`;

  const base64 = compressed.toString('base64');
  return { base64, originalSize, compressedSize, dimensions };
}

async function testBookshelfVision() {
  // Check Azure config
  const apiKey =
    process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_API_KEY || process.env.AZURE_KEY_1;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

  if (!apiKey || !endpoint) {
    console.error(
      'Azure OpenAI not configured. Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT.'
    );
    process.exit(1);
  }

  console.log(`Deployment: ${deployment}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`API Version: ${apiVersion}\n`);

  // Load and compress images
  const imageDir = join(process.cwd(), 'claude');
  const imagePaths = [join(imageDir, 'books (1).jpg'), join(imageDir, 'books (2).jpg')];

  console.log('Compressing images...');
  const images = await Promise.all(imagePaths.map(compressImage));

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    console.log(
      `  Image ${i + 1}: ${img.dimensions} | ${img.originalSize} → ${img.compressedSize}`
    );
  }

  // Build the vision request
  const client = new AzureOpenAI({
    apiKey,
    endpoint,
    apiVersion,
    deployment,
  });

  const systemPrompt = `You are a book identification assistant. The user will send you photos of bookshelves or book stacks.

Your job is to identify every book visible in the images. For each book, provide:
- Title
- Author (if visible or you can identify the book)

Return a JSON object with this structure:
{
  "books": [
    { "title": "Book Title", "author": "Author Name" },
    ...
  ],
  "notes": "Any relevant observations (e.g., books partially obscured, spines not readable)"
}

Rules:
- List books in the order they appear (top to bottom, left to right)
- If you can see a title but not the author, still include the book with author as null
- If a spine is too obscured to read, mention it in notes but don't guess
- Be precise with titles — use the exact text visible on the spine
- If you recognize a well-known book, you may fill in the author even if not fully visible`;

  const userContent = [
    {
      type: 'text' as const,
      text: `I'm uploading ${images.length} photos of my books. Please identify all the books you can see across all images.`,
    },
    ...images.map((img) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:image/jpeg;base64,${img.base64}`,
        detail: 'high' as const,
      },
    })),
  ];

  console.log('\nSending to Azure GPT-5.2 (detail: high)...\n');
  const startTime = Date.now();

  try {
    const response = await client.chat.completions.create({
      model: deployment,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: 4000,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const content = response.choices[0]?.message?.content || '';
    const usage = response.usage;

    console.log(`Response (${elapsed}s):`);
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
    console.log(
      `\nTokens: ${usage?.prompt_tokens} input, ${usage?.completion_tokens} output, ${usage?.total_tokens} total`
    );
    console.log(`Finish reason: ${response.choices[0]?.finish_reason}`);
  } catch (error: unknown) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`Failed after ${elapsed}s\n`);
    if (error instanceof Error) {
      console.error('Error:', error.message);
      // Log full error for debugging
      if ('status' in error) {
        console.error('Status:', (error as Record<string, unknown>).status);
      }
    } else {
      console.error('Error:', error);
    }
    process.exit(1);
  }
}

testBookshelfVision();
