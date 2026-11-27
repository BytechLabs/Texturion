import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/marketing/site";

const DISALLOW_APP_AND_AUTH = [
  "/inbox",
  "/calls",
  "/contacts",
  "/for-you",
  "/tasks",
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
];

/**
 * robots.txt (BLUEPRINT §11.3): allow the marketing site; disallow the
 * signed-in app surfaces and auth flows (they're behind auth anyway, but keeping
 * them out of the crawl budget and the index is cleaner). Welcomes AI search
 * crawlers alongside general search crawlers and points at the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW_APP_AND_AUTH,
      },
      {
        userAgent: [
          "OAI-SearchBot",
          "GPTBot",
          "ClaudeBot",
          "PerplexityBot",
          "Google-Extended",
        ],
        allow: "/",
        disallow: DISALLOW_APP_AND_AUTH,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
