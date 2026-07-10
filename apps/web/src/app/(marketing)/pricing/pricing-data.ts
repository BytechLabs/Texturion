/**
 * /pricing page data (COPY-DECK v2 /pricing, copy verbatim; facts verified
 * against apps/api/src/billing/plans.ts + modules.ts + company-modules.ts).
 * Kept in a plain module (page files may not export extra fields) so the
 * facts are unit-testable: pricing-facts.test.ts guards the numbers and the
 * no-em-dash law over every rendered string here.
 *
 * Pricing-source audit (owner ruling 2026-07-07, QA gate 8): every pulled-out
 * FIGURE below is a template literal over the shared constants
 * (PLAN_PRICING / US_REGISTRATION_FEE_DOLLARS / PLAN_MODULE_CARDS in
 * lib/api/types.ts), never a retyped number. Numbers inside prose sentences
 * keep the deck's exact wording; pricing-facts.test.ts pins each of those to
 * the same constants so prose can't silently drift either.
 */

import {
  PLAN_MODULE_CARDS,
  PLAN_PRICING,
  US_REGISTRATION_FEE_DOLLARS,
  type PlanId,
} from "@/lib/api/types";

import type { LedgerEntry } from "@/components/marketing/pricing/honesty-ledger";
import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

const S = PLAN_PRICING.starter;
const P = PLAN_PRICING.pro;

function moduleCard(id: "voice") {
  const card = PLAN_MODULE_CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`Missing module card: ${id}`);
  return card;
}

// #97/#103: no MMS card — pictures are included on every plan. #121: no
// extra-storage card — storage is free, there is nothing to sell.
const VOICE = moduleCard("voice");

/** "$29" etc., always derived. */
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The dateline chip: the page's load-bearing fact (§5.1). US default. */
export const PRICING_DATELINE = `${usd(S.monthlyDollars + US_REGISTRATION_FEE_DOLLARS)} FIRST MONTH (US) · ${usd(S.monthlyDollars)} AFTER`;

/**
 * The Canada dateline. A Canadian business texting Canadian customers has no
 * registration fee and no carrier wait, so its load-bearing pricing fact is the
 * flat monthly price with nothing added the first month. The page swaps to this
 * for a visitor who chose Canada; the US visitor never sees it (no mixing).
 */
export const PRICING_DATELINE_CA = `${usd(S.monthlyDollars)}/MO · NO REGISTRATION FEE`;

export interface Plan {
  id: PlanId;
  name: string;
  price: string;
  tagline: string;
  badge?: string;
  highlighted?: boolean;
  features: string[];
  cta: string;
}

/* Plan facts from PLAN_PRICING (the plans.ts mirror), in human words, nothing
   omitted. #121: no allowance or per-text figures on marketing surfaces; the
   concrete numbers live only on /legal/fair-use, which the page links. */
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: usd(S.monthlyDollars),
    tagline: "For crews of one to three.",
    features: [
      `${S.seats} teammates included`,
      `${S.numbers} local business number (US or Canada, your area code)`,
      "Texting included, bound by fair use (a plain text up to 160 characters is one; the composer shows the count before you send)",
      "Receiving texts: free and unlimited; photos free to receive",
      "Extra texts: a small per-text rate if a month runs hot, with a spending cap you control",
      "Month to month, cancel anytime",
    ],
    cta: "Start with Starter",
  },
  {
    id: "pro",
    name: "Pro",
    price: usd(P.monthlyDollars),
    tagline: "For crews up to fifteen, and a second number.",
    badge: "For bigger crews",
    highlighted: true,
    features: [
      `${P.seats} teammates included`,
      `${P.numbers} local business numbers (two locations, or office and field)`,
      "More texting for a bigger crew, bound by fair use (same count rule; the composer always shows it before you send)",
      "Receiving texts: free and unlimited; photos free to receive",
      "Extra texts: a small per-text rate if a month runs hot, with a spending cap you control",
      "Month to month, cancel anytime",
    ],
    cta: "Start with Pro",
  },
];

/**
 * #85: the plan's allowances are a FAIR-USE line, not a hard wall. This footnote
 * sits under the plan builder and links to the fair-use policy — the reference
 * the whole dynamic-limits model leans on (a busy month is fine; we reach out
 * early rather than surprise anyone). It is the plan-card fair-use plumbing the
 * later "hide the raw numbers" work points behind. Dash-free (Law 6).
 */
