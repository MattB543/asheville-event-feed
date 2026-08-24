/**
 * Poster Extraction via Gemini Vision
 *
 * Takes a photo of one or more event posters (an official digital poster, a
 * phone shot of a flyer, or a crowded bulletin board) and returns one
 * structured record per poster plus two independent assessments of the whole
 * image: is it unsafe for a 13-year-old, and is it an adult-audience event.
 *
 * The prompt is server-owned: no caller-supplied text ever reaches the model.
 */

import { FinishReason } from '@google/generative-ai';
import { getTodayStringEastern } from '@/lib/utils/timezone';
import { getVisionModel, parseJsonFromModel } from './provider-clients';

/** Hard caps, mirrored in the prompt so the model self-limits. */
export const MAX_POSTERS_PER_IMAGE = 12;
export const MAX_DATES_PER_POSTER = 6;

/**
 * A single printed date on a poster.
 *
 * These stay strings on purpose. Converting to a timestamp is the CALLER's job:
 * `parseAsEastern(d.date, d.time ?? '19:00:00')` from `lib/utils/timezone.ts`
 * (DST-correct ET -> UTC, and 19:00 is the repo's convention for unknown
 * times). Keeping it out of this module means the model layer never has to
 * know about the event schema's timezone rules.
 */
export interface ExtractedPosterDate {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:mm" 24h, or null when the poster prints no start time => timeUnknown */
  time: string | null;
}

export interface ExtractedPoster {
  title: string;
  /** Verbatim transcription of this poster's text */
  rawText: string;
  /** [] if no parseable date; one entry per printed date (max MAX_DATES_PER_POSTER) */
  dates: ExtractedPosterDate[];
  location: string | null;
  organizer: string | null;
  description: string | null;
  /** Exactly as written ("Free", "$10", "Sliding scale $5-20") */
  price: string | null;
  /** For the NC check; not stored */
  city: string | null;
  state: string | null;
}

export interface PosterExtractionResult {
  inappropriateForMinors: boolean;
  safetyReason: string | null;
  /**
   * Deliberately separate from `inappropriateForMinors`: a 21+ club night is an
   * adult-audience event without being unsafe content, and calling it unsafe
   * would leave the moderation queue unable to tell the two apart.
   */
  adultOriented: boolean;
  adultReason: string | null;
  posters: ExtractedPoster[];
}

/**
 * Candidate finish reasons that mean "the model refused this image", as
 * opposed to a genuine failure. All of them route the upload to human review.
 */
const REFUSAL_FINISH_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  // The SDK's response.text() also throws on these two, so without them here
  // a refusal would surface as a generic failure instead of a review item.
  // RECITATION is plausible for verbatim poster transcription.
  FinishReason.RECITATION,
  FinishReason.LANGUAGE,
]);

export type PosterExtractionOutcome =
  | { ok: true; result: PosterExtractionResult; raw: string }
  // `raw` is present only when the model actually answered and the answer
  // failed to parse - that text is the sole record of what went wrong, and
  // the caller persists it as `poster_uploads.rawModelOutput`.
  | { ok: false; blocked: boolean; error: string; raw?: string };

/**
 * Build the extraction prompt. Today's date is injected so the model can
 * resolve year-less dates ("Sat Nov 8") to the next future occurrence.
 */
