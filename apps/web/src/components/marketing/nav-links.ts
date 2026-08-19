import {
  BadgeDollarSign,
  Fan,
  HardHat,
  Hash,
  Inbox,
  Leaf,
  type LucideIcon,
  Mail,
  PhoneCall,
  Sparkle,
  SquareCheckBig,
  Scale,
  Scissors,
  ShieldCheck,
  Sparkles,
  Tags,
  UsersRound,
  Wrench,
} from "lucide-react";

import { navCopy, type NavCopy } from "@/i18n/marketing/nav";
import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * Nav link inventory (COPY-DECK v2 §Global + V4 coverage map):
 * Product · Pricing · Who it's for · Compare · Log in · [Get your number].
 * The Product menu links the 4 feature pages; Who it's for links the 6
 * trades; Compare links the 2 rivals. Every item resolves to a real
 * standalone route (zero dead links). Rows are typographic (label + one
 * plain-English line): v4 tolerates zero decoration that is not information,
 * so the old icon chips and the promo cell are gone.
 *
 * #328 — NO ROW NAMES OUR PRICE, and there is no way to make one that could.
 * These are plain strings in a plain module: they are built once at import,
 * with no visitor and therefore no country, so the only figure they could carry
 * is a US one. The mobile sheet renders the CountrySelector among these very
 * rows, so a typed "$29" would be a US price sitting directly above the control
 * a Canadian just used to say otherwise — and HEADLINE_PRICE is the fallback
 * for surfaces where no country signal CAN exist (an OG image), not for a
 * string rendered inside the provider. So the rows say what the shape of the
 * price is, which is the part that does not move, and the figure itself lives
 * one tap away on /pricing in the reader's own currency.
 *
 * The rivals' per-seat rates stay literal. Those are dated, sourced claims
 * about somebody else's price, verified on the comparison pages they link to.
 */

export interface NavItem {
  label: string;
  href: string;
  /** One plain-English line rendered beneath the label in the menu panel. */
  description?: string;
  /**
   * The single line glyph shown in the item's Frost chip (v4 amendment 15).
   * One lucide set across the whole nav; flat items (Pricing, Log in) omit it.
   */
  icon?: LucideIcon;
}

export interface NavMenu {
  label: string;
  /** Column count for the desktop panel grid (the six trades use two). */
  columns?: 1 | 2;
  items: NavItem[];
}

/** Product ▾ — the feature pages (coverage map). #491 added Calls: it had
 * shipped on every plan since D36-D43 with no way to reach it from the nav,
 * which is most of why the site read as a texting tool. */
export const productMenuFor = (copy: NavCopy): NavMenu => ({
  label: copy.menuProduct,
  // Two columns since #491 took this past four items: three rows a column
  // reads as a group, six in one column reads as a list to work through.
  columns: 2,
  items: [
    {
      label: copy.sharedInbox,
      href: LIVE_ROUTES.featuresSharedInbox,
      description: copy.sharedInboxDesc,
      icon: Inbox,
    },
    {
      label: copy.calls,
      href: LIVE_ROUTES.featuresCalls,
      description: copy.callsDesc,
      icon: PhoneCall,
    },
    {
      label: copy.businessNumber,
      href: LIVE_ROUTES.featuresBusinessNumber,
      description: copy.businessNumberDesc,
      icon: Hash,
    },
    {
      label: copy.assistant,
      href: LIVE_ROUTES.featuresAssistant,
      description: copy.assistantDesc,
      icon: Sparkle,
    },
    {
      label: copy.tasks,
      href: LIVE_ROUTES.featuresTasks,
      description: copy.tasksDesc,
      icon: SquareCheckBig,
    },
    {
      label: copy.contacts,
      href: LIVE_ROUTES.featuresContacts,
      description: copy.contactsDesc,
      icon: UsersRound,
    },
    {
      label: copy.compliance,
      href: LIVE_ROUTES.featuresCompliance,
      description: copy.complianceDesc,
      icon: ShieldCheck,
    },
    {
      label: copy.templatesAndTags,
      href: LIVE_ROUTES.featuresTemplatesAndTags,
      description: copy.templatesAndTagsDesc,
      icon: Tags,
    },
  ],
});

