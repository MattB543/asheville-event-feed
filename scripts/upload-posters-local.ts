/**
 * Run local image files through the full poster upload pipeline.
 *
 * Same code path as POST /api/posters/upload (normalize -> dedupe -> extract ->
 * publish or flag -> promote to events), minus auth and multipart parsing, so
 * seeding the wall from a folder of photos does not require a browser session.
 *
 * Run with: npx tsx scripts/upload-posters-local.ts <image-or-directory> [...more]
 *           POSTER_USER_ID=<uuid> npx tsx scripts/upload-posters-local.ts ...
 *
 * The uploads are attributed to POSTER_USER_ID, falling back to SUPER_ADMIN.
 */

import 'dotenv/config';
import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, resolve } from 'path';
import { processPosterUpload } from '../lib/posters/processUpload';
import { env } from '../lib/config/env';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif']);

/** Expand directories one level into the image files they hold. */
function collectImages(paths: string[]): string[] {
  const files: string[] = [];

  for (const path of paths) {
    const absolute = resolve(path);

    if (statSync(absolute).isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) {
        if (IMAGE_EXTENSIONS.has(extname(entry).toLowerCase())) files.push(join(absolute, entry));
      }
      continue;
    }

    files.push(absolute);
  }

  return files;
}

async function main() {
  const inputs = process.argv.slice(2);

  if (inputs.length === 0) {
    console.error('Usage: npx tsx scripts/upload-posters-local.ts <image-or-directory> [...more]');
    process.exit(1);
  }

  const userId = process.env.POSTER_USER_ID ?? env.SUPER_ADMIN;
  if (!userId) {
    console.error('Set POSTER_USER_ID (or SUPER_ADMIN) to the Supabase auth UUID to upload as.');
    process.exit(1);
  }

  const images = collectImages(inputs);
  console.log(`Uploading ${images.length} image(s) as ${userId}\n`);

  let failures = 0;

  for (const imagePath of images) {
    const buffer = readFileSync(imagePath);
    const label = `${imagePath} (${(buffer.length / 1024).toFixed(0)} KB)`;

    process.stdout.write(`${label}\n`);

    try {
      const result = await processPosterUpload({ userId, buffer });

      switch (result.kind) {
        case 'ok':
          console.log(`  ${result.status}${result.capped ? ' (capped)' : ''} — ${result.uploadId}`);
          for (const extraction of result.extractions) {
            const when = extraction.startDate
              ? extraction.startDate.toISOString().slice(0, 16).replace('T', ' ')
              : 'no date';
            console.log(`    • ${extraction.title} [${when}] -> ${extraction.outcome ?? 'held'}`);
          }
          if (result.promotionError) console.warn(`  ! ${result.promotionError}`);
          break;

        case 'duplicate':
          console.log(`  duplicate of ${result.uploadId} (${result.status})`);
          break;

        default:
          failures++;
          console.error(`  ${result.kind}: ${'message' in result ? result.message : ''}`);
      }
    } catch (error) {
      failures++;
      console.error(`  threw: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log();
  }

  console.log(`Done. ${images.length - failures}/${images.length} processed without error.`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