function buildPrompt(todayEastern: string): string {
  return `You are an event-poster reader for a local events site in Asheville, North Carolina. Today's date is ${todayEastern} (Eastern Time).

The image is a photo of one or more event posters. It may be a single clean digital poster, a phone photo of a flyer, or a crowded bulletin board covered in overlapping posters. Identify EVERY distinct event poster in the image. Ignore graffiti, stickers, business cards, menus, notices, and any other non-event signage. Return at most ${MAX_POSTERS_PER_IMAGE} posters.

For each poster, transcribe its text verbatim into "rawText", then fill in the structured fields from that text.

Rules for the structured fields:
- Use null for anything the poster does not state. Never invent, infer, or complete a detail that is not printed on the poster.
- "title": the event name as printed.
- "location": the venue name and/or street address as printed.
- "organizer": the presenting group, promoter, or host as printed.
- "description": a short factual summary drawn only from the poster's own text.
- "price": exactly as written ("Free", "$10", "$15 adv / $20 door", "Sliding scale $5-20").
- "city" and "state": only if printed or unambiguous from the venue text.

Rules for dates:
- "date" is "YYYY-MM-DD" and "time" is "HH:mm" in 24-hour form, or null when no start time is printed.
- When the year is absent, resolve the date to the next future occurrence relative to today (this may fall in the next calendar year).
- Exception - stale flyers: if the poster's own text contradicts that future date (a printed weekday that does not match it, a printed past year, or wording implying the event already happened), return the most recent PAST date matching the printed evidence instead (use the current year when nothing pins it further). Never invent a future occurrence for a stale flyer.
- If the poster prints several specific dates ("Jan 5 & 12", "Fri-Sat Mar 3-4"), return one entry per date, at most ${MAX_DATES_PER_POSTER}.
- Open-ended recurrence ("every Tuesday", "monthly") collapses to the next single occurrence only.
- If no date can be read at all, return an empty "dates" array.

Safety assessment for the image as a whole: set "inappropriateForMinors" to true if the image contains content inappropriate for a 13-year-old - nudity or sexual content, graphic violence or gore, hard drug use, or hate symbols. Err toward flagging. When true, put a one-sentence explanation in "safetyReason"; otherwise "safetyReason" is null.

Adult-audience assessment for the image as a whole - a separate question from safety, judged independently: set "adultOriented" to true if this is an event for adults rather than a general audience. Flag it when the poster prints an age restriction (18+, 21+, 30+), when it markets nightlife or a party as the product (club night, bottle service, "grown & sexy", bar crawl, day drinking), when the event is adult entertainment (burlesque, drag after dark, adult comedy, anything strip-club adjacent), when it promotes cannabis or drinking as the draw, or when the artwork's selling point is sexualized imagery - lingerie, swimwear, or suggestive poses - even if it stops short of the safety bar above. A concert, show, or dinner at a venue that happens to serve alcohol is NOT adult-oriented on that basis alone. When true, put a one-sentence explanation in "adultReason"; otherwise "adultReason" is null.

Respond with strict JSON only - no markdown fences, no commentary - matching exactly this shape:
{
  "inappropriateForMinors": false,
  "safetyReason": null,
  "adultOriented": false,
  "adultReason": null,
  "posters": [
    {
      "title": "...",
      "rawText": "...",
      "dates": [{ "date": "YYYY-MM-DD", "time": "HH:mm" }],
      "location": null,
      "organizer": null,
      "description": null,
      "price": null,
      "city": null,
      "state": null
    }
  ]
}`;
}

/**
 * Run poster extraction on a normalized JPEG buffer.
 *
 * Callers are expected to have already run the image through sharp
 * (`.rotate().resize(2048, 2048, ...).jpeg(...)`) - this sends the buffer as-is
 * and declares it as image/jpeg.
 *
 * Returns `{ ok: false, blocked: true }` when Gemini's safety filter refuses
 * the image, which is a moderation signal rather than an error: the caller
 * routes those uploads to human review instead of surfacing a failure.
 */
export async function extractPostersFromImage(
  imageBuffer: Buffer
): Promise<PosterExtractionOutcome> {
  const model = getVisionModel();
  if (!model) {
    return {
      ok: false,
      blocked: false,
      error: 'Vision model is not configured (GEMINI_API_KEY is missing).',
    };
  }

  let raw: string;

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: imageBuffer.toString('base64'),
        },
      },
      { text: buildPrompt(getTodayStringEastern()) },
    ]);

    const response = result.response;

    // Gemini reports safety refusals two different ways, and neither throws:
    // a prompt-level block (nothing was generated) and a candidate-level
    // SAFETY finish. `response.text()` throws on the first, so check both
    // before touching it.
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      return { ok: false, blocked: true, error: `Gemini blocked the image: ${blockReason}` };
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && REFUSAL_FINISH_REASONS.has(finishReason)) {
      return {
        ok: false,
        blocked: true,
        error: `Gemini stopped generation: ${finishReason}`,
      };
    }

    raw = response.text() || '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, blocked: false, error: `Vision request failed: ${message}` };
  }

  if (!raw.trim()) {
    return { ok: false, blocked: false, error: 'Vision model returned an empty response.' };
  }

  const parsed = parseJsonFromModel<PosterExtractionResult>(raw, 'object');
  if (!parsed) {
    return {
      ok: false,
      blocked: false,
      error: 'Could not parse JSON from the model response.',
      raw,
    };
  }

  return { ok: true, result: parsed, raw };
}
