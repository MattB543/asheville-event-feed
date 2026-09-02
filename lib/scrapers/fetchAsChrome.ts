/**
 * Cloudflare-tolerant HTTP for scrapers.
 *
 * Cloudflare fingerprints the TLS handshake and the ALPN offer together, so
 * Node's built-in fetch is served "Attention Required!" or the "Just a
 * moment..." interstitial no matter what headers we send - that is what took
 * both Mountain Xpress and NC Stage's ThunderTix box office offline. An undici
 * dispatcher that offers HTTP/2 with Chrome's cipher order is let straight
 * through. Both halves matter: h2 on Node's default ciphers and Chrome's
 * ciphers over HTTP/1.1 are each still challenged.
 */

import { DEFAULT_FETCH_TIMEOUT_MS } from '@/lib/utils/retry';
import type { Dispatcher } from 'undici';

/** Chrome 122's TLS cipher order, in OpenSSL naming. */
const CHROME_TLS_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

export const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

export const JSON_ACCEPT = 'application/json';
export const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

export const CHALLENGE_TITLE = /just a moment/i;

const HTTP_ATTEMPTS = 4;
const HTTP_RETRY_BASE_MS = 2000;

export async function createChromeDispatcher(): Promise<Dispatcher> {
  const { Agent } = await import('undici');
  return new Agent({ allowH2: true, connect: { ciphers: CHROME_TLS_CIPHERS } });
}

/**
 * Cloudflare's 403 here is usually a transient reputation check rather than a
 * standing block - the same URL and handshake that is challenged one second is
 * served the next - so every request gets a few spaced-out attempts before we
 * give up on this path.
 */
export async function fetchAsChrome(
  url: string,
  accept: string,
  dispatcher: Dispatcher,
  label: string
): Promise<string> {
  const { fetch: undiciFetch } = await import('undici');
  let lastStatus = 0;

  for (let attempt = 1; attempt <= HTTP_ATTEMPTS; attempt++) {
    const response = await undiciFetch(url, {
      headers: {
        'User-Agent': CHROME_USER_AGENT,
        Accept: accept,
        'Accept-Language': ACCEPT_LANGUAGE,
      },
      dispatcher,
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });

    const body = await response.text();

    if (response.status === 200 && !CHALLENGE_TITLE.test(readTitle(body))) {
      return body;
    }

    lastStatus = response.status;

    if (attempt < HTTP_ATTEMPTS) {
      console.warn(
        `[${label}] Challenged (status=${lastStatus}, attempt ${attempt}/${HTTP_ATTEMPTS}): ${url}`
      );
      await sleep(HTTP_RETRY_BASE_MS * attempt);
    }
  }

  throw new Error(`HTTP ${lastStatus} for ${url}`);
}

/**
 * Status-only probe over the same Chrome handshake, single attempt.
 *
 * Deliberately does NOT retry like `fetchAsChrome`: this exists to tell a
 * genuinely dead URL from a bot block, and there a 404 is the answer rather
 * than a challenge to retry past. Returns 0 on a network error, which callers
 * must treat as "unknown", never as dead.
 */
export async function probeAsChrome(url: string, dispatcher: Dispatcher): Promise<number> {
  const { fetch: undiciFetch } = await import('undici');
  try {
    const response = await undiciFetch(url, {
      headers: {
        'User-Agent': CHROME_USER_AGENT,
        Accept: HTML_ACCEPT,
        'Accept-Language': ACCEPT_LANGUAGE,
      },
      dispatcher,
      redirect: 'follow',
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return 0;
  }
}

function readTitle(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
