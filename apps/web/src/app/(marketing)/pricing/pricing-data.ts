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

function moduleCard(id: "mms" | "voice" | "extra_storage") {
  const card = PLAN_MODULE_CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`Missing module card: ${id}`);
  return card;
}

const MMS = moduleCard("mms");
const VOICE = moduleCard("voice");
const STORAGE = moduleCard("extra_storage");

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
   omitted. Photo sending is NOT a base feature (it's the $5/mo Picture
   messages add-on); the builder's add-on toggles carry the module truth. */
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: usd(S.monthlyDollars),
    tagline: "For crews of one to five.",
    features: [
      `${S.seats} teammates included`,
      `${S.numbers} local business number (US or Canada, your area code)`,
      `${S.includedTexts.toLocaleString("en-US")} texts a month (a plain text up to 160 characters is one; the composer shows the count before you send)`,
      "Receiving texts: free and unlimited; photos free to receive",
      `Extra texts: ${S.overageCentsPerText}¢ each, with a spending cap you control`,
      "Month to month, cancel anytime",
    ],
    cta: "Start with Starter",
  },
  {
    id: "pro",
    name: "Pro",
    price: usd(P.monthlyDollars),
    tagline: "For any size crew, and a second number.",
    badge: "For bigger crews",
    highlighted: true,
    features: [
      P.seats === null
        ? "Unlimited teammates included"
        : `${P.seats} teammates included`,
      `${P.numbers} local business numbers (two locations, or office and field)`,
      `${P.includedTexts.toLocaleString("en-US")} texts a month (same count rule; the composer always shows it before you send)`,
      "Receiving texts: free and unlimited; photos free to receive",
      `Extra texts: ${P.overageCentsPerText}¢ each, with a spending cap you control`,
      "Month to month, cancel anytime",
    ],
    cta: "Start with Pro",
  },
];

/* Honesty Ledger (§5.3): every cost, before you pay. Add-on prices and
   quantities mirror apps/api/src/billing/plans.ts + modules.ts (mms $5/150,
   voice $8/300 min, extra_storage $5/10 GB; an outbound MMS meters as a flat
   3 segments, DECISIONS.md D5). */
export const LEDGER: LedgerEntry[] = [
  {
    term: "Your plan",
    figure: `${usd(S.monthlyDollars)} or ${usd(P.monthlyDollars)}/mo`,
    detail: `Month to month. Starter covers ${S.seats} people, Pro is unlimited, flat either way.`,
  },
  {
    term: "Register with the phone companies",
    figure: `${usd(US_REGISTRATION_FEE_DOLLARS)}, one time, ever`,
    detail:
      "The phone companies require every business that texts to register first. This covers the fee they charge to review and approve you, and we pay it on your behalf, including a resubmission if your first attempt bounces. Cancel and come back next year: you won't pay it again. That means $58 your first month, then $29 every month after.",
  },
  {
    term: "Extra texts",
    figure: `${S.overageCentsPerText}¢ · ${P.overageCentsPerText}¢`,
    detail:
      "3¢ each on Starter, 2.5¢ on Pro. Only after your included texts run out, and only up to the cap you control.",
  },
  {
    term: "Optional add-ons, if you turn them on",
    figure: `${MMS.price} · ${VOICE.price} · ${STORAGE.price}`,
    detail:
      "Picture messages $5/mo (150 a month included; each one you send also counts as three texts from your allowance), call forwarding with missed-call text-back $8/mo (300 minutes included), extra storage $5/mo (10 GB more). All three are off by default, you switch them on at signup or later in settings, and you can switch them off the same way. Nothing here is required to text.",
  },
  {
    term: "Tax",
    detail:
      "Prices are in USD, plus sales tax where it applies, calculated at checkout. (CAD billing isn't here yet. We'd rather tell you now than surprise you at checkout.)",
  },
  {
    term: "That's the whole list.",
    detail:
      'Two plans, three optional add-ons, one registration fee, and overage you cap. No setup fees, no per-user fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',
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
        'Two plans, three optional add-ons, and overage you cap. No registration fee, no setup fees, no per-user fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',
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
    label: `The ${S.includedTexts.toLocaleString("en-US")} texts`,
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

/* Pricing FAQ (9). COPY-DECK v2: all nine kept, dash-free. The photo answer
   states the $5 add-on + 150 cap-and-drop truth, the "not getting" answer
   carries the $8 call-forwarding module facts, and the keep-my-number answer
   mirrors the verified porting story. NO FAQPage JSON-LD. */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "Is there a free trial?",
    a: "No, and here's why. A texting number can't really be \"free\": the moment we give you one, the phone companies charge for it, and free numbers attract spammers, which wrecks message delivery for everyone. So Loonext is paid from day one, with a 30-day full money-back guarantee instead. You get a real trial; we keep the network clean.",
  },
  {
    q: "Do texts customers send me count against my 500?",
    a: "No. Receiving texts is free and unlimited on every plan, and receiving photos is free too. Only what you send counts.",
  },
  {
    q: "How do photo messages work?",
    a: "Receiving photos is free on every plan, and they're saved in your included storage. Sending them is the Picture messages add-on: $5 a month with 150 picture messages included. Each one you send also counts as a flat three texts from your monthly allowance, however long the words. Past 150 in a month, the photo is dropped and your message still goes out as plain text. The account owner gets an email at 80% of the cap, and the composer tells you right away when a photo didn't go.",
  },
  {
    q: "What happens when I hit my allowance?",
    a: "We email you at 80% and again at 100%. Past that, extra texts are 3¢ each (2.5¢ on Pro) up to a spending cap, 3× your allowance by default. Hit the cap and sending pauses until you raise it; account owners can do that in one click. You'll never get a surprise bill.",
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
