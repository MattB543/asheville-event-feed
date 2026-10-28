/**
 * Azure OpenAI Responses API (v1) helper, for calls that need the `web_search` tool.
 *
 * The app's Azure client (`lib/ai/provider-clients.ts`) is Chat Completions on the versioned
 * `/openai` base, which has no web search. This posts to the v1 endpoint that the 2026-10-28 probe
 * used (plan §2.5): Batch-AI, `gpt-6.1-sol`, `reasoning: { effort }` (not `reasoning_effort`).
 * The key is the Windows user env var AZURE_OPENAI_API_KEY.
 */

const DEFAULT_BASE_URL = 'https://batch-ai.services.ai.azure.com/openai/v1';
const DEFAULT_MODEL = 'gpt-6.1-sol';
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;
const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const ATTEMPTS = 3;

export interface ResponsesRequest {
  input: string;
  instructions?: string;
  model?: string;
  webSearch?: boolean;
  effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  /** A strict JSON schema for the final message. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface UrlCitation {
  url: string;
  title?: string;
}

export interface ResponsesResult {
  text: string;
  citations: UrlCitation[];
  /** The queries (or opened pages) of each web_search_call, in order. */
  searches: string[];
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  status: string;
  ms: number;
  model: string;
}

interface RawOutputItem {
  type: string;
  action?: { type?: string; query?: string; url?: string };
  content?: Array<{
    type: string;
    text?: string;
    annotations?: Array<{ type: string; url?: string; title?: string }>;
  }>;
}

interface RawResponse {
  status?: string;
  model?: string;
  output?: RawOutputItem[];
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string } | null;
}

export async function createResponse(request: ResponsesRequest): Promise<ResponsesResult> {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) throw new Error('AZURE_OPENAI_API_KEY is not set');
  const baseUrl = process.env.AZURE_RESPONSES_BASE_URL ?? DEFAULT_BASE_URL;
  const model = request.model ?? DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    model,
    input: request.input,
    reasoning: { effort: request.effort ?? 'low' },
  };
  if (request.instructions) body.instructions = request.instructions;
  if (request.webSearch) body.tools = [{ type: 'web_search' }];
  if (request.maxOutputTokens) body.max_output_tokens = request.maxOutputTokens;
  if (request.jsonSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: request.jsonSchema.name,
        schema: request.jsonSchema.schema,
        strict: true,
      },
    };
  }

  const started = Date.now();
  let lastError = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response: Response;
    let raw: string;
    try {
      response = await fetch(`${baseUrl}/responses`, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      // Reading the body can time out or disconnect too; that's a transport error, so retry.
      raw = await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < ATTEMPTS) await sleep(5000 * attempt);
      continue;
    }

    if (!response.ok) {
      lastError = `HTTP ${response.status}: ${raw.slice(0, 500)}`;
      if (RETRY_STATUSES.has(response.status) && attempt < ATTEMPTS) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      throw new Error(`Responses API ${lastError}`);
    }

    const json = JSON.parse(raw) as RawResponse;
    if (json.error?.message) throw new Error(`Responses API error: ${json.error.message}`);
    return toResult(json, model, Date.now() - started);
  }
  throw new Error(`Responses API failed after ${ATTEMPTS} attempts: ${lastError}`);
}

function toResult(json: RawResponse, model: string, ms: number): ResponsesResult {
  const texts: string[] = [];
  const citations: UrlCitation[] = [];
  const searches: string[] = [];

  for (const item of json.output ?? []) {
    if (item.type === 'web_search_call') {
      const action = item.action;
      searches.push(action?.query ?? (action?.url ? `open ${action.url}` : (action?.type ?? '?')));
    }
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) texts.push(part.text);
      for (const annotation of part.annotations ?? []) {
        if (annotation.type === 'url_citation' && annotation.url) {
          citations.push({ url: annotation.url, title: annotation.title });
        }
      }
    }
  }

  return {
    text: texts.join('\n'),
    citations,
    searches,
    usage: {
      inputTokens: json.usage?.input_tokens ?? 0,
      cachedInputTokens: json.usage?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      reasoningTokens: json.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    },
    status: json.incomplete_details?.reason
      ? `incomplete:${json.incomplete_details.reason}`
      : (json.status ?? 'unknown'),
    ms,
    model: json.model ?? model,
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60000);
  return 10000 * attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
