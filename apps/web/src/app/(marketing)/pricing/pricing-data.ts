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

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { pricingCopy } from "@/i18n/marketing/pricing";
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
export const pricingDateline = (locale: MarketingLocale = "en") =>
  fill(pricingCopy(locale).datelineUs, {
    firstMonth: firstMonth("starter", "usd"),
    starter: price("starter", "usd"),
  });

/** The English dateline, for tests and any English-only surface. */
export const PRICING_DATELINE = pricingDateline("en");

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
export const pricingDatelineCa = (locale: MarketingLocale = "en") =>
  fill(pricingCopy(locale).datelineCa, { starter: price("starter", "cad") });

/** The English Canadian dateline, for tests and any English-only surface. */
export const PRICING_DATELINE_CA = pricingDatelineCa("en");

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
export function plansFor(
  currency: BillingCurrency,
  locale: MarketingLocale = "en",
): Plan[] {
  const copy = pricingCopy(locale);
  return [
    {
      id: "starter",
      // Starter and Pro are the plan names on the invoice, so they read the
      // same in both languages.
      name: "Starter",
      price: price("starter", currency),
      tagline: copy.planStarterTagline,
      features: [
        fill(copy.planSeats, { seats: String(S.seats) }),
        fill(copy.planOneNumber, { numbers: String(S.numbers) }),
        copy.planTexts,
        copy.planMonthly,
      ],
      cta: copy.planStarterCta,
    },
    {
      id: "pro",
      name: "Pro",
      price: price("pro", currency),
      tagline: copy.planProTagline,
      badge: copy.planProBadge,
      highlighted: true,
      features: [
        fill(copy.planSeats, { seats: String(P.seats) }),
        fill(copy.planTwoNumbers, { numbers: String(P.numbers) }),
        copy.planTexts,
        copy.planMonthly,
      ],
      cta: copy.planProCta,
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
export const planFairUseNote = (locale: MarketingLocale = "en") =>
  pricingCopy(locale).planFairUseNote;

/** The English note, for tests and any English-only surface. */
export const PLAN_FAIR_USE_NOTE = planFairUseNote("en");

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
function ledgerFor(
  currency: BillingCurrency,
  locale: MarketingLocale = "en",
): LedgerEntry[] {
  const copy = pricingCopy(locale);
  return [
    {
      id: "plan",
      term: copy.ledgerPlanTerm,
      figure: `${price("starter", currency)} or ${price("pro", currency)}/mo`,
      detail: fill(copy.ledgerPlanDetail, {
        starterSeats: String(S.seats),
        proSeats: String(P.seats),
      }),
    },
    {
      id: "registration",
      term: copy.ledgerRegisterTerm,
      figure: fill(copy.ledgerRegisterFigure, {
        fee: registrationFee(currency),
      }),
      detail: fill(copy.ledgerRegisterDetail, {
        firstMonth: firstMonth("starter", currency),
        starter: price("starter", currency),
      }),
    },
    {
      id: "extra-texts",
      term: copy.ledgerExtraTerm,
      figure: copy.ledgerExtraFigure,
      detail: copy.ledgerExtraDetail,
    },
    {
      id: "storage",
      term: copy.ledgerStorageTerm,
      figure: copy.ledgerStorageFigure,
      detail: copy.ledgerStorageDetail,
    },
    {
      id: "add-ons",
      term: copy.ledgerAddOnsTerm,
      // #328 GAP, stated rather than papered over: PLAN_MODULE_CARDS has no CAD
      // column, so the one add-on is quoted in USD to a Canadian reader. It is
      // also not sellable yet (the row says so), which is why this is a note and
      // not a blocker. The fix is a currency in the module catalog, not a
      // conversion here.
      figure: `${CANADA_NUMBERS.price}/mo`,
      detail: fill(copy.ledgerAddOnsDetail, { addOn: CANADA_NUMBERS.price }),
    },
    {
      id: "tax",
      term: copy.ledgerTaxTerm,
      detail:
        currency === "cad" ? copy.ledgerTaxDetailCa : copy.ledgerTaxDetailUs,
    },
    {
      id: "whole-list",
      term: copy.ledgerWholeListTerm,
      detail: copy.ledgerWholeListDetailUs,
    },
  ];
}

/** The US ledger: the US story, in the currency a US workspace is billed in. */
export const ledger = (locale: MarketingLocale = "en"): LedgerEntry[] =>
  ledgerFor("usd", locale);

/** The English US ledger, for tests and any English-only surface. */
export const LEDGER: LedgerEntry[] = ledger("en");

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
export const ledgerCa = (locale: MarketingLocale = "en"): LedgerEntry[] => {
  const copy = pricingCopy(locale);
  return ledgerFor("cad", locale).map((entry) => {
    // Matched on `id`, not on `term`. The term is a label now and changes with
    // the language; the row it names does not.
    if (entry.id === "registration") {
      return {
        id: entry.id,
        term: copy.ledgerNoRegisterTerm,
        figure: fill(copy.ledgerNoRegisterFigure, {
          zero: formatMoney(0, "cad"),
        }),
        detail: copy.ledgerNoRegisterDetail,
      };
    }
    if (entry.id === "whole-list") {
      return { ...entry, detail: copy.ledgerWholeListDetailCa };
    }
    return entry;
  });
};

/** The English Canadian ledger, for tests and any English-only surface. */
export const LEDGER_CA: LedgerEntry[] = ledgerCa("en");

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
export const elsewhereColumns = (
  locale: MarketingLocale = "en",
): LedgerColumn[] => [
  { label: pricingCopy(locale).elsewhereLoonext, highlight: true },
  { label: "Heymarket Standard", sub: COMPARE_AS_OF },
  { label: "Quo", sub: COMPARE_AS_OF },
];

/** The English columns, for tests and any English-only surface. */
export const ELSEWHERE_COLUMNS: LedgerColumn[] = elsewhereColumns("en");

export const elsewhereRows = (
  locale: MarketingLocale = "en",
): LedgerTableRow[] => {
  const copy = pricingCopy(locale);
  return [
  {
    label: copy.elsewhereSoftware,
    cells: [
      fill(copy.elsewhereFlat, { starter: price("starter", "usd") }),
      "$49/user/mo × 3 = $147",
      "$19/user/mo × 3 = $57 (monthly billing)",
    ],
  },
  {
    // #121: an explicit workload scenario for the competitor math, never an
    // allowance claim. The competitor cells are their published prices.
    label: copy.elsewhereWorkload,
    cells: [
      copy.elsewhereIncluded,
      "~$15 (3¢/segment × 500)",
      copy.elsewhereNotIncluded,
    ],
  },
  {
    label: copy.elsewhereCarrier,
    cells: ["$0", "$10/mo", "$1.50 to $3/mo"],
  },
  {
    label: copy.elsewhereTotal,
    total: true,
    cells: [price("starter", "usd"), "~$172", copy.elsewhereQuoTotal],
  },
  ];
};

/** The English rows, for tests and any English-only surface. */
export const ELSEWHERE_ROWS: LedgerTableRow[] = elsewhereRows("en");

export const elsewhereFootnote = (locale: MarketingLocale = "en") =>
  fill(pricingCopy(locale).elsewhereFootnote, {
    fee: registrationFee("usd"),
  });

/** The English footnote, for tests and any English-only surface. */
export const ELSEWHERE_FOOTNOTE = elsewhereFootnote("en");

/* Pricing FAQ (9). COPY-DECK v2 + #121 amendment: all nine kept, dash-free.
   The photo answer states the included-pictures and free-storage truth
   (#97/#103/#121: no add-on, no caps; counting mechanics live on
   /legal/fair-use), the "not getting" answer carries the included-calling
   facts (#134/D42: the $8 module retired — calling ships on every plan,
   both directions), and the keep-my-number answer mirrors the verified
   porting story. NO FAQPage JSON-LD. */
export const faqs = (
  locale: MarketingLocale = "en",
): { q: string; a: string }[] => {
  const copy = pricingCopy(locale);
  return [
    { q: copy.faqTrialQ, a: copy.faqTrialA },
    { q: copy.faqInboundQ, a: copy.faqInboundA },
    { q: copy.faqPhotosQ, a: copy.faqPhotosA },
    { q: copy.faqOverageQ, a: copy.faqOverageA },
    // #328: the question dropped its figure rather than gaining a currency.
    // This is the one FAQ list on the page, read by both countries, so a
    // hard-coded fee here was wrong for half its readers; and the answer is
    // "at most once, ever" no matter what the number is, so the figure was
    // carrying nothing. The amount is stated in the honesty ledger above, in
    // the reader's own money.
    { q: copy.faqFeeTwiceQ, a: copy.faqFeeTwiceA },
    { q: copy.faqChangeQ, a: copy.faqChangeA },
    { q: copy.faqPortQ, a: copy.faqPortA },
    { q: copy.faqCurrencyQ, a: copy.faqCurrencyA },
    { q: copy.faqNotGettingQ, a: copy.faqNotGettingA },
  ];
};

/** The English list, for tests and any English-only surface. */
export const FAQS: { q: string; a: string }[] = faqs("en");

