import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://avlgo.com";

  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    // Add more pages here as your app grows
    // Example for future event detail pages:
    // {
    //   url: `${siteUrl}/events`,
    //   lastModified: new Date(),
    //   changeFrequency: "hourly",
    //   priority: 0.9,
    // },
  ];
}
