import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo/site';

// The documented public exports; the longer path wins over the /api/ disallow
const allow = [
  '/',
  '/api/export/json',
  '/api/export/markdown',
  '/api/camps/export/json',
  '/api/camps/export/markdown',
];
const disallow = ['/api/', '/api/cron/', '/api/cron/cleanup/'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow, disallow },
      // Meta's AI crawler: the same access as everyone else, only paced (it fetched ~8 pages
      // a minute around the clock from Oct 2026, each rendered in headless Chrome). A crawler
      // follows only the most specific group that names it, so the rules are repeated here.
      // Meta doesn't document Crawl-delay support; if it ignores the line, nothing changes
      { userAgent: 'meta-externalagent', allow, disallow, crawlDelay: 15 },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
