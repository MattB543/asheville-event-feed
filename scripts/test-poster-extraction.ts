/**
 * Test poster extraction against a local image.
 *
 * Normalizes the image the same way the upload route will (auto-rotate from
 * EXIF, resize to 2048px, JPEG q85), sends it to the vision model, and prints
 * the parsed result. On failure it prints the raw model output so the prompt
 * can be tuned against real photos.
 *
 * Run with: npx tsx scripts/test-poster-extraction.ts <image-path> [...more]
 *           GEMINI_VISION_MODEL=gemini-2.5-flash npx tsx scripts/... <path>
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import { extractPostersFromImage } from '../lib/ai/posterExtraction';
import { DEFAULT_GEMINI_VISION_MODEL } from '../lib/ai/provider-clients';
import { env } from '../lib/config/env';
import { parseAsEastern } from '../lib/utils/timezone';

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 85;

async function normalize(imagePath: string): Promise<{ buffer: Buffer; summary: string }> {
  const raw = readFileSync(imagePath);
  const metadata = await sharp(raw).metadata();

  const buffer = await sharp(raw)
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const outMeta = await sharp(buffer).metadata();
  const summary =
    `${metadata.width}x${metadata.height} → ${outMeta.width}x${outMeta.height} | ` +
    `${(raw.length / 1024).toFixed(0)} KB → ${(buffer.length / 1024).toFixed(0)} KB`;

  return { buffer, summary };
}

async function testImage(imagePath: string): Promise<boolean> {
  console.log('='.repeat(70));
  console.log(imagePath);
  console.log('='.repeat(70));

  const { buffer, summary } = await normalize(imagePath);
  console.log(`Normalized: ${summary}`);

  const startTime = Date.now();
  const outcome = await extractPostersFromImage(buffer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!outcome.ok) {
    console.error(`\nFAILED after ${elapsed}s (blocked: ${outcome.blocked})`);
    console.error(outcome.error);
    if (outcome.raw) {
      console.error('-'.repeat(70));
      console.error(outcome.raw);
      console.error('-'.repeat(70));
    }
    return false;
  }

  const { result, raw } = outcome;
  console.log(`\nExtracted in ${elapsed}s`);
  console.log(
    `Safety: inappropriateForMinors=${result.inappropriateForMinors}` +
      (result.safetyReason ? ` (${result.safetyReason})` : '')
  );
  console.log(
    `Adult:  adultOriented=${result.adultOriented}` +
      (result.adultReason ? ` (${result.adultReason})` : '')
  );
  console.log(`Posters: ${Array.isArray(result.posters) ? result.posters.length : 'NOT AN ARRAY'}`);
  console.log('-'.repeat(70));
  console.log(JSON.stringify(result, null, 2));
  console.log('-'.repeat(70));

  // Show what the caller's date conversion would produce, so date quality is
  // visible without running the whole pipeline.
  if (Array.isArray(result.posters)) {
    for (const poster of result.posters) {
      for (const d of poster.dates ?? []) {
        const asDate = parseAsEastern(d.date, d.time ? `${d.time}:00` : '19:00:00');
        console.log(
          `  ${poster.title} → ${d.date} ${d.time ?? '(time unknown)'} → ${asDate.toISOString()}`
        );
      }
    }
  }

  console.log(`\nRaw response length: ${raw.length} chars`);
  return true;
}

async function main() {
  const imagePaths = process.argv.slice(2);

  if (imagePaths.length === 0) {
    console.error('Usage: npx tsx scripts/test-poster-extraction.ts <image-path> [...more]');
    process.exit(1);
  }

  if (!env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set.');
    process.exit(1);
  }

  console.log(`Model: ${env.GEMINI_VISION_MODEL ?? DEFAULT_GEMINI_VISION_MODEL}\n`);

  let allOk = true;
  for (const imagePath of imagePaths) {
    const ok = await testImage(resolve(imagePath));
    allOk = allOk && ok;
    console.log();
  }

  if (!allOk) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
