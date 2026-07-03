import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Fan,
  HardHat,
  Hash,
  Inbox,
  Leaf,
  MessagesSquare,
  Scissors,
  Shield,
  ShieldCheck,
  Sparkles,
  Tags,
  Wrench,
} from "lucide-react";

import { APP_LINKS, HOME_ANCHORS, LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * Nav link inventory (BLUEPRINT §12, VISUALS §5b). The nav is a *branded*
 * mega-menu, not a bare-text dropdown, so every item carries the four fields
 * VISUALS §5b mandates: { label, href, description (one plain-English line),
 * icon (a lucide component) }. The dropdown panels render each item as a
 * two-line row, a petrol-tinted icon chip + the label (medium) + the muted
 * description, and long lists (Trades, Compare) as a tidy multi-column grid.
 *
 * Every item resolves to a real standalone page, the four feature pages, the
 * six trade pages, /canada, and the three comparison pages all ship. The only
 * home-anchor entries are the two menu *triggers* (`href` on the menu itself):
 * clicking the word "Product" or "Who it's for" scrolls to the relevant home
 * overview; the dropdown items navigate to the standalone pages. ZERO dead links.
 */

export interface NavItem {
  label: string;
  href: string;
  /** One plain-English line rendered beneath the label in the mega-menu (§5b). */
  description?: string;
  /** Lucide icon shown in the petrol-tinted chip beside the label (§5b). */
  icon?: LucideIcon;
  /** True when the href is a real standalone page (else a home anchor). */
  live?: boolean;
}

/**
 * The featured promo cell in the Product menu (VISUALS §5b): a petrol-tinted
 * card carrying a mini live-thread snippet and a "See the shared inbox →" link
 *, the personality moment that makes the menu feel like a brand, not a list.
 * The snippet echoes the app's real thread grammar (inbound white bubble →
 * teal-50 outbound reply with a Delivered check), scripted from COPY §H4.
 */
export interface NavFeatured {
  eyebrow: string;
  title: string;
  href: string;
  cta: string;
  icon: LucideIcon;
}

export interface NavMenu {
  label: string;
  /** The menu's own landing anchor/route when the trigger itself is clicked. */
  href: string;
  /** Column count for the panel grid; long lists (Trades) use two (§5b). */
  columns?: 1 | 2;
  items: NavItem[];
  /** Optional featured promo cell (Product menu only, §5b). */
  featured?: NavFeatured;
}

/** Product ▾, 4 feature pages + Security, plus the featured shared-inbox cell. */
export const productMenu: NavMenu = {
  label: "Product",
  href: HOME_ANCHORS.features,
  columns: 1,
  items: [
    {
      label: "Shared inbox",
      href: LIVE_ROUTES.featuresSharedInbox,
      description: "Every text in one inbox the whole crew can see.",
      icon: Inbox,
      live: true,
    },
    {
      label: "Your business number",
      href: LIVE_ROUTES.featuresBusinessNumber,
      description: "A local number that belongs to the business, not a phone.",
      icon: Hash,
      live: true,
    },
    {
      label: "Compliance built in",
      href: LIVE_ROUTES.featuresCompliance,
      description: "Carrier registration, opt-outs, and consent, handled.",
      icon: ShieldCheck,
      live: true,
    },
    {
      label: "Templates & tags",
      href: LIVE_ROUTES.featuresTemplatesAndTags,
      description: "Saved replies and a pipeline that matches how you sell.",
      icon: Tags,
      live: true,
    },
    {
      label: "Security",
      href: LIVE_ROUTES.security,
      description: "Encrypted, isolated, and never sold, the plain details.",
      icon: Shield,
      live: true,
    },
  ],
  featured: {
    eyebrow: "See it work",
    title: "The shared inbox",
    href: LIVE_ROUTES.featuresSharedInbox,
    cta: "See the shared inbox",
    icon: MessagesSquare,
  },
};

/** Who it's for ▾, the six trades + Canada, two-column with per-trade icons. */
export const tradesMenu: NavMenu = {
  label: "Who it's for",
  href: HOME_ANCHORS.trades,
  columns: 2,
  items: [
    {
      label: "Plumbers",
      href: LIVE_ROUTES.forPlumbers,
      description: "Photo triage and on-my-way texts, off your personal cell.",
      icon: Wrench,
      live: true,
    },
    {
      label: "Landscapers",
      href: LIVE_ROUTES.forLandscapers,
      description: "Quote season and crew dispatch in one shared thread.",
      icon: Leaf,
      live: true,
    },
    {
      label: "Cleaners",
      href: LIVE_ROUTES.forCleaners,
      description: "Recurring confirmations, access codes, and reschedules.",
      icon: Sparkles,
      live: true,
    },
    {
      label: "HVAC",
      href: LIVE_ROUTES.forHvac,
      description: "Triage the no-heat rush without missing a booking.",
      icon: Fan,
      live: true,
    },
    {
      label: "Salons",
      href: LIVE_ROUTES.forSalons,
      description: "Confirmations, waitlist fills, and fewer no-shows.",
      icon: Scissors,
      live: true,
    },
    {
      label: "Contractors",
      href: LIVE_ROUTES.forContractors,
      description: "Keep client, sub, and GC texts off one personal phone.",
      icon: HardHat,
      live: true,
    },
    {
      label: "JobText in Canada",
      href: LIVE_ROUTES.canada,
      description: "Canadian crews text customers the same day they sign up.",
      icon: Leaf,
      live: true,
    },
  ],
};

/** Compare ▾, the three launch comparisons; each row shows a "vs" motif. The
 * menu trigger's own landing route is the /compare hub (its breadcrumb target). */
export const compareMenu: NavMenu = {
  label: "Compare",
  href: LIVE_ROUTES.compareIndex,
  columns: 1,
  items: [
    {
      label: "JobText vs Podium",
      href: LIVE_ROUTES.comparePodium,
      description: "Flat pricing and a buy button instead of a sales call.",
      icon: Building2,
      live: true,
    },
    {
      label: "JobText vs Heymarket",
      href: LIVE_ROUTES.compareHeymarket,
      description: "One flat price vs $49/user with a two-user minimum.",
      icon: Building2,
      live: true,
    },
    {
      label: "JobText vs Quo",
      href: LIVE_ROUTES.compareQuo,
      description: "Whole-crew pricing vs per-seat, texting included.",
      icon: Building2,
      live: true,
    },
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
  icon: Leaf,
  live: true,
};

export const LOGIN_HREF = APP_LINKS.login;
export const SIGNUP_HREF = APP_LINKS.signup;

/**
 * The site-wide primary CTA (CONVERSION §2: "Primary action is ALWAYS the same
 * words and the same petrol button: 'Start for $29'... it appears in the nav,
 * the hero, after each major proof section, and in the closing band").
 *
 * DOC CONFLICT RESOLVED IN THE DOCTRINE'S FAVOR: COPY §Global lists "Get your
 * number" as the primary label, but CONVERSION.md, equal-authority, and the one
 * that governs conversion, mandates the exact string "Start for $29" so the
 * price anchor rides in the button itself. CONVERSION.md wins (it is the more
 * specific, later, conversion-governing doctrine, and the iteration-4 task
 * restates "consistent 'Start for $29'" explicitly). "Get your number" survives
 * only as a *secondary/quiet* inline nudge where a softer verb reads better; the
 * single primary petrol button everywhere is this constant.
 */
export const PRIMARY_CTA_LABEL = "Start for $29";
