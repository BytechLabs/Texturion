/**
 * /pricing page data (COPY-DECK v2 /pricing, copy verbatim; facts verified
 * against apps/api/src/billing/plans.ts + modules.ts + company-modules.ts).
 * Kept in a plain module (page files may not export extra fields) so the
 * facts are unit-testable: pricing-facts.test.ts guards the numbers and the
 * no-em-dash law over every rendered string here.
 *
 * Pricing-source audit (owner ruling 2026-07-07, QA gate 8): every pulled-out
 * FIGURE below is a template literal over the shared price book
 * (PLAN_PRICE_CENTS / US_REGISTRATION_FEE_CENTS in
 * packages/shared/src/billing-currency.ts, plus PLAN_MODULE_CARDS in
 * lib/api/types.ts), never a retyped number. Numbers inside prose sentences
 * keep the deck's exact wording; pricing-facts.test.ts pins each of those to
 * the same constants so prose can't silently drift either.
 *
 * #328: and every one of those figures now carries a CURRENCY. See the note on
 * `price()` below for why picking one per export is not a guess.
 */

import {
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import { PLAN_MODULE_CARDS, PLAN_PRICING, type PlanId } from "@/lib/api/types";

import { COMPARE_AS_OF } from "../compare/verification";

import type { LedgerEntry } from "@/components/marketing/pricing/honesty-ledger";
import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

const S = PLAN_PRICING.starter;
const P = PLAN_PRICING.pro;

function moduleCard(id: "regions_ca") {
  const card = PLAN_MODULE_CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`Missing module card: ${id}`);
  return card;
}

// #97/#103: no MMS card — pictures are included on every plan. #121: no
// extra-storage card — storage is free, there is nothing to sell. #134/D42:
// no Calling card — calling is included on every plan, so the one add-on
// left in the catalog is Canada numbers.
const CANADA_NUMBERS = moduleCard("regions_ca");

/**
 * #328 — "$29" / "$39", read from the price book rather than typed.
 *
 * # Why a currency argument and not a currency SELECTOR
 *
 * Everything money-bearing in this module is built by a function of currency,
 * and each export below fixes that argument to the branch it belongs to. That
 * is not an assumption about the reader: this page renders the US story and the
 * Canada story as two separate subtrees (`CountryOnly` / `CountryText`, the
 * single site-wide country the nav selector and the pricing toggle both move),
 * so a string in the `us` branch is only ever read by somebody billed in USD.
 * The country control the page already has IS the currency control, and a
 * second one could only ever disagree with the first.
 *
 * The two figures are DECIDED, not converted (see billing-currency.ts); this
 * module only routes to them.
 */
const price = (plan: PlanId, currency: BillingCurrency) =>
  formatMoney(PLAN_PRICE_CENTS[currency][plan], currency);

/** The one-time US texting registration fee, on the invoice it lands on. */
const registrationFee = (currency: BillingCurrency) =>
  formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency);

/**
 * Plan plus the one-time fee: what a US shop actually pays in month one.
 *
 * Derived rather than written. It is the only figure on the page that is a SUM,
 * so it is the only one that can go wrong while both of its parts stay right.
 */
const firstMonth = (plan: PlanId, currency: BillingCurrency) =>
  formatMoney(
    PLAN_PRICE_CENTS[currency][plan] + US_REGISTRATION_FEE_CENTS[currency],
    currency,
  );

/** The dateline chip: the page's load-bearing fact (§5.1). US default. */
export const PRICING_DATELINE = `${firstMonth("starter", "usd")} FIRST MONTH (US) · ${price("starter", "usd")} AFTER`;

/**
 * The Canada dateline. A Canadian business texting Canadian customers has no
 * registration fee and no carrier wait, so its load-bearing pricing fact is the
 * flat monthly price with nothing added the first month. The page swaps to this
 * for a visitor who chose Canada; the US visitor never sees it (no mixing).
 *
 * #328: and it is the CANADIAN monthly price, which is the whole point. This
 * chip is the largest thing a Canadian reader sees on the page, and it used to
 * quote a figure their card would never be charged.
 */
export const PRICING_DATELINE_CA = `${price("starter", "cad")}/MO · NO REGISTRATION FEE`;

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

/* Plan facts from PLAN_PRICING (the plans.ts mirror) for the seat and number
   counts, and from the shared price book for the money, in human words, nothing
   omitted. #121: no allowance or per-text figures on marketing surfaces; the
   concrete numbers live only on /legal/fair-use, which the page links. */
export function plansFor(currency: BillingCurrency): Plan[] {
  return [
    {
      id: "starter",
      name: "Starter",
      price: price("starter", currency),
      tagline: "For crews of one to three.",
      features: [
        `${S.seats} teammates included`,
        `${S.numbers} local business number (US or Canada, your area code)`,
        "Send and receive texts and pictures*",
        "Month to month, cancel anytime",
      ],
      cta: "Start with Starter",
    },
    {
      id: "pro",
      name: "Pro",
      price: price("pro", currency),
      tagline: "For crews up to fifteen, and a second number.",
      badge: "For bigger crews",
      highlighted: true,
      features: [
        `${P.seats} teammates included`,
        `${P.numbers} local business numbers (two locations, or office and field)`,
        "Send and receive texts and pictures*",
        "Month to month, cancel anytime",
      ],
      cta: "Start with Pro",
    },
  ];
}

