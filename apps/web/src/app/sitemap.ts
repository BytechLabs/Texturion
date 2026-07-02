import type { MetadataRoute } from "next";

import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";

/**
 * Marketing sitemap (BLUEPRINT §11.3) — generated from LIVE_ROUTES, the same
 * route inventory that drives the nav/footer, so there is one source of truth.
 * Only pages that actually exist are listed; app routes are excluded (they're
 * disallowed in robots.ts). Later iterations add their routes to LIVE_ROUTES and
 * they appear here automatically.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const entries: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: LIVE_ROUTES.home, priority: 1, changeFrequency: "weekly" },
    { path: LIVE_ROUTES.pricing, priority: 0.9, changeFrequency: "weekly" },
    { path: LIVE_ROUTES.security, priority: 0.6, changeFrequency: "monthly" },
    { path: LIVE_ROUTES.contact, priority: 0.5, changeFrequency: "yearly" },
    { path: LIVE_ROUTES.status, priority: 0.4, changeFrequency: "weekly" },
    { path: LIVE_ROUTES.terms, priority: 0.3, changeFrequency: "yearly" },
    { path: LIVE_ROUTES.privacy, priority: 0.3, changeFrequency: "yearly" },
    { path: LIVE_ROUTES.aup, priority: 0.3, changeFrequency: "yearly" },
    {
      path: LIVE_ROUTES.subprocessors,
      priority: 0.3,
      changeFrequency: "yearly",
    },
  ];

  return entries.map(({ path, priority, changeFrequency }) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
