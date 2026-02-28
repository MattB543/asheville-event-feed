import { createHash } from 'crypto';

function stripTrailingSlash(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function hostEqualsOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function normalizeSourceValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function sourceHash(value: string): string {
  const normalized = normalizeSourceValue(value).toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

export function looksLikeDomain(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  // Matches: example.com, sub.example.org/path
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?$/.test(trimmed);
}

export function toAbsoluteUrl(value: string): string | null {
  const trimmed = normalizeSourceValue(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    if (!looksLikeDomain(trimmed)) {
      return null;
    }

    try {
      const parsed = new URL(`https://${trimmed}`);
      return parsed.toString();
    } catch {
      return null;
    }
  }
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';

    // Remove common tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    for (const key of trackingParams) {
      parsed.searchParams.delete(key);
    }

    let host = parsed.host.toLowerCase();
    // Treat linkedin.com and www.linkedin.com as the same profile host.
    if (host === 'linkedin.com') {
      host = 'www.linkedin.com';
    }
    if (host === 'www.linkedin.com' || host.endsWith('.linkedin.com')) {
      parsed.protocol = 'https:';
    }
    const pathname = stripTrailingSlash(parsed.pathname);
    const search = parsed.search;
    return `${parsed.protocol}//${host}${pathname}${search}`;
  } catch {
    return normalizeSourceValue(url);
  }
}

export function isLinkedInProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (!(host === 'linkedin.com' || host.endsWith('.linkedin.com'))) {
      return false;
    }

    return path.startsWith('/in/') || path.startsWith('/pub/');
  } catch {
    return false;
  }
}

export function isLinkedInShortUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'lnkd.in' || host.endsWith('.lnkd.in');
  } catch {
    return false;
  }
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      hostEqualsOrSubdomain(host, 'youtube.com') ||
      hostEqualsOrSubdomain(host, 'youtu.be')
    );
  } catch {
    return false;
  }
}

export function shouldSkipWebEnrichmentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    // These sources are typically login-walled, JS-heavy, or low-yield for our Jina flow.
    const skippedDomains = [
      'facebook.com',
      'fb.com',
      'instagram.com',
      'tiktok.com',
      'x.com',
      'twitter.com',
      'threads.net',
      'snapchat.com',
      'pinterest.com',
      'discord.com',
      'discord.gg',
      't.me',
      'telegram.me',
    ];

    if (isYouTubeUrl(url)) {
      return true;
    }

    return skippedDomains.some((domain) => hostEqualsOrSubdomain(host, domain));
  } catch {
    return false;
  }
}

export async function resolveLinkedInProfileUrl(url: string): Promise<string | null> {
  if (isLinkedInProfileUrl(url)) {
    return canonicalizeUrl(url);
  }

  if (!isLinkedInShortUrl(url)) {
    return null;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
    });

    const finalUrl = response.url || '';
    if (!finalUrl || !isLinkedInProfileUrl(finalUrl)) {
      return null;
    }

    return canonicalizeUrl(finalUrl);
  } catch {
    return null;
  }
}
