import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { azureVisionChatCompletion, isAzureAIEnabled } from '@/lib/ai/provider-clients';

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB per image

const BOOKSHELF_SYSTEM_PROMPT = `You are a book identification assistant. The user will send you photos of bookshelves or book stacks.

Your job is to identify every book visible in the images. For each book, provide:
- Title (exact text visible on the spine/cover)
- Author (if visible or if you can confidently identify the book)

Return a JSON object with this structure:
{
  "books": [
    { "title": "Book Title", "author": "Author Name" },
    ...
  ],
  "notes": "Any relevant observations (e.g., books partially obscured, spines not readable)"
}

Rules:
- List books in the order they appear (top to bottom, left to right, across all images)
- If you can see a title but not the author, still include the book with author as null
- If a spine is too obscured to read, mention it in notes but don't guess
- Be precise with titles — use the exact text visible on the spine
- If you recognize a well-known book, you may fill in the author even if not fully visible
- Deduplicate across images — if the same book appears in multiple photos, list it only once`;

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAzureAIEnabled()) {
      return NextResponse.json({ error: 'AI processing is not available' }, { status: 503 });
    }

    const formData = await request.formData();
    const files = formData.getAll('images') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    if (files.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Maximum ${MAX_IMAGES} images allowed` }, { status: 400 });
    }

    // Validate and convert images to base64 data URLs
    const imageDataUrls: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json(
          { error: `Invalid file type: ${file.type}. Only images are accepted.` },
          { status: 400 }
        );
      }

      if (file.size > MAX_IMAGE_SIZE) {
        return NextResponse.json(
          {
            error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`,
          },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const base64 = buffer.toString('base64');
      const mimeType = file.type || 'image/jpeg';
      imageDataUrls.push(`data:${mimeType};base64,${base64}`);
    }

    // Use custom AI prompt from config if provided, otherwise default bookshelf prompt
    const customPrompt = formData.get('aiPrompt') as string | null;
    const systemPrompt = customPrompt || BOOKSHELF_SYSTEM_PROMPT;

    const userPrompt = `I'm uploading ${files.length} photo${files.length > 1 ? 's' : ''} of my books. Please identify all the books you can see across all images.`;

    const result = await azureVisionChatCompletion(systemPrompt, userPrompt, imageDataUrls, {
      maxTokens: 4000,
      detail: 'high',
    });

    if (!result) {
      return NextResponse.json({ error: 'AI processing failed' }, { status: 500 });
    }

    // Parse the JSON response from the AI
    let parsed: { books: { title: string; author: string | null }[]; notes?: string };
    try {
      // Strip markdown code fences if present
      let cleaned = result.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      parsed = JSON.parse(cleaned) as typeof parsed;
    } catch {
      // Log raw AI output server-side for debugging, don't expose to client
      console.error(
        '[Bookshelf Vision] AI response was not valid JSON. Raw output:',
        result.content?.substring(0, 500)
      );
      return NextResponse.json({
        books: [],
        parseError: true,
        notes: 'The AI could not process the images into a structured response. Please try again.',
        usage: result.usage,
      });
    }

    return NextResponse.json({
      books: parsed.books || [],
      notes: parsed.notes || null,
      usage: result.usage,
    });
  } catch (error) {
    console.error('Error transcribing bookshelf images:', error);
    return NextResponse.json({ error: 'Failed to process images' }, { status: 500 });
  }
}
