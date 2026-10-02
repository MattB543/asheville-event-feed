import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.avlgo.com';

  return {
    rules: [
      {
        userAgent: '*',
        // The documented public exports; the longer path wins over the /api/ disallow
        allow: ['/', '/api/export/json', '/api/export/markdown'],
        disallow: ['/api/', '/api/cron/', '/api/cron/cleanup/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
