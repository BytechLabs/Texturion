import { LIVE_ROUTES } from "@/lib/marketing/site";

import type { NavItem } from "./nav-links";

/**
 * Footer link inventory (BLUEPRINT §12, COPY §F, VISUALS §5b). Same honesty rule
 * as the nav: every link resolves to a real route. The feature pages, six trade
 * pages, /canada, and the three comparison pages all ship, so the Product / For
 * trades / Compare columns link to their standalone pages.
 *
 * COPY §F groups the tail as one "Company & legal" column; the branded footer
 * (§5b) splits it into a balanced Company column (Security / Status / Contact)
 * and a Legal column (Terms / Privacy / Acceptable use / Sub-processors) so the
 * grid reads as five tidy groups rather than one long stack.
 *
 * The "SMS messaging policy" and "30-day guarantee" pages ship in later
 * iterations (BLUEPRINT §2 inventory), so they are intentionally NOT in the
 * footer yet — linking to a 404 would break the honesty guard. They return the
 * moment their pages land. ZERO dead links.
 */

export interface FooterColumn {
  heading: string;
  links: NavItem[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Product",
    links: [
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
      { label: "Pricing", href: LIVE_ROUTES.pricing, live: true },
      { label: "JobText in Canada", href: LIVE_ROUTES.canada, live: true },
    ],
  },
  {
    heading: "For trades",
    links: [
      { label: "Plumbers", href: LIVE_ROUTES.forPlumbers, live: true },
      { label: "Landscapers", href: LIVE_ROUTES.forLandscapers, live: true },
      { label: "Cleaners", href: LIVE_ROUTES.forCleaners, live: true },
      { label: "HVAC", href: LIVE_ROUTES.forHvac, live: true },
      { label: "Salons", href: LIVE_ROUTES.forSalons, live: true },
      { label: "Contractors", href: LIVE_ROUTES.forContractors, live: true },
    ],
  },
  {
    heading: "Compare",
    links: [
      { label: "All comparisons", href: LIVE_ROUTES.compareIndex, live: true },
      {
        label: "JobText vs Podium",
        href: LIVE_ROUTES.comparePodium,
        live: true,
      },
      {
        label: "JobText vs Heymarket",
        href: LIVE_ROUTES.compareHeymarket,
        live: true,
      },
      { label: "JobText vs Quo", href: LIVE_ROUTES.compareQuo, live: true },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Security", href: LIVE_ROUTES.security, live: true },
      { label: "Status", href: LIVE_ROUTES.status, live: true },
      { label: "Contact us", href: LIVE_ROUTES.contact, live: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms of service", href: LIVE_ROUTES.terms, live: true },
      { label: "Privacy policy", href: LIVE_ROUTES.privacy, live: true },
      { label: "Acceptable use", href: LIVE_ROUTES.aup, live: true },
      { label: "Sub-processors", href: LIVE_ROUTES.subprocessors, live: true },
    ],
  },
];
