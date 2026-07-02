import { HOME_ANCHORS, LIVE_ROUTES } from "@/lib/marketing/site";

import type { NavItem } from "./nav-links";

/**
 * Footer link inventory (BLUEPRINT §12, COPY §F). Same honesty rule as the nav:
 * only pages that exist after this iteration link to real routes; everything
 * else lands on a home-page anchor, so there are ZERO dead links.
 *
 * Real routes shipping now (Track A): /pricing, /security, /contact, /status, and
 * the four legal pages terms/privacy/aup/subprocessors. The "SMS messaging policy"
 * and "30-day guarantee" pages ship in later iterations (BLUEPRINT §2 inventory),
 * so they are intentionally NOT in the footer yet — linking to a 404 would break
 * the honesty guard. They return here the moment their pages land.
 */

export interface FooterColumn {
  heading: string;
  links: NavItem[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "Shared inbox", href: HOME_ANCHORS.features },
      { label: "Your business number", href: HOME_ANCHORS.features },
      { label: "Compliance built in", href: HOME_ANCHORS.features },
      { label: "Templates & tags", href: HOME_ANCHORS.features },
      { label: "Pricing", href: LIVE_ROUTES.pricing, live: true },
      { label: "Security", href: LIVE_ROUTES.security, live: true },
      { label: "JobText in Canada", href: HOME_ANCHORS.canada },
    ],
  },
  {
    heading: "Who it's for",
    links: [
      { label: "Plumbers", href: HOME_ANCHORS.trades },
      { label: "Landscapers", href: HOME_ANCHORS.trades },
      { label: "Cleaners", href: HOME_ANCHORS.trades },
      { label: "HVAC", href: HOME_ANCHORS.trades },
      { label: "Salons", href: HOME_ANCHORS.trades },
      { label: "Contractors", href: HOME_ANCHORS.trades },
    ],
  },
  {
    heading: "Compare",
    links: [
      { label: "JobText vs Podium", href: HOME_ANCHORS.compare },
      { label: "JobText vs Heymarket", href: HOME_ANCHORS.compare },
      { label: "JobText vs Quo", href: HOME_ANCHORS.compare },
    ],
  },
  {
    heading: "Company & legal",
    links: [
      { label: "Terms of service", href: LIVE_ROUTES.terms, live: true },
      { label: "Privacy policy", href: LIVE_ROUTES.privacy, live: true },
      { label: "Acceptable use", href: LIVE_ROUTES.aup, live: true },
      { label: "Sub-processors", href: LIVE_ROUTES.subprocessors, live: true },
      { label: "Security", href: LIVE_ROUTES.security, live: true },
      { label: "Status", href: LIVE_ROUTES.status, live: true },
      { label: "Contact us", href: LIVE_ROUTES.contact, live: true },
    ],
  },
];