/** Who it's for ▾ — the six trades (coverage map), two columns. */
export const tradesMenuFor = (copy: NavCopy): NavMenu => ({
  label: copy.menuTrades,
  columns: 2,
  items: [
    {
      label: copy.plumbers,
      href: LIVE_ROUTES.forPlumbers,
      description: copy.plumbersDesc,
      icon: Wrench,
    },
    {
      label: copy.hvac,
      href: LIVE_ROUTES.forHvac,
      description: copy.hvacDesc,
      icon: Fan,
    },
    {
      label: copy.landscapers,
      href: LIVE_ROUTES.forLandscapers,
      description: copy.landscapersDesc,
      icon: Leaf,
    },
    {
      label: copy.cleaners,
      href: LIVE_ROUTES.forCleaners,
      description: copy.cleanersDesc,
      icon: Sparkles,
    },
    {
      label: copy.salons,
      href: LIVE_ROUTES.forSalons,
      description: copy.salonsDesc,
      icon: Scissors,
    },
    {
      label: copy.contractors,
      href: LIVE_ROUTES.forContractors,
      description: copy.contractorsDesc,
      icon: HardHat,
    },
  ],
});

/** Compare ▾ — the two rivals (coverage map). */
export const compareMenuFor = (copy: NavCopy): NavMenu => ({
  label: copy.menuCompare,
  columns: 1,
  items: [
    {
      label: copy.compareHeymarket,
      href: LIVE_ROUTES.compareHeymarket,
      description: copy.compareHeymarketDesc,
      icon: Scale,
    },
    {
      label: copy.compareQuo,
      href: LIVE_ROUTES.compareQuo,
      description: copy.compareQuoDesc,
      icon: Scale,
    },
  ],
});

/**
 * The English chrome, built from the catalogue rather than typed beside it.
 *
 * Every existing consumer — the pricing page, `chrome.test.tsx`'s
 * href-coverage assertions — keeps importing exactly what it imported before.
 * What changed is where the sentence comes from, so there is one definition of
 * each and the coverage test keeps testing routes rather than wording.
 */
export const productMenu: NavMenu = productMenuFor(navCopy("en"));
export const tradesMenu: NavMenu = tradesMenuFor(navCopy("en"));
export const compareMenu: NavMenu = compareMenuFor(navCopy("en"));

export const NAV_MENUS: NavMenu[] = [productMenu, tradesMenu, compareMenu];

/** The three menus for one locale, in the order the nav renders them. */
export const navMenusFor = (copy: NavCopy): NavMenu[] => [
  productMenuFor(copy),
  tradesMenuFor(copy),
  compareMenuFor(copy),
];

/** The flat top-level Pricing link (a real standalone page). The desktop bar
 * renders only the label; the mobile sheet gives it the full grouped-row
 * anatomy (icon chip + one factual line) so it reads like a button among the
 * other rows instead of a bare text line (#117). */
export const pricingLinkFor = (copy: NavCopy): NavItem => ({
  label: copy.pricing,
  href: LIVE_ROUTES.pricing,
  description: copy.pricingDesc,
  icon: BadgeDollarSign,
});

/** #126: Contact reachable from the mobile nav sheet, not footer-only. The
 * desktop bar stays deliberately lean (Contact lives in the footer + in-body
 * "Talk to us" CTAs there); on a phone, footer-only meant scrolling the whole
 * page, so the sheet carries it as a grouped row. */
export const contactLinkFor = (copy: NavCopy): NavItem => ({
  label: copy.contact,
  href: LIVE_ROUTES.contact,
  description: copy.contactDesc,
  icon: Mail,
});

export const LOGIN_HREF = APP_LINKS.login;
export const SIGNUP_HREF = APP_LINKS.signup;

/**
 * The site-wide primary CTA (COPY-DECK v2 §Global, binding): the cobalt pill
 * everywhere reads exactly this. Secondary is SECONDARY_CTA_LABEL.
 */
export const PRIMARY_CTA_LABEL = navCopy("en").ctaPrimary;
export const SECONDARY_CTA_LABEL = navCopy("en").ctaSecondary;

/** The English flat links, declared after their builders. */
export const PRICING_LINK: NavItem = pricingLinkFor(navCopy("en"));

export const CONTACT_LINK: NavItem = contactLinkFor(navCopy("en"));