/**
 * The plan cards as the page server-renders them: USD, the SSR country default.
 *
 * #328 NOTE, and it is the one gap this module cannot close by itself. Unlike
 * the dateline and the honesty ledger, the plan builder is ONE instance shown
 * to both countries (it reads the country itself, for the registration-fee
 * line), so its cards need the currency at RENDER time rather than at module
 * time. The card prices and the receipt totals both live in
 * components/marketing/pricing/ (plan-builder.tsx + plan-math.ts); `plansFor`
 * is the hook they need, and until they call it a Canadian visitor still reads
 * the US figure on the two cards and in the receipt.
 */
export const PLANS: Plan[] = plansFor("usd");

/**
 * #85: the plan's allowances are a FAIR-USE line, not a hard wall. This footnote
 * sits under the plan builder and links to the fair-use policy — the reference
 * the whole dynamic-limits model leans on (a busy month is fine; we reach out
 * early rather than surprise anyone). It is the plan-card fair-use plumbing the
 * later "hide the raw numbers" work points behind. Dash-free (Law 6).
 */
export const PLAN_FAIR_USE_NOTE =
  "* Texting, pictures, and calling are included under fair use, not a hard wall: almost every crew stays well inside it, a busy month now and then is fine, and we reach out early if usage ever paces past what your plan covers. Extra texts, if a month runs hot, bill at a small per-text rate up to a spending cap you control. Storage is free on every plan, with no caps.";

/* Honesty Ledger (§5.3): every cost, before you pay. Add-on price mirrors
   apps/api/src/billing/modules.ts (regions_ca $5). #97/#103: pictures are
   included on every plan, so they appear under "Extra texts", not as an
   add-on. #134/D42: calling is included on every plan too, so the add-on row
   states that and names the one add-on left, Canada numbers. #121: no
   per-text rates, allowance figures, or minute figures here; the concrete
   mechanics live only on /legal/fair-use. Storage is free.

   #328: built per currency. The page renders LEDGER inside the `us` branch and
   LEDGER_CA inside the `ca` branch, so each list is read only by people billed
   in the currency it was built with. */
function ledgerFor(currency: BillingCurrency): LedgerEntry[] {
  return [
    {
      term: "Your plan",
      figure: `${price("starter", currency)} or ${price("pro", currency)}/mo`,
      detail: `Month to month. Starter covers ${S.seats} people, Pro covers ${P.seats}, flat either way.`,
    },
    {
      term: "Register with the phone companies",
      figure: `${registrationFee(currency)}, one time, ever`,
      detail:
        "The phone companies require every business that texts to register first. This covers the fee they charge to review and approve you, and we pay it on your behalf, including a resubmission if your first attempt bounces. Cancel and come back next year: you won't pay it again. " +
        `That means ${firstMonth("starter", currency)} your first month, then ${price("starter", currency)} every month after.`,
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
      // #328 GAP, stated rather than papered over: PLAN_MODULE_CARDS has no CAD
      // column, so the one add-on is quoted in USD to a Canadian reader. It is
      // also not sellable yet (the row says so), which is why this is a note and
      // not a blocker. The fix is a currency in the module catalog, not a
      // conversion here.
      figure: `${CANADA_NUMBERS.price}/mo`,
      detail:
        `Calling is included in every plan, not an add-on: incoming calls ring your crew inside Loonext and whoever is free answers, you call customers back from the app on your business number, and callers you miss leave a voicemail and get an automatic text back, with generous calling minutes under fair use (the mechanics live in our fair use policy). One add-on exists: Canada numbers, ${CANADA_NUMBERS.price}/mo, which adds Canadian numbers you can get and text alongside your US number. It isn't switchable on quite yet; we'll sell it when it works, at this price, and nothing here is required to text.`,
    },
    {
      term: "Tax",
      // #328 killed the old "(CAD billing isn't here yet)" line, which had
      // become the opposite of true: a Canadian workspace is priced, invoiced
      // and charged in Canadian dollars. Keeping that disclaimer next to a CAD
      // figure would have been the same page contradicting itself two rows
      // apart, which is exactly the failure mode this issue is about.
      detail:
        currency === "cad"
          ? "Your plan is priced and billed in Canadian dollars, plus tax where it applies, calculated at checkout. The amount on your statement doesn't move with the exchange rate."
          : "Prices are in US dollars, plus sales tax where it applies, calculated at checkout.",
    },
    {
      term: "That's the whole list.",
      detail:
        'Two plans, one optional add-on, one registration fee, and overage you cap. No setup fees, no per-user fees, no storage fees, no monthly "compliance" or "carrier" line items, no fee for canceling.',
    },
  ];
}

