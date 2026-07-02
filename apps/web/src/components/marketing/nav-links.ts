import { APP_LINKS, HOME_ANCHORS, LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * Nav link inventory (BLUEPRINT §12). Dropdown items whose standalone pages ship
 * in later iterations point at home-page anchors for now (site.ts), so there are
 * ZERO dead links this iteration. Real standalone pages: /security (Product menu)
 * and /pricing (the top-level Pricing link). Everything else in the feature/
 * trade/compare menus lands on the relevant home section until its page exists.
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

/** Product ▾ — 4 feature pages (anchored to home for now) + Security (live). */
export const productMenu: NavMenu = {
  label: "Product",
  href: HOME_ANCHORS.features,
  items: [
    { label: "Shared inbox", href: HOME_ANCHORS.features },
    { label: "Your business number", href: HOME_ANCHORS.features },
    { label: "Compliance built in", href: HOME_ANCHORS.features },
    { label: "Templates & tags", href: HOME_ANCHORS.features },
    { label: "Security", href: LIVE_ROUTES.security, live: true },
  ],
};

/** Who it's for ▾ — the six trades + Canada (all anchored for now). */
export const tradesMenu: NavMenu = {
  label: "Who it's for",
  href: HOME_ANCHORS.trades,
  items: [
    { label: "Plumbers", href: HOME_ANCHORS.trades },
    { label: "Landscapers", href: HOME_ANCHORS.trades },
    { label: "Cleaners", href: HOME_ANCHORS.trades },
    { label: "HVAC", href: HOME_ANCHORS.trades },
    { label: "Salons", href: HOME_ANCHORS.trades },
    { label: "Contractors", href: HOME_ANCHORS.trades },
    { label: "JobText in Canada", href: HOME_ANCHORS.canada },
  ],
};

/** Compare ▾ — the three launch comparisons (anchored for now). */
export const compareMenu: NavMenu = {
  label: "Compare",
  href: HOME_ANCHORS.compare,
  items: [
    { label: "JobText vs Podium", href: HOME_ANCHORS.compare },
    { label: "JobText vs Heymarket", href: HOME_ANCHORS.compare },
    { label: "JobText vs Quo", href: HOME_ANCHORS.compare },
  ],
};

export const NAV_MENUS: NavMenu[] = [productMenu, tradesMenu, compareMenu];

/** Flat top-level links between the menus. Pricing is a real standalone page
 * (BLUEPRINT §2, §8); Canada anchors to the home Canada beat until /canada ships. */
export const PRICING_LINK: NavItem = { label: "Pricing", href: HOME_ANCHORS.pricing, live: true };
export const CANADA_LINK: NavItem = { label: "Canada", href: HOME_ANCHORS.canada };

export const LOGIN_HREF = APP_LINKS.login;
export const SIGNUP_HREF = APP_LINKS.signup;
export const PRIMARY_CTA_LABEL = "Get your number";
