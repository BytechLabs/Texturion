import { APP_LINKS, HOME_ANCHORS, LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * Nav link inventory (BLUEPRINT §12). Every dropdown item resolves to a real
 * standalone page — the feature pages, the six trade pages, /canada, and the
 * three comparison pages all ship this iteration. The only home-anchor entries
 * left are the two menu *triggers* (`href` on the menu itself): clicking the word
 * "Product" or "Who it's for" scrolls to the relevant home overview, while the
 * dropdown items navigate to the standalone pages. ZERO dead links.
 */

export interface NavItem {
  label: string;
  href: string;
  /** True when the href is a real standalone page (else a home anchor). */
  live?: boolean;
}

export interface NavMenu {
  label: string;
  /** The menu's own landing anchor/route when the trigger itself is clicked. */
  href: string;
  items: NavItem[];
}

/** Product ▾ — 4 feature pages + Security (all live standalone pages). */
export const productMenu: NavMenu = {
  label: "Product",
  href: HOME_ANCHORS.features,
  items: [
    {
      label: "Shared inbox",
      href: LIVE_ROUTES.featuresSharedInbox,
      live: true,
    },
    {
      label: "Your business number",
      href: LIVE_ROUTES.featuresBusinessNumber,
      live: true,
    },
    {
      label: "Compliance built in",
      href: LIVE_ROUTES.featuresCompliance,
      live: true,
    },
    {
      label: "Templates & tags",
      href: LIVE_ROUTES.featuresTemplatesAndTags,
      live: true,
    },
    { label: "Security", href: LIVE_ROUTES.security, live: true },
  ],
};

/** Who it's for ▾ — the six trades + Canada (all live standalone pages). */
export const tradesMenu: NavMenu = {
  label: "Who it's for",
  href: HOME_ANCHORS.trades,
  items: [
    { label: "Plumbers", href: LIVE_ROUTES.forPlumbers, live: true },
    { label: "Landscapers", href: LIVE_ROUTES.forLandscapers, live: true },
    { label: "Cleaners", href: LIVE_ROUTES.forCleaners, live: true },
    { label: "HVAC", href: LIVE_ROUTES.forHvac, live: true },
    { label: "Salons", href: LIVE_ROUTES.forSalons, live: true },
    { label: "Contractors", href: LIVE_ROUTES.forContractors, live: true },
    { label: "JobText in Canada", href: LIVE_ROUTES.canada, live: true },
  ],
};

/** Compare ▾ — the three launch comparisons (all live standalone pages). */
export const compareMenu: NavMenu = {
  label: "Compare",
  href: LIVE_ROUTES.comparePodium,
  items: [
    { label: "JobText vs Podium", href: LIVE_ROUTES.comparePodium, live: true },
    {
      label: "JobText vs Heymarket",
      href: LIVE_ROUTES.compareHeymarket,
      live: true,
    },
    { label: "JobText vs Quo", href: LIVE_ROUTES.compareQuo, live: true },
  ],
};

export const NAV_MENUS: NavMenu[] = [productMenu, tradesMenu, compareMenu];

/** Flat top-level links between the menus. Pricing and Canada are real
 * standalone pages (BLUEPRINT §2, §8, §7). */
export const PRICING_LINK: NavItem = {
  label: "Pricing",
  href: HOME_ANCHORS.pricing,
  live: true,
};
export const CANADA_LINK: NavItem = {
  label: "Canada",
  href: LIVE_ROUTES.canada,
  live: true,
};

export const LOGIN_HREF = APP_LINKS.login;
export const SIGNUP_HREF = APP_LINKS.signup;
export const PRIMARY_CTA_LABEL = "Get your number";
