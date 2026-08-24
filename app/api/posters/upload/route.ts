import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  DAILY_UPLOAD_QUOTA,
  processPosterUpload,
  type ProcessedExtraction,
} from '@/lib/posters/processUpload';

// sharp is a native binary, so this route cannot run on the edge.
export const runtime = 'nodejs';

// One vision call plus up to 20 embeddings and inserts run inline, and a single
// embedding can wait 30s. Non-cron routes get the platform default unless they
// say otherwise; 800 matches the cron jobs (requires Fluid Compute).
export const maxDuration = 800;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// A cheap gate, not the real check. The client falls back to sending the
// ORIGINAL file when canvas cannot decode it (HEIC from iOS), and those arrive
// as image/heif, application/octet-stream, or with no type at all. The
// authoritative test is sharp's probe of the decoded bytes in normalizeImage
// (jpeg/png/webp/heif plus a pixel cap), so accepting these here costs nothing
// while still turning away obviously-wrong types.
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/octet-stream',
  '',
]);

function serializeExtraction(extraction: ProcessedExtraction) {
  return {
    title: extraction.title,
    startDate: extraction.startDate ? extraction.startDate.toISOString() : null,
    outcome: extraction.outcome,
    eventSlug: extraction.eventSlug,
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Sign in to upload posters' }, { status: 401 });
    }

    const formData = await request.formData();
    const files = formData.getAll('image').filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    if (files.length > 1) {
      return NextResponse.json({ error: 'Upload one image at a time' }, { status: 400 });
    }

    const file = files[0];

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type || 'unknown'}. Use JPEG, PNG, WEBP or HEIC.` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`,
        },
        { status: 400 }
      );
    }

    const result = await processPosterUpload({
      userId: user.id,
      buffer: Buffer.from(await file.arrayBuffer()),
    });

    switch (result.kind) {
      case 'quota_exceeded':
        return NextResponse.json(
          { error: `Upload limit reached (${DAILY_UPLOAD_QUOTA} per day). Try again tomorrow.` },
          { status: 429 }
        );

      case 'invalid_image':
        return NextResponse.json({ error: result.message }, { status: 400 });

      case 'duplicate':
        return NextResponse.json(
          {
            duplicateOf: result.uploadId,
            status: result.status,
            message: 'This poster was already uploaded.',
          },
          { status: 200 }
        );

      case 'no_posters':
        return NextResponse.json(
          { uploadId: result.uploadId, status: 'failed', error: result.message },
          { status: 422 }
        );

      case 'failed':
        return NextResponse.json(
          { uploadId: result.uploadId, status: 'failed', error: result.message },
          { status: 502 }
        );

      case 'ok':
        return NextResponse.json(
          {
            uploadId: result.uploadId,
            status: result.status,
            capped: result.capped,
            ...(result.promotionError ? { warning: result.promotionError } : {}),
            extractions: result.extractions.map(serializeExtraction),
          },
          { status: 201 }
        );
    }
  } catch (error) {
    console.error('[Posters] Upload failed:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}
