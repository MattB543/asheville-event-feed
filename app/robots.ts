import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://avlgo.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/api/cron/', '/api/cron/cleanup/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
