import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import { env } from "../config/env";

interface EventImagePromptData {
  title: string;
  description?: string | null;
  location?: string | null;
  tags?: string[];
}

// Compression settings - JPEG at 80% quality, resize to 512px width
const COMPRESS_QUALITY = 80;
const COMPRESS_WIDTH = 512;

let _imageGenAI: GoogleGenerativeAI | null = null;

// Model name for image generation - configurable via env var
// Options: "gemini-2.5-flash-image" (recommended, best quality)
//          "gemini-2.0-flash-exp" (older, experimental)
const IMAGE_MODEL = env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

function getImageModel() {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  if (!_imageGenAI) {
    _imageGenAI = new GoogleGenerativeAI(apiKey);
  }

  // Use the configured image generation model
  return _imageGenAI.getGenerativeModel({
    model: IMAGE_MODEL,
    generationConfig: {
      // @ts-expect-error - responseModalities is supported but not typed in the SDK
      responseModalities: ["Text", "Image"],
    },
  });
}

function buildImagePrompt(event: EventImagePromptData): string {
  const tagContext = event.tags?.length ? `Tags: ${event.tags.join(", ")}` : "";
  const locationContext = event.location || "Asheville, NC";

  // Build a descriptive prompt for the event
  return `Create a visually appealing promotional image for this event:

Title: ${event.title}
${event.description ? `Description: ${event.description.slice(0, 200)}` : ""}
Location: ${locationContext}
${tagContext}

Style guidelines:
- Create a modern, eye-catching event promotional graphic
- Use vibrant colors that match the event theme
- The image should feel welcoming and professional
- Include visual elements that represent the event type (music notes for concerts, food for dining events, etc.)
- Asheville, NC mountain/artistic vibe when appropriate
- Do NOT include any text in the image - only visual elements
- Make it suitable for an event listing card/thumbnail

Generate an image only, no text response needed.`;
}

export async function generateEventImage(
  event: EventImagePromptData
): Promise<string | null> {
  const model = getImageModel();

  if (!model) {
    console.log("[ImageGen] Gemini API key not configured, skipping image generation");
    return null;
  }

  const prompt = buildImagePrompt(event);

  try {
    console.log(`[ImageGen] Generating image for: ${event.title}`);
    const result = await model.generateContent(prompt);
    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts || [];

    // Find the image part in the response
    for (const part of parts) {
      if (part.inlineData?.data) {
        const { data } = part.inlineData;
        const originalBuffer = Buffer.from(data, "base64");
        const originalSize = originalBuffer.length;

        // Compress with sharp: resize to 512px width, convert to JPEG at 80% quality
        const compressedBuffer = await sharp(originalBuffer)
          .resize(COMPRESS_WIDTH, null, { withoutEnlargement: true })
          .jpeg({ quality: COMPRESS_QUALITY })
          .toBuffer();

        const compressedSize = compressedBuffer.length;
        const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

        const compressedBase64 = compressedBuffer.toString("base64");
        const dataUrl = `data:image/jpeg;base64,${compressedBase64}`;

        console.log(
          `[ImageGen] Generated image for: ${event.title} ` +
          `(${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB, -${compressionRatio}%)`
        );
        return dataUrl;
      }
    }

    console.log(`[ImageGen] No image returned for: ${event.title}`);
    return null;
  } catch (error) {
    console.error(`[ImageGen] Error generating image for "${event.title}":`, error);
    return null;
  }
}

export function isImageGenerationEnabled(): boolean {
  return !!env.GEMINI_API_KEY;
}
