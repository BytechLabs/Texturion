/**
 * Marketing route + link inventory, the single source of truth that drives the
 * nav, the footer, the sitemap, and JSON-LD BreadcrumbLists (BLUEPRINT §11.3:
 * "generated from the same route-data maps that drive nav/footer").
 *
 * Iteration 3 SEO content: the feature pages (shared-inbox, business-number,
 * compliance, templates-and-tags), /canada, the six trade pages, and the two
 * comparison pages are REAL routes. Every link in the nav and footer resolves
 * to a shipped page. The menu triggers ("Product ▾", "Who it's for ▾",
 * "Compare ▾") are dropdown openers (Radix NavigationMenu.Trigger) — they open
 * the panel rather than navigate; every dropdown item and every footer link
 * goes to a real standalone page. There are ZERO dead links.
 */

export const SITE_URL = "https://loonext.com";

/** Absolute canonical for a path (leading slash), e.g. "/legal/terms". */
export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/**
 * Real marketing routes that exist. These are the paths the sitemap emits and the
 * paths the nav/footer link to as real routes.
 */
export const LIVE_ROUTES = {
  home: "/",
  pricing: "/pricing",
  security: "/security",
  contact: "/contact",
  status: "/status",
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  aup: "/legal/aup",
  messaging: "/legal/messaging",
  subprocessors: "/legal/subprocessors",
  refunds: "/legal/refunds",
  fairUse: "/legal/fair-use",
  cookies: "/legal/cookies",

  // Feature pages (BLUEPRINT §2, §5).
  featuresSharedInbox: "/features/shared-inbox",
  featuresBusinessNumber: "/features/business-number",
  featuresCompliance: "/features/compliance",
  featuresTemplatesAndTags: "/features/templates-and-tags",

  // Canada (BLUEPRINT §2, §7).
  canada: "/canada",

  // Trade pages (BLUEPRINT §2, §5 template).
  forPlumbers: "/for/plumbers",
  forLandscapers: "/for/landscapers",
  forCleaners: "/for/cleaners",
  forHvac: "/for/hvac",
  forSalons: "/for/salons",
  forContractors: "/for/contractors",

  // Comparison pages (BLUEPRINT §2, §6). `compareIndex` is the /compare hub the
  // two head-to-head pages' breadcrumbs terminate on (seo.ts breadcrumbJsonLd
  // emits { name: "Compare", path: "/compare" }) and the Compare menu points at.
  compareIndex: "/compare",
  compareHeymarket: "/compare/heymarket",
  compareQuo: "/compare/quo",
} as const;

/**
 * Base for links into the app surface. When NEXT_PUBLIC_APP_ORIGIN is set
 * (production's marketing/app host split), app links must be ABSOLUTE:
 * a relative /signup on loonext.com 30x-redirects to app.loonext.com, and
 * the Next router's RSC prefetch (?_rsc=) follows that redirect cross-origin
 * and dies on CORS — a failed fetch on every marketing page before the CTA
 * click even lands (#115). An absolute href is never treated as an app route,
 * so it is never prefetched and navigates in one hop. Unset (dev/CI/previews)
 * the links stay relative and same-origin. Exported for tests.
 */
export function appLinkBase(origin: string | undefined): string {
  if (!origin) return "";
  try {
    return new URL(origin).origin;
  } catch {
    return ""; // misconfigured origin → relative links, never a broken nav
  }
}

const APP_BASE = appLinkBase(process.env.NEXT_PUBLIC_APP_ORIGIN);

/** The app (separate Worker origin in production; same-origin route locally). */
export const APP_LINKS = {
  login: `${APP_BASE}/login`,
  signup: `${APP_BASE}/signup`,
} as const;
