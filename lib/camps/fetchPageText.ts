/**
 * Read a camp page (HTML or PDF) as plain text, for quote verification and refresh hashing.
 *
 * A three-step ladder, cheapest first:
 *   1. plain `fetch` with a current Chrome user agent (86 of 92 sheet camps, 2026-10-28);
 *   2. the Chrome TLS fingerprint from `fetchAsChrome` (Cloudflare 403s Node's own handshake);
 *   3. headless patchright, for JS-rendered pages, soft 404s and stubborn challenges.
 * A 404 skips step 2: it is an answer, not a TLS block, but some site builders 404 a plain fetch
 * for pages a browser renders fine, so the browser still gets a look.
 *
 * PDFs (by content type or `%PDF` magic) go through `unpdf`; HTML is reduced to text with cheerio,
 * keeping hidden accordion text, since a model may quote it from a search index.
 * No Jina: it is blocked from Matt's PC (docs/camps/01-context-and-plan.md §2.6).
 */

import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'patchright';
import type { Dispatcher } from 'undici';
import {
  CHALLENGE_TITLE,
  HTML_ACCEPT,
  createChromeDispatcher,
  fetchAsChrome,
} from '@/lib/scrapers/fetchAsChrome';

export type FetchMethod = 'fetch' | 'chrome-tls' | 'browser';

export interface PageLink {
  href: string;
  text: string;
}

export interface PageText {
  url: string;
  finalUrl: string;
  method: FetchMethod;
  status: number;
  kind: 'html' | 'pdf';
  title: string;
  text: string;
  links: PageLink[];
  fetchedAt: string;
  ms: number;
  /** What each rung that didn't succeed returned, e.g. ['fetch: HTTP 403']. */
  attempts: string[];
}

export class FetchPageError extends Error {
  constructor(
    readonly url: string,
    readonly attempts: string[]
  ) {
    super(`Could not read ${url}: ${attempts.join('; ')}`);
  }
}

