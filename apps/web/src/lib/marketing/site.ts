/**
 * Marketing route + link inventory — the single source of truth that drives the
 * nav, the footer, the sitemap, and JSON-LD BreadcrumbLists (BLUEPRINT §11.3:
 * "generated from the same route-data maps that drive nav/footer").
 *
 * Honesty rule for this iteration (Track A shell + Track B home): every link in
 * the nav and footer must resolve. Pages that ship in later iterations
 * (features, trades, compares, /pricing, /canada) are NOT linked to their future
 * URLs — they point at the relevant home-page anchor instead, so there are ZERO
 * dead links now. When those pages land, the `href` values here flip to the real
 * routes in one place and every surface updates together.
 */

export const SITE_URL = "https://jobtext.app";

/** Absolute canonical for a path (leading slash), e.g. "/legal/terms". */
export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/**
 * Real marketing routes that exist after this iteration (Track A + Track B).
 * These are the ONLY paths the sitemap emits and the only ones the nav/footer
 * link to as real routes; everything else routes to a home anchor below.
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
  subprocessors: "/legal/subprocessors",
} as const;

/**
 * Home-page section anchors (Track B renders sections with these ids in
 * BLUEPRINT §3 order). Nav/footer entries for not-yet-built standalone pages
 * point here so the click still lands somewhere true and relevant.
 *
 * These ids are verified against Track B's home sections at integration:
 * features, trades, canada, faq all exist as section ids on the home page.
 *
 * `pricing` and `compare` now resolve to the real /pricing page (it ships this
 * iteration): "Pricing" is a standalone page (BLUEPRINT §2, §8), and the fullest
 * "what you'll actually pay elsewhere" competitor comparison lives there (§8)
 * until the dedicated /compare/* pages ship. The home pricing section keeps its
 * id="pricing" for in-page use; nav/footer/hero point at the standalone page.
 */
export const HOME_ANCHORS = {
  features: "/#features",
  pricing: LIVE_ROUTES.pricing,
  trades: "/#trades",
  compare: LIVE_ROUTES.pricing,
  canada: "/#canada",
  faq: "/#faq",
} as const;

/** The app (separate Worker origin in production; same-origin route locally). */
export const APP_LINKS = {
  login: "/login",
  signup: "/signup",
} as const;
