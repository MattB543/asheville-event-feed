import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/seo/site';

// Stable node ids so the site, its publisher, the app and the API reference each other
const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const WEB_APPLICATION_ID = `${SITE_URL}/#webapp`;
const WEB_API_ID = `${SITE_URL}/#api`;

export function JsonLd() {
  const organizationSchema = {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: 'Brooks Solutions, LLC',
    url: 'https://mattbrooks.xyz',
    logo: `${SITE_URL}/avlgo_favicon.png`,
  };

  const websiteSchema = {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    alternateName: 'Asheville Event Feed',
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: 'en-US',
    publisher: { '@id': ORGANIZATION_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        // The feed reads ?search= on load (EventFeed's URL filters); the homepage ignores it
        urlTemplate: `${SITE_URL}/events?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  const webApplicationSchema = {
    '@type': 'WebApplication',
    '@id': WEB_APPLICATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Any',
    publisher: { '@id': ORGANIZATION_ID },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    areaServed: {
      '@type': 'City',
      name: 'Asheville',
      containedInPlace: {
        '@type': 'State',
        name: 'North Carolina',
        containedInPlace: {
          '@type': 'Country',
          name: 'United States',
        },
      },
    },
  };

  const webApiSchema = {
    '@type': 'WebAPI',
    '@id': WEB_API_ID,
    name: 'AVL GO Events API',
    description:
      'Free, read-only JSON API for upcoming events in Asheville, NC and nearby towns, with a compact paginated format for apps and AI assistants. No API key required.',
    url: `${SITE_URL}/api/export/json`,
    documentation: [
      `${SITE_URL}/developers`,
      {
        '@type': 'CreativeWork',
        name: 'AVL GO Events API OpenAPI specification',
        url: `${SITE_URL}/openapi.json`,
        encodingFormat: 'application/vnd.oai.openapi+json',
      },
    ],
    provider: { '@id': ORGANIZATION_ID },
  };

  const breadcrumbSchema = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: SITE_URL,
      },
    ],
  };

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      organizationSchema,
      websiteSchema,
      webApplicationSchema,
      webApiSchema,
      breadcrumbSchema,
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, '\\u003c') }}
    />
  );
}
