const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://avlgo.com';

export function JsonLd() {
  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'AVL GO',
    alternateName: 'Asheville Event Feed',
    url: siteUrl,
    description:
      'Discover events in Asheville, NC. AVL GO aggregates concerts, festivals, food & drink events, outdoor activities, and more from AVL Today, Eventbrite, and Meetup.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Brooks Solutions, LLC',
    url: 'https://mattbrooks.xyz',
    logo: `${siteUrl}/avlgo_favicon.png`,
    sameAs: [],
  };

  const localBusinessSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'AVL GO',
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '5',
      ratingCount: '1',
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

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: siteUrl,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(localBusinessSchema),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
    </>
  );
}
