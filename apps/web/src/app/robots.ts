import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/marketing/site";

/**
 * robots.txt (BLUEPRINT §11.3): allow the marketing site; disallow the
 * signed-in app surfaces and auth flows (they're behind auth anyway, but keeping
 * them out of the crawl budget and the index is cleaner). Points crawlers at the
 * sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/inbox",
        "/contacts",
        "/templates",
        "/settings",
        "/onboarding",
        "/dashboard",
        "/login",
        "/signup",
        "/reset-password",
        "/update-password",
        "/invite",
        "/join",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