/** The US ledger: the US story, in the currency a US workspace is billed in. */
export const LEDGER: LedgerEntry[] = ledgerFor("usd");

/* The Canada Honesty Ledger. A Canadian business texting Canadian customers has
   no registration and no fee, so this list never shows the US $29 / $58-first-
   month story (owner ruling v1, 2026-07-08: a Canadian visitor never reads a US
   fee that doesn't apply). It shares the country-neutral rows with LEDGER (plan
   prices, extra texts, add-ons, tax) and swaps only the two rows that carry the
   registration fact. The FirstWeekTimeline card in the same band carries the
   "if you later text US customers" edge case, so this stays clean.

   #328: it now starts from the CAD ledger rather than the USD one. The rows it
   shares with the US list are the same SENTENCES, not the same figures, because
   a Canadian workspace is billed in Canadian dollars. */
export const LEDGER_CA: LedgerEntry[] = ledgerFor("cad").map((entry) => {
  if (entry.term === "Register with the phone companies") {
    return {
      term: "No registration, no setup fee",
      figure: `${formatMoney(0, "cad")}, ever`,
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
   two surfaces can never disagree.

   #328: this one table stays in US DOLLARS for every reader, and that is a
   decision rather than an oversight. Heymarket and Quo publish in USD, so the
   only way the arithmetic means anything is if all three columns are the same
   money. Converting our column to CAD while leaving theirs in USD would produce
   a comparison that flatters us by roughly the exchange rate. The footnote says
   which currency the table is in, and the reader's own price is the dateline at
   the top of this page. */
export const ELSEWHERE_COLUMNS: LedgerColumn[] = [
  { label: "Loonext Starter", highlight: true },
  { label: "Heymarket Standard", sub: COMPARE_AS_OF },
  { label: "Quo", sub: COMPARE_AS_OF },
];

export const ELSEWHERE_ROWS: LedgerTableRow[] = [
  {
    label: "Monthly software",
    cells: [
      `${price("starter", "usd")} flat`,
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
      price("starter", "usd"),
      "~$172",
      "~$64 + extra numbers at $5 ea.",
    ],
  },
];

export const ELSEWHERE_FOOTNOTE =
  "Competitor prices from their public pricing pages, July 2026; each figure is sourced on the matching comparison page. Every figure in this table is in US dollars, which is what Heymarket and Quo publish in, so the Loonext row is our US price; Canadian workspaces are quoted and billed in Canadian dollars. Heymarket's texting total assumes 500 single-segment texts at their published 3¢/segment plus their $10/mo per-campaign carrier fee. Quo's total is $57 in seats plus ~$5 of metered texting (1¢/segment) plus their published $1.50 to $3 monthly carrier maintenance, and extra numbers are $5 each. " +
  `One-time registration fees excluded for all (ours is ${registrationFee("usd")}; Quo discloses $19.50; others don't say). If any number changes, tell us and we'll fix it.`;

/* Pricing FAQ (9). COPY-DECK v2 + #121 amendment: all nine kept, dash-free.
   The photo answer states the included-pictures and free-storage truth
   (#97/#103/#121: no add-on, no caps; counting mechanics live on
   /legal/fair-use), the "not getting" answer carries the included-calling
   facts (#134/D42: the $8 module retired — calling ships on every plan,
   both directions), and the keep-my-number answer mirrors the verified
   porting story. NO FAQPage JSON-LD. */
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
    // #328: the question dropped its figure rather than gaining a currency.
    // This is the one FAQ list on the page, read by both countries, so a
    // hard-coded fee here was wrong for half its readers; and the answer is
    // "at most once, ever" no matter what the number is, so the figure was
    // carrying nothing. The amount is stated in the honesty ledger above, in
    // the reader's own money.
    q: "Will I ever pay the registration fee twice?",
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
    // #328: this answer used to say "CAD billing is coming; until it's real, we
    // won't pretend otherwise". It is real now, and the sentence that was
    // honest in July is the one that misleads in August. Rewritten rather than
    // deleted, because "what currency am I charged in" is the question a
    // Canadian reader arrives with either way.
    q: "What currency am I billed in?",
    a: "Whichever your business is in. A Canadian workspace is priced and charged in Canadian dollars, so the amount doesn't move with the exchange rate and your bank has no conversion to add on top. A US workspace is charged in US dollars. The country you pick at signup decides it, and it's fixed once your subscription starts, so tell us before you pay if you picked the wrong one.",
  },
  {
    q: "What am I not getting at these prices?",
    a: "Loonext is your business line and the work that comes out of it, not a call center: no mass text blasts, no review management, no phone menus, no queues, and no desk phones or SIP handsets. Calling is included on every plan: the app itself is the phone, so incoming calls ring the whole crew inside Loonext and whoever is free answers, you call customers back on that same business number, and callers you miss leave a voicemail we write down and get an automatic text back, so the lead still lands in your inbox. The minutes are generous under fair use, with the exact mechanics in our fair use policy. If you need blasts or review tools, a bigger platform might fit better; our comparison pages say so honestly.",
  },
];