// A current desktop Chrome. fetchAsChrome's own constant is pinned to Chrome 122 for MountainX.
const MODERN_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 20000;
const BROWSER_NAV_TIMEOUT_MS = 45000;
const BROWSER_SETTLE_MS = 8000;
const BROWSER_CHALLENGE_WAIT_MS = 6000;
// Below this a page is probably a JS shell; let the browser render it.
const THIN_TEXT_CHARS = 300;
const CACHE_DIR = join(tmpdir(), 'avlgo-camps-pages');
const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface RawPage {
  status: number;
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface PageTextFetcherOptions {
  /** Reuse a successful read from disk for this long (default 12h; 0 disables). */
  cacheTtlMs?: number;
  /** Allow the headless browser rung (default true). */
  browser?: boolean;
}

export interface PageTextFetcher {
  get(url: string): Promise<PageText>;
  close(): Promise<void>;
}

/**
 * One fetcher per run: it shares a Chrome dispatcher and (lazily) one browser across pages, and
 * remembers each URL's result in memory, so verifying ten quotes from one page fetches it once.
 */
export function createPageTextFetcher(options: PageTextFetcherOptions = {}): PageTextFetcher {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const allowBrowser = options.browser ?? true;
  const memory = new Map<string, Promise<PageText>>();
  let dispatcherPromise: Promise<Dispatcher> | null = null;
  let browserPromise: Promise<Browser> | null = null;

  async function read(url: string): Promise<PageText> {
    const cached = cacheTtlMs > 0 ? await readCache(url, cacheTtlMs) : null;
    if (cached) return cached;

    const started = Date.now();
    const attempts: string[] = [];
    const finish = async (raw: RawPage, content: Content, method: FetchMethod) => {
      const page: PageText = {
        url,
        finalUrl: raw.finalUrl,
        method,
        status: raw.status,
        fetchedAt: new Date().toISOString(),
        ms: Date.now() - started,
        attempts,
        ...content,
      };
      if (cacheTtlMs > 0) await writeCache(url, page);
      return page;
    };

    // 1. plain fetch
    let skipChromeTls = false;
    try {
      const raw = await plainFetch(url);
      const content = await readContent(raw);
      if (typeof content !== 'string') return await finish(raw, content, 'fetch');
      attempts.push(`fetch: ${content}`);
      skipChromeTls = raw.status === 404 || raw.status === 410 || content.startsWith('thin');
    } catch (error) {
      attempts.push(`fetch: ${describe(error)}`);
    }

    // 2. Chrome TLS fingerprint
    if (!skipChromeTls) {
      try {
        // One dispatcher per fetcher, shared by concurrent reads (assigned before the await).
        dispatcherPromise ??= createChromeDispatcher();
        const dispatcher = await dispatcherPromise;
        const raw = isPdfUrl(url)
          ? await chromeTlsBytes(url, dispatcher)
          : await chromeTlsHtml(url, dispatcher);
        const content = await readContent(raw);
        if (typeof content !== 'string') return await finish(raw, content, 'chrome-tls');
        attempts.push(`chrome-tls: ${content}`);
      } catch (error) {
        attempts.push(`chrome-tls: ${describe(error)}`);
      }
    }

    // 3. headless browser
    if (allowBrowser) {
      try {
        browserPromise ??= launchBrowser();
        const raw = await browserFetch(url, await browserPromise);
        const content = await readContent(raw, { acceptThin: true });
        if (typeof content !== 'string') return await finish(raw, content, 'browser');
        attempts.push(`browser: ${content}`);
      } catch (error) {
        attempts.push(`browser: ${describe(error)}`);
      }
    }

    throw new FetchPageError(url, attempts);
  }

  return {
    get(url: string): Promise<PageText> {
      let pending = memory.get(url);
      if (!pending) {
        pending = read(url);
        memory.set(url, pending);
      }
      return pending;
    },
    async close(): Promise<void> {
      if (dispatcherPromise)
        await (await dispatcherPromise.catch(() => null))?.close().catch(() => {});
      if (browserPromise) await (await browserPromise.catch(() => null))?.close().catch(() => {});
    },
  };
}

/** One-off read; prefer `createPageTextFetcher` for more than one URL. */
export async function fetchPageText(
  url: string,
  options?: PageTextFetcherOptions
): Promise<PageText> {
  const fetcher = createPageTextFetcher(options);
  try {
    return await fetcher.get(url);
  } finally {
    await fetcher.close();
  }
}

// ---------------------------------------------------------------------------
// Rungs
// ---------------------------------------------------------------------------

async function plainFetch(url: string): Promise<RawPage> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': MODERN_CHROME_UA,
      Accept: `${HTML_ACCEPT},application/pdf`,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return {
    status: response.status,
    finalUrl: response.url || url,
    contentType: response.headers.get('content-type') ?? '',
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

async function chromeTlsHtml(url: string, dispatcher: Dispatcher): Promise<RawPage> {
  // fetchAsChrome retries challenges itself and throws on anything but a clean 200.
  const body = await fetchAsChrome(url, HTML_ACCEPT, dispatcher, 'camps');
  const bytes = new TextEncoder().encode(body);
  return { status: 200, finalUrl: url, contentType: 'text/html', bytes };
}

async function chromeTlsBytes(url: string, dispatcher: Dispatcher): Promise<RawPage> {
  const { fetch: undiciFetch } = await import('undici');
  const response = await undiciFetch(url, {
    headers: { 'User-Agent': MODERN_CHROME_UA, Accept: 'application/pdf,*/*' },
    dispatcher,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return {
    status: response.status,
    finalUrl: response.url || url,
    contentType: response.headers.get('content-type') ?? '',
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('patchright');
  return chromium.launch({ headless: true });
}

/**
 * A fresh context per page (a challenged context keeps its Cloudflare cookie, see mountainx.ts),
 * with the browser's own version but without "HeadlessChrome" in the UA, which some Cloudflare
 * rules block outright (see ashevilleparksrec.ts).
 */
async function browserFetch(url: string, browser: Browser): Promise<RawPage> {
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
  const context = await browser.newContext({
    userAgent,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  const download = async (): Promise<RawPage> => {
    const response = await context.request.get(url, { timeout: BROWSER_NAV_TIMEOUT_MS });
    return {
      status: response.status(),
      finalUrl: response.url(),
      contentType: response.headers()['content-type'] ?? '',
      bytes: new Uint8Array(await response.body()),
    };
  };

  try {
    if (isPdfUrl(url)) return await download();

    const page = await context.newPage();
    // The status that counts is the last main-document response: a Cloudflare interstitial
    // answers 403, then the page it clears to answers 200.
    let lastStatus = 0;
    page.on('response', (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
        lastStatus = response.status();
      }
    });

    // A PDF without a .pdf URL starts a download instead of a navigation. Read Chromium's own
    // download (its cookies and challenge clearance), not a second request from Node.
    const downloadEvent = page
      .waitForEvent('download', { timeout: BROWSER_NAV_TIMEOUT_MS })
      .catch(() => null);
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: BROWSER_NAV_TIMEOUT_MS,
      });
    } catch (error) {
      if (!/download/i.test(describe(error))) throw error;
      const started = await downloadEvent;
      const file = await started?.path();
      if (!started || !file) return await download();
      const bytes = new Uint8Array(await readFile(file));
      // Where the download really came from, so a redirect to another site is judged as such.
      return { status: 200, finalUrl: started.url(), contentType: 'application/pdf', bytes };
    }
    const contentType = response?.headers()['content-type'] ?? '';
    if (/application\/pdf/i.test(contentType) && response) {
      return {
        status: response.status(),
        finalUrl: page.url(),
        contentType,
        bytes: new Uint8Array(await response.body()),
      };
    }

    // Let client-rendered builders (Wix, React apps) fill the page in.
    await page.waitForLoadState('networkidle', { timeout: BROWSER_SETTLE_MS }).catch(() => {});
    if (isChallengeTitle(await page.title())) {
      await page.waitForTimeout(BROWSER_CHALLENGE_WAIT_MS);
    }
    const status = lastStatus || response?.status() || 200;
    return {
      // Some builders send 404 for pages they then render client-side; readContent() judges the
      // rendered title (soft 404s, challenges) rather than trusting that status.
      status: isChallengeTitle(await page.title()) ? 403 : status === 404 ? 200 : status,
      finalUrl: page.url(),
      contentType: 'text/html',
      bytes: new TextEncoder().encode(await page.content()),
    };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Judging and converting
// ---------------------------------------------------------------------------

type Content = Pick<PageText, 'kind' | 'title' | 'text' | 'links'>;

/** The page's text, or why the response isn't a usable page. The one place a page is converted. */
async function readContent(
  raw: RawPage,
  options: { acceptThin?: boolean } = {}
): Promise<Content | string> {
  if (raw.status !== 200) return `HTTP ${raw.status}`;
  if (isPdf(raw)) {
    if (raw.bytes.length === 0) return 'empty PDF';
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(raw.bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return { kind: 'pdf', title: '', text: tidyText(text), links: [] };
  }

  const html = new TextDecoder().decode(raw.bytes);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  if (isChallengeTitle(title)) return `challenge page ("${title.trim()}")`;
  // Builders that render "not found" with a 200 (or a browser that hides the real status).
  if (/\b(?:page not found|404|not found)\b/i.test(title)) return `soft 404 ("${title.trim()}")`;
  const content = htmlToText(html, raw.finalUrl);
  if (!options.acceptThin && content.text.length < THIN_TEXT_CHARS) {
    return `thin page (${content.text.length} chars)`;
  }
  return { kind: 'html', ...content };
}

const BLOCK_TAGS =
  'p,div,section,article,header,footer,nav,aside,main,li,ul,ol,table,tr,h1,h2,h3,h4,h5,h6,blockquote,dt,dd,figcaption,form,fieldset';

function htmlToText(
  html: string,
  baseUrl: string
): { title: string; text: string; links: PageLink[] } {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr('content') ??
    $('meta[property="og:description"]').attr('content') ??
    '';

  const links: PageLink[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, element) => {
    const raw = $(element).attr('href') ?? '';
    if (/^(mailto|tel|javascript):|^#/i.test(raw)) return;
    let href: string;
    try {
      href = new URL(raw, baseUrl).toString();
    } catch {
      return;
    }
    if (seen.has(href)) return;
    seen.add(href);
    links.push({ href, text: $(element).text().replace(/\s+/g, ' ').trim().slice(0, 120) });
  });

  $('script,style,noscript,svg,template,iframe,canvas').remove();
  $('br').replaceWith('\n');
  $(BLOCK_TAGS).each((_, element) => {
    $(element).prepend('\n').append('\n');
  });
  $('td,th').each((_, element) => {
    $(element).append(' \t ');
  });

  const body = $('body').length > 0 ? $('body').text() : $.root().text();
  const text = tidyText([title, metaDescription, body].filter(Boolean).join('\n'));
  return { title, text, links };
}

function tidyText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .trim();
}

function isPdf(raw: RawPage): boolean {
  if (/application\/pdf/i.test(raw.contentType)) return true;
  return (
    raw.bytes.length > 4 &&
    raw.bytes[0] === 0x25 &&
    raw.bytes[1] === 0x50 &&
    raw.bytes[2] === 0x44 &&
    raw.bytes[3] === 0x46
  );
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(url);
}

function isChallengeTitle(title: string): boolean {
  return CHALLENGE_TITLE.test(title) || /attention required|access denied/i.test(title);
}

// ---------------------------------------------------------------------------
// Disk cache (successful reads only, so a failure is always retried)
// ---------------------------------------------------------------------------

function cachePath(url: string): string {
  return join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.json`);
}

async function readCache(url: string, ttlMs: number): Promise<PageText | null> {
  try {
    const page = JSON.parse(await readFile(cachePath(url), 'utf8')) as PageText;
    return Date.now() - Date.parse(page.fetchedAt) < ttlMs ? page : null;
  } catch {
    return null;
  }
}

async function writeCache(url: string, page: PageText): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(url), JSON.stringify(page));
  } catch {
    // A cache miss next time is fine.
  }
}

/** sha256 of whitespace-normalized text: what the refresh job compares between runs. */
export function hashPageText(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}
