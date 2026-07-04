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

    // Feature pages (BLUEPRINT §2, §5).
    {
      path: LIVE_ROUTES.featuresSharedInbox,
      priority: 0.8,
      changeFrequency: "monthly",
    },
    {
      path: LIVE_ROUTES.featuresBusinessNumber,
      priority: 0.8,
      changeFrequency: "monthly",
    },
    {
      path: LIVE_ROUTES.featuresCompliance,
      priority: 0.8,
      changeFrequency: "monthly",
    },
    {
      path: LIVE_ROUTES.featuresTemplatesAndTags,
      priority: 0.8,
      changeFrequency: "monthly",
    },

    // Trade pages (BLUEPRINT §2, §5).
    { path: LIVE_ROUTES.forPlumbers, priority: 0.7, changeFrequency: "monthly" },
    {
      path: LIVE_ROUTES.forLandscapers,
      priority: 0.7,
      changeFrequency: "monthly",
    },
    { path: LIVE_ROUTES.forCleaners, priority: 0.7, changeFrequency: "monthly" },
    { path: LIVE_ROUTES.forHvac, priority: 0.7, changeFrequency: "monthly" },
    { path: LIVE_ROUTES.forSalons, priority: 0.7, changeFrequency: "monthly" },
    {
      path: LIVE_ROUTES.forContractors,
      priority: 0.7,
      changeFrequency: "monthly",
    },

    // Canada (BLUEPRINT §2, §7).
    { path: LIVE_ROUTES.canada, priority: 0.7, changeFrequency: "monthly" },

    // Comparison pages (BLUEPRINT §2, §6). The /compare index is the hub the
    // three head-to-head pages link back to (and their breadcrumbs terminate on).
    {
      path: LIVE_ROUTES.compareIndex,
      priority: 0.7,
      changeFrequency: "monthly",
    },
    {
      path: LIVE_ROUTES.comparePodium,
      priority: 0.6,
      changeFrequency: "monthly",
    },
    {
      path: LIVE_ROUTES.compareHeymarket,
      priority: 0.6,
      changeFrequency: "monthly",
    },
    { path: LIVE_ROUTES.compareQuo, priority: 0.6, changeFrequency: "monthly" },

    { path: LIVE_ROUTES.security, priority: 0.6, changeFrequency: "monthly" },
    { path: LIVE_ROUTES.contact, priority: 0.5, changeFrequency: "yearly" },
    { path: LIVE_ROUTES.status, priority: 0.4, changeFrequency: "weekly" },
    { path: LIVE_ROUTES.terms, priority: 0.3, changeFrequency: "yearly" },
    { path: LIVE_ROUTES.privacy, priority: 0.3, changeFrequency: "yearly" },
    { path: LIVE_ROUTES.aup, priority: 0.3, changeFrequency: "yearly" },
    { path: LIVE_ROUTES.messaging, priority: 0.3, changeFrequency: "yearly" },
    {
      path: LIVE_ROUTES.subprocessors,
      priority: 0.3,
      changeFrequency: "yearly",
    },
    { path: LIVE_ROUTES.refunds, priority: 0.3, changeFrequency: "yearly" },
  ];

  return entries.map(({ path, priority, changeFrequency }) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
