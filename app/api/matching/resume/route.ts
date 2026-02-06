import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getModel, isAIEnabled } from '@/lib/ai/provider-clients';

export const runtime = 'nodejs';

const MAX_RESUME_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_MARKDOWN_LENGTH = 20000;

function normalizeResumeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAIEnabled()) {
      return NextResponse.json(
        { error: 'PDF parsing is not available. Please paste your resume text manually.' },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing resume file' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
    }

    if (file.size > MAX_RESUME_SIZE) {
      return NextResponse.json({ error: 'Resume exceeds 10 MB limit' }, { status: 400 });
    }

    const model = getModel();
    if (!model) {
      return NextResponse.json(
        { error: 'PDF parsing is not available. Please paste your resume text manually.' },
        { status: 503 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data,
        },
      },
      {
        text: 'Convert this PDF document to clean, well-structured markdown. Preserve the document structure including headings, lists, bold/italic text, and sections. Output ONLY the markdown content, nothing else.',
      },
    ]);

    const rawText = result.response.text() || '';
    let markdown = normalizeResumeMarkdown(rawText);
    let truncated = false;

    if (markdown.length > MAX_MARKDOWN_LENGTH) {
      markdown = markdown.slice(0, MAX_MARKDOWN_LENGTH);
      truncated = true;
    }

    return NextResponse.json({ markdown, truncated });
  } catch (error) {
    console.error('Error parsing resume PDF:', error);
    return NextResponse.json(
      { error: 'Failed to parse resume. Please try pasting your resume text manually.' },
      { status: 500 }
    );
  }
}
