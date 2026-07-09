/**
 * Marketing route + link inventory, the single source of truth that drives the
 * nav, the footer, the sitemap, and JSON-LD BreadcrumbLists (BLUEPRINT §11.3:
 * "generated from the same route-data maps that drive nav/footer").
 *
 * Iteration 3 SEO content: the feature pages (shared-inbox, business-number,
 * compliance, templates-and-tags), /canada, the six trade pages, and the two
 * comparison pages are now REAL routes. Every link in the nav and footer resolves
 * to a shipped page. The only entries that still point at a home-page anchor are
 * the two menu *triggers* ("Product ▾" / "Who it's for ▾"), clicking the trigger
 * word itself scrolls to the relevant home overview; its dropdown items go to the
 * real standalone pages. There are ZERO dead links.
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

/** The app (separate Worker origin in production; same-origin route locally). */
export const APP_LINKS = {
  login: "/login",
  signup: "/signup",
} as const;
