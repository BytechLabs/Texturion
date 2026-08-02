import {
  formatMoney,
  PLAN_PRICE_CENTS,
  PLAN_SEATS,
  type BillingCurrency,
} from "@loonext/shared";

/**
 * #385 — the price and the seat count it covers, as one thing.
 *
 * The pricing section was careful: "For crews of one to three", the
 * more-than-15 escape hatch, the activation wait disclosed unprompted. But
 * `$29 /mo · the whole crew` was rendered in the site's LARGEST typographic
 * treatment on the home truth bar and on **every feature page**, and neither
 * carried the qualifier. Feature pages are what search and the nav actually
 * deliver people to, so the surface making the least qualified claim was the
 * one most visitors saw first.
 *
 * D12 puts the ICP at 1–10 field staff and Starter covers 1–3 of that range, so
 * for most of our own stated target market $29 is not the price they will pay.
 * A six-person crew pays $79.
 *
 * THE FIX IS THAT THE CLAIM CANNOT TRAVEL WITHOUT ITS QUALIFIER, which is the
 * D79 shape #385's own comment asks for: one declared resolver, and a test that
 * enumerates who may decide. `headline-price.test.ts` walks every `MonoFigure`
 * in the marketing tree and fails on a `$29` that supplies its own suffix.
 * Correctness is structural rather than something to remember on the next page
 * somebody builds.
 *
 * THE SEAT COUNT IS DERIVED, not typed. `PLAN_SEATS.starter` is the same
 * constant the seat gate enforces, so the marketing claim and the thing that
 * blocks a fourth invite cannot drift apart — which is #334's complaint about
 * claims stated with nothing tying them to the decision behind them.
 *
 * WHY THIS WORDING. "the whole crew" is half the binding tagline and reads
 * well; "up to 3" is exact and reads like a limit. #385 leaves the short form
 * as a copy call and suggests keeping both, which is right: the rhythm survives
 * and the sentence stops being nearly true. The comparison against a $49/seat
 * competitor still wins on the arithmetic our own page already does — we were
 * risking credibility for margin we already had.
 */
export function headlinePrice(currency: BillingCurrency): string {
  return formatMoney(PLAN_PRICE_CENTS[currency].starter, currency);
}

/**
 * The USD figure, for the surfaces that genuinely cannot branch.
 *
 * #328: an OpenGraph image is rendered to a PNG at build time, once per URL,
 * with no visitor and therefore no country. It has to name A currency, and USD
 * is the one every workspace was on before this shipped. Everything that CAN
 * see a country must call `headlinePrice()` instead — a static fallback used
 * where a live signal exists is how a Canadian ends up reading a US price.
 */
export const HEADLINE_PRICE = headlinePrice("usd");

/**
 * The suffix that must accompany it. Never inline this string at a call site —
 * the test exists to make that impossible.
 */
export const HEADLINE_PRICE_SUFFIX = `/mo · the whole crew, up to ${PLAN_SEATS.starter}`;
