import {
  BadgeDollarSign,
  Fan,
  HardHat,
  Hash,
  Inbox,
  Leaf,
  type LucideIcon,
  Scale,
  Scissors,
  ShieldCheck,
  Sparkles,
  Tags,
  Wrench,
} from "lucide-react";

import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * Nav link inventory (COPY-DECK v2 §Global + V4 coverage map):
 * Product · Pricing · Who it's for · Compare · Log in · [Get your number].
 * The Product menu links the 4 feature pages; Who it's for links the 6
 * trades; Compare links the 2 rivals. Every item resolves to a real
 * standalone route (zero dead links). Rows are typographic (label + one
 * plain-English line): v4 tolerates zero decoration that is not information,
 * so the old icon chips and the promo cell are gone.
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

/** Product ▾ — the four feature pages (coverage map). */
export const productMenu: NavMenu = {
  label: "Product",
  columns: 1,
  items: [
    {
      label: "Shared inbox",
      href: LIVE_ROUTES.featuresSharedInbox,
      description: "Every text in one inbox the whole crew can see.",
      icon: Inbox,
    },
    {
      label: "Your business number",
      href: LIVE_ROUTES.featuresBusinessNumber,
      description: "A local number that belongs to the business, not a phone.",
      icon: Hash,
    },
    {
      label: "Compliance built in",
      href: LIVE_ROUTES.featuresCompliance,
      description: "Registration, opt-outs, and consent, handled for you.",
      icon: ShieldCheck,
    },
    {
      label: "Templates and tags",
      href: LIVE_ROUTES.featuresTemplatesAndTags,
      description: "Saved replies and tags that match how you sell.",
      icon: Tags,
    },
  ],
};

/** Who it's for ▾ — the six trades (coverage map), two columns. */
export const tradesMenu: NavMenu = {
  label: "Who it's for",
  columns: 2,
  items: [
    {
      label: "Plumbers",
      href: LIVE_ROUTES.forPlumbers,
      description: "Photo triage and on-my-way texts, off your personal cell.",
      icon: Wrench,
    },
    {
      label: "HVAC",
      href: LIVE_ROUTES.forHvac,
      description: "Triage the no-heat rush without missing a booking.",
      icon: Fan,
    },
    {
      label: "Landscapers",
      href: LIVE_ROUTES.forLandscapers,
      description: "Gate codes, reschedules, and add-on asks in one thread.",
      icon: Leaf,
    },
    {
      label: "Cleaners",
      href: LIVE_ROUTES.forCleaners,
      description: "Access notes, confirmations, and reschedules.",
      icon: Sparkles,
    },
    {
      label: "Salons",
      href: LIVE_ROUTES.forSalons,
      description: "Confirmations, waitlist fills, and fewer no-shows.",
      icon: Scissors,
    },
    {
      label: "Contractors",
      href: LIVE_ROUTES.forContractors,
      description: "Change orders and decisions, in writing, on one number.",
      icon: HardHat,
    },
  ],
};

/** Compare ▾ — the two rivals (coverage map). */
export const compareMenu: NavMenu = {
  label: "Compare",
  columns: 1,
  items: [
    {
      label: "Loonext vs Heymarket",
      href: LIVE_ROUTES.compareHeymarket,
      description: "Flat $29 for the crew vs $49 a person.",
      icon: Scale,
    },
    {
      label: "Loonext vs Quo",
      href: LIVE_ROUTES.compareQuo,
      description: "Flat beats per-user, with texts included.",
      icon: Scale,
    },
  ],
};

export const NAV_MENUS: NavMenu[] = [productMenu, tradesMenu, compareMenu];

/** The flat top-level Pricing link (a real standalone page). The desktop bar
 * renders only the label; the mobile sheet gives it the full grouped-row
 * anatomy (icon chip + one factual line) so it reads like a button among the
 * other rows instead of a bare text line (#117). */
export const PRICING_LINK: NavItem = {
  label: "Pricing",
  href: LIVE_ROUTES.pricing,
  description: "One flat $29 a month for the whole crew.",
  icon: BadgeDollarSign,
};

export const LOGIN_HREF = APP_LINKS.login;
export const SIGNUP_HREF = APP_LINKS.signup;

/**
 * The site-wide primary CTA (COPY-DECK v2 §Global, binding): the cobalt pill
 * everywhere reads exactly this. Secondary is SECONDARY_CTA_LABEL.
 */
export const PRIMARY_CTA_LABEL = "Get your number";
export const SECONDARY_CTA_LABEL = "See pricing";
