import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getModel, isAIEnabled } from '@/lib/ai/provider-clients';
import { isNumberArray, isRecord, isString } from '@/lib/utils/validation';
import { getDocumentProxy } from 'unpdf';

export const runtime = 'nodejs';

const MAX_RESUME_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_MARKDOWN_LENGTH = 20000;

interface ExtractedLink {
  url: string;
  anchorText: string;
}

interface PdfLinkAnnotation {
  subtype: 'Link';
  url: string;
  rect: number[];
}

interface PdfTextItem {
  str: string;
  transform: number[];
}

function normalizeResumeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isPdfLinkAnnotation(value: unknown): value is PdfLinkAnnotation {
  return (
    isRecord(value) &&
    value.subtype === 'Link' &&
    isString(value.url) &&
    isNumberArray(value.rect) &&
    value.rect.length >= 4
  );
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  return (
    isRecord(value) &&
    isString(value.str) &&
    isNumberArray(value.transform) &&
    value.transform.length >= 6
  );
}

/**
 * Extract hyperlinks from a PDF along with their anchor text.
 * Uses the raw pdfjs-dist API via unpdf's getDocumentProxy to read
 * link annotations and correlate them with overlapping text items.
 */
async function extractLinksWithAnchors(pdfData: Uint8Array): Promise<ExtractedLink[]> {
  try {
    const pdf = await getDocumentProxy(pdfData);
    const seenUrls = new Map<string, ExtractedLink>();

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const rawAnnotations: unknown = await page.getAnnotations();
      const rawTextContent: unknown = await page.getTextContent();
      const annotations = Array.isArray(rawAnnotations) ? rawAnnotations : [];
      const textItems =
        isRecord(rawTextContent) && Array.isArray(rawTextContent.items) ? rawTextContent.items : [];

      for (const annotation of annotations) {
        if (!isPdfLinkAnnotation(annotation)) continue;

        const url = annotation.url;
        if (seenUrls.has(url)) continue;

        // annotation.rect is [x1, y1, x2, y2] in PDF coordinate space (origin bottom-left)
        const [rectX1, rectY1, rectX2, rectY2] = annotation.rect;
        const MARGIN = 2;

        // Find text items whose position falls within the annotation rect
        const overlappingTexts: string[] = [];
        for (const item of textItems) {
          // Skip non-text items (e.g. marked content items)
          if (!isPdfTextItem(item)) continue;
          const textItem = item;
          if (!textItem.str.trim()) continue;

          const textX = textItem.transform[4];
          const textY = textItem.transform[5];

          if (
            textX >= rectX1 - MARGIN &&
            textX <= rectX2 + MARGIN &&
            textY >= rectY1 - MARGIN &&
            textY <= rectY2 + MARGIN
          ) {
            overlappingTexts.push(textItem.str.trim());
          }
        }

        const anchorText = overlappingTexts.length > 0 ? overlappingTexts.join(' ') : url;

        seenUrls.set(url, { url, anchorText });
      }
    }

    return Array.from(seenUrls.values());
  } catch (err) {
    console.warn('extractLinksWithAnchors failed, proceeding without links:', err);
    return [];
  }
}

/**
 * Strip hallucinated URLs from Gemini-generated markdown.
 * Gemini sees blue underlined text in PDFs and invents plausible-looking URLs
 * that are completely fake. Only URLs in the allowedUrls set are kept.
 *
 * - `[text](url)` where url is NOT in allowedUrls → replace with just `text`
 * - `[text](url)` where url IS in allowedUrls → keep as-is
 * - Bare URLs on their own line that are NOT in allowedUrls → removed
 * - Bare URLs on their own line that ARE in allowedUrls → kept
 */
function stripHallucinatedUrls(markdown: string, allowedUrls: Set<string>): string {
  // Replace markdown links [text](url) — only strip if url is not allowed
  let result = markdown.replace(
    /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    (_match: string, text: string, url: string) => {
      return allowedUrls.has(url) ? `[${text}](${url})` : text;
    }
  );

  // Remove bare URLs on their own line that are NOT in allowedUrls
  result = result.replace(/^(https?:\/\/\S+)$/gm, (_match: string, url: string) => {
    return allowedUrls.has(url) ? url : '';
  });

  // Clean up any blank lines left behind by bare-URL removal
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
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
    // Copy the buffer upfront — getDocumentProxy detaches the underlying ArrayBuffer
    const pdfData = new Uint8Array(arrayBuffer);
    const pdfDataCopy = new Uint8Array(pdfData);

    // Step 1: Extract links WITH anchor text from the PDF first (may detach arrayBuffer)
    const extractedLinks = await extractLinksWithAnchors(pdfData);
    const allowedUrls = new Set(extractedLinks.map((l) => l.url));

    // Step 2: Single Gemini call with extracted links in context
    const base64Data = Buffer.from(pdfDataCopy).toString('base64');

    let promptText =
      'Convert this PDF document to clean, well-structured markdown. Preserve the document structure including headings, lists, bold/italic text, and sections.';

    if (extractedLinks.length > 0) {
      const linksList = extractedLinks.map((l) => `- "${l.anchorText}" → ${l.url}`).join('\n');
      promptText +=
        '\n\nThe following hyperlinks were extracted from this PDF. Place them inline in the markdown using [text](url) format where the anchor text appears in the document. Do NOT invent or guess any URLs — only use the URLs provided below. If you cannot determine where a link belongs, place it at the end.\n\nExtracted links:\n' +
        linksList;
    }

    promptText += '\n\nOutput ONLY the markdown content, nothing else.';

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data,
        },
      },
      { text: promptText },
    ]);

    const rawText = result.response.text() || '';

    // Step 3: Safety net — strip any URLs Gemini hallucinated (not in extracted set)
    let markdown = stripHallucinatedUrls(normalizeResumeMarkdown(rawText), allowedUrls);

    // Step 4: Fallback — if any extracted URLs are missing from the final markdown,
    // append them at the end so no real links are lost
    if (extractedLinks.length > 0) {
      const markdownLower = markdown.toLowerCase();
      const missingLinks = extractedLinks.filter(
        (link) => !markdownLower.includes(link.url.toLowerCase())
      );
      if (missingLinks.length > 0) {
        const linksSection = missingLinks.map((l) => `- [${l.anchorText}](${l.url})`).join('\n');
        markdown += '\n\n## Links\n\n' + linksSection;
      }
    }

    let truncated = false;

    if (markdown.length > MAX_MARKDOWN_LENGTH) {
      markdown = markdown.slice(0, MAX_MARKDOWN_LENGTH);
      truncated = true;
    }

    return NextResponse.json({ markdown, truncated });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errName = error instanceof Error ? error.constructor.name : typeof error;
    console.error('Error parsing resume PDF:', {
      name: errName,
      message: errMsg,
      status: error instanceof Error ? (error as Error & { status?: number }).status : undefined,
      code: error instanceof Error ? (error as Error & { code?: string }).code : undefined,
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to parse resume. Please try pasting your resume text manually.' },
      { status: 500 }
    );
  }
}