export const PLAN_FAIR_USE_NOTE =
  "The message, picture, and forwarding allowances reflect fair use, not a hard wall: almost every crew stays well inside them, a busy month now and then is fine, and we reach out early if usage ever paces past what your plan covers. Storage is free on every plan, with no caps.";

/* Honesty Ledger (§5.3): every cost, before you pay. Add-on price mirrors
   apps/api/src/billing/plans.ts + modules.ts (voice $8). #97/#103: pictures
   are included on every plan, so they appear under "Extra texts", not as an
   add-on. #121: no per-text rates, allowance figures, or minute figures here;
   the concrete mechanics live only on /legal/fair-use. Storage is free. */
export const LEDGER: LedgerEntry[] = [
  {
    term: "Your plan",
    figure: `${usd(S.monthlyDollars)} or ${usd(P.monthlyDollars)}/mo`,
    detail: `Month to month. Starter covers ${S.seats} people, Pro covers ${P.seats}, flat either way.`,
  },
  {
    term: "Register with the phone companies",
    figure: `${usd(US_REGISTRATION_FEE_DOLLARS)}, one time, ever`,
    detail:
      "The phone companies require every business that texts to register first. This covers the fee they charge to review and approve you, and we pay it on your behalf, including a resubmission if your first attempt bounces. Cancel and come back next year: you won't pay it again. That means $58 your first month, then $29 every month after.",
  },
  {
    term: "Extra texts",
    figure: "Capped by you",
    detail:
      "Texting and pictures are included under our automated fair-use policy, and almost every crew stays well inside it. If a month runs hot, extra texts bill at a small per-text rate, only up to the spending cap you control, and we email you at 80% and 100% of your included texting first. The exact rates live in our fair use policy.",
  },
  {
    term: "Storage",
    figure: "$0, no caps",
    detail:
      "Files you attach and photos customers send are stored free, on every plan. No storage pools, no meter, no storage add-on to buy, and nothing pauses when you save a lot.",
  },
  {
    term: "Optional add-ons, if you turn them on",
    figure: `${VOICE.price}/mo`,
    detail:
      `One add-on exists: call forwarding with missed-call text-back, ${VOICE.price}/mo with generous forwarded minutes under fair use. It's off by default, you switch it on at signup or later in settings, and you can switch it off the same way. Nothing here is required to text.`,
  },
  {
    term: "Tax",
    detail:
      "Prices are in USD, plus sales tax where it applies, calculated at checkout. (CAD billing isn't here yet. We'd rather tell you now than surprise you at checkout.)",
  },
  {
    term: "That's the whole list.",
    detail:
      'Two plans, one optional add-on, one registration fee, and overage you cap. No setup fees, no per-user fees, no storage fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',
  },
];

/* The Canada Honesty Ledger. A Canadian business texting Canadian customers has
   no registration and no fee, so this list never shows the US $29 / $58-first-
   month story (owner ruling v1, 2026-07-08: a Canadian visitor never reads a US
   fee that doesn't apply). It shares the country-neutral rows with LEDGER (plan
   prices, extra texts, add-ons, tax) and swaps only the two rows that carry the
   registration fact. The FirstWeekTimeline card in the same band carries the
   "if you later text US customers" edge case, so this stays clean. */
export const LEDGER_CA: LedgerEntry[] = LEDGER.map((entry) => {
  if (entry.term === "Register with the phone companies") {
    return {
      term: "No registration, no setup fee",
      figure: `${usd(0)}, ever`,
      detail:
        "A Canadian business texting Canadian customers registers nothing and pays no setup fee. Your number sends the same day it's active, usually a minute or two after you subscribe, so your first month costs the same as every month after.",
    };
  }
  if (entry.term === "That's the whole list.") {
    return {
      ...entry,
      detail:
        'Two plans, one optional add-on, and overage you cap. No registration fee, no setup fees, no per-user fees, no storage fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',
    };
  }
  return entry;
});

/* "The same crew, priced elsewhere": dated, per-cell sourced (COPY §PR). Also
   rendered as the /compare hub's centerpiece ledger (COVERAGE MAP), so the
   two surfaces can never disagree. */
export const ELSEWHERE_COLUMNS: LedgerColumn[] = [
  { label: "Loonext Starter", highlight: true },
  { label: "Heymarket Standard", sub: "as of July 2026" },
  { label: "Quo", sub: "as of July 2026" },
];

