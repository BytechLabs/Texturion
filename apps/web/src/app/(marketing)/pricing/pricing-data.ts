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

 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { pricingCopy } from "@/i18n/marketing/pricing";
import {
  type BillingCurrency,
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
} from "@loonext/shared";

import { PLAN_MODULE_CARDS, PLAN_PRICING, type PlanId } from "@/lib/api/types";

import { compareAsOf } from "../compare/verification";

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

const price = (plan: PlanId, audience: BillingCurrency) =>
  formatMoney(PLAN_PRICE_CENTS.usd[plan], "usd", audience);

/** The one-time US texting registration fee, on the invoice it lands on. */
const registrationFee = (audience: BillingCurrency) =>
  formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd", audience);

/**
 * Plan plus the one-time fee: what a US shop actually pays in month one.
 *
 * Derived rather than written. It is the only figure on the page that is a SUM,
 * so it is the only one that can go wrong while both of its parts stay right.
 */
const firstMonth = (plan: PlanId, audience: BillingCurrency) =>
  formatMoney(
    PLAN_PRICE_CENTS.usd[plan] + US_REGISTRATION_FEE_CENTS.usd,
    "usd",
    audience,
  );

/** The dateline chip: the page's load-bearing fact (§5.1). US default. */
export const pricingDateline = (locale: MarketingLocale = "en") =>
  fill(pricingCopy(locale).datelineUs, {
    firstMonth: firstMonth("starter", "usd"),
    starter: price("starter", "usd"),
  });

/** The English dateline, for tests and any English-only surface. */
export const PRICING_DATELINE = pricingDateline("en");

/** Canadian businesses texting Canadian customers skip registration. */
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

export const ledgerCa = (locale: MarketingLocale = "en"): LedgerEntry[] => {
  const copy = pricingCopy(locale);
  return ledgerFor("cad", locale)
    .filter((entry) => entry.id !== "add-ons")
    .map((entry) => {
      if (entry.id === "registration") {
        return {
          id: entry.id,
          term: copy.ledgerNoRegisterTerm,
          figure: fill(copy.ledgerNoRegisterFigure, {
            zero: formatMoney(0, "usd", "cad"),
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
  { label: "Heymarket Standard", sub: compareAsOf(locale) },
  { label: "Quo", sub: compareAsOf(locale) },
];

/** The English columns, for tests and any English-only surface. */
export const ELSEWHERE_COLUMNS: LedgerColumn[] = elsewhereColumns("en");

export const elsewhereRows = (
  locale: MarketingLocale = "en",
): LedgerTableRow[] => {
  const copy = pricingCopy(locale);
  const french = locale === "fr-CA";
  return [
  {
    label: copy.elsewhereSoftware,
    cells: [
      fill(copy.elsewhereFlat, { starter: price("starter", "usd") }),
      french ? "49 $ US/personne/mois × 3 = 147 $ US" : "$49/user/mo × 3 = $147",
      french
        ? "19 $ US/personne/mois × 3 = 57 $ US (facturation mensuelle)"
        : "$19/user/mo × 3 = $57 (monthly billing)",
    ],
  },
  {
    // #121: an explicit workload scenario for the competitor math, never an
    // allowance claim. The competitor cells are their published prices.
    label: copy.elsewhereWorkload,
    cells: [
      copy.elsewhereIncluded,
      french ? "~15 $ US (3 ¢ US/segment × 500)" : "~$15 (3¢/segment × 500)",
      copy.elsewhereQuoTexting,
    ],
  },
  {
    label: copy.elsewhereCarrier,
    cells: french
      ? ["0 $ US", "10 $ US/mois", "1,50 à 3 $ US/mois"]
      : ["$0", "$10/mo", "$1.50 to $3/mo"],
  },
  {
    label: copy.elsewhereTotal,
    total: true,
    cells: [
      french ? "29 $ US" : price("starter", "usd"),
      french ? "~172 $ US" : "~$172",
      copy.elsewhereQuoTotal,
    ],
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