export const ELSEWHERE_ROWS: LedgerTableRow[] = [
  {
    label: "Monthly software",
    cells: [
      `${usd(S.monthlyDollars)} flat`,
      "$49/user/mo × 3 = $147",
      "$19/user/mo × 3 = $57 (monthly billing)",
    ],
  },
  {
    // #121: an explicit workload scenario for the competitor math, never an
    // allowance claim. The competitor cells are their published prices.
    label: "500 texts a month, the workload",
    cells: [
      "Included",
      "~$15 (3¢/segment × 500)",
      "Not included, metered at 1¢/segment (~$5)",
    ],
  },
  {
    label: "Monthly carrier line item",
    cells: ["$0", "$10/mo", "$1.50 to $3/mo"],
  },
  {
    label: "Monthly total",
    total: true,
    cells: [
      usd(S.monthlyDollars),
      "~$172",
      "~$64 + extra numbers at $5 ea.",
    ],
  },
];

export const ELSEWHERE_FOOTNOTE =
  "Competitor prices from their public pricing pages, July 2026; each figure is sourced on the matching comparison page. Heymarket's texting total assumes 500 single-segment texts at their published 3¢/segment plus their $10/mo per-campaign carrier fee. Quo's total is $57 in seats plus ~$5 of metered texting (1¢/segment) plus their published $1.50 to $3 monthly carrier maintenance, and extra numbers are $5 each. One-time registration fees excluded for all (ours is $29; Quo discloses $19.50; others don't say). If any number changes, tell us and we'll fix it.";

/* Pricing FAQ (9). COPY-DECK v2 + #121 amendment: all nine kept, dash-free.
   The photo answer states the included-pictures and free-storage truth
   (#97/#103/#121: no add-on, no caps; counting mechanics live on
   /legal/fair-use), the "not getting" answer carries the $8 call-forwarding
   module facts, and the keep-my-number answer mirrors the verified porting
   story. NO FAQPage JSON-LD. */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "Is there a free trial?",
    a: "No, and here's why. A texting number can't really be \"free\": the moment we give you one, the phone companies charge for it, and free numbers attract spammers, which wrecks message delivery for everyone. So Loonext is paid from day one, with a 30-day full money-back guarantee instead. You get a real trial; we keep the network clean.",
  },
  {
    q: "Do texts customers send me count against my plan?",
    a: "No. Receiving texts is free and unlimited on every plan, and receiving photos is free too. Only what you send counts.",
  },
  {
    q: "How do photo messages work?",
    a: "Photos work both ways on every plan, nothing to turn on. Receiving them is free, and every photo is saved for you; storage is free, with no caps. Sending photos is included too, under the same fair-use policy and overage rules as everything else you send. The exact counting mechanics live in our fair use policy.",
  },
  {
    q: "What happens if we send more than usual?",
    a: "We email you at 80% and again at 100% of your included texting, so nothing starts quietly. Past that, extra texts bill at a small per-text rate up to a spending cap you control. Hit the cap and sending pauses until you raise it; account owners can do that in one click. You'll never get a surprise bill. The exact rates live in our fair use policy.",
  },
  {
    q: "Will I ever pay the $29 registration fee twice?",
    a: "No. It's charged at most once per company, ever, even if you cancel and come back. It only exists at all because the phone companies charge a real fee to review and approve every business that texts, and we'd rather show you that fee than bury it in the subscription.",
  },
  {
    q: "Can I change plans or cancel later?",
    a: "Yes. Upgrades apply immediately. Downgrades apply at the end of your billing period. Canceling takes two clicks in billing settings, no phone call, no chat-with-retention. We hold your number for 30 days in case you change your mind.",
  },
  {
    q: "Can I keep my current business number?",
    a: "Yes, transfer it to Loonext. At signup, choose “Bring my number,” give us your current carrier details, and upload a recent bill; we handle the paperwork with the phone companies from there. Transfers are free for US and Canadian numbers and typically take 1 to 7 business days, and your number keeps working on your current carrier the whole time, switching to Loonext on the transfer date. Want to text sooner? Get a new local number now and transfer your old one alongside it.",
  },
  {
    q: "Are prices really in USD for Canadian businesses?",
    a: "For now, yes, your card is charged in USD and your bank converts it. CAD billing is coming; until it's real, we won't pretend otherwise.",
  },
  {
    q: "What am I not getting at these prices?",
    a: "Loonext is a shared texting inbox, not a phone system: there's no calling inside the app, no mass text blasts, and no review management. Phone calls aren't left hanging, though. The call forwarding add-on ($8/mo) sends calls on your business number to your cell and texts back the ones you miss, so the lead still lands in your inbox. If you need blasts or review tools, a bigger platform might fit better; our comparison pages say so honestly.",
  },
];
