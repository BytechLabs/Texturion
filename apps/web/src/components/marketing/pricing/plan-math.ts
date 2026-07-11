/**
 * Pure math for the /pricing plan builder (owner ruling 2026-07-07, amendment
 * 13: "The /pricing centerpiece is the real plan builder ... a live monthly
 * total computed from the product's shared constants, single source, zero
 * retyped numbers").
 *
 * Every dollar figure here is DERIVED, never typed:
 *   - plan prices come from PLAN_PRICING (lib/api/types.ts, the hand-kept
 *     mirror of apps/api/src/billing/plans.ts + the SPEC §2 Stripe catalog);
 *   - add-on prices are parsed out of PLAN_MODULE_CARDS, the same catalog
 *     mirror the onboarding plan builder and the home pricing section render
 *     from, so the marketing total can never disagree with checkout;
 *   - the one-time US registration fee is US_REGISTRATION_FEE_DOLLARS.
 *
 * regions_ca is filtered out ON PURPOSE: the API refuses to sell it until
 * multi-region provisioning ships (SELLABLE_MODULES in
 * apps/api/src/billing/company-modules.ts), and we never sell what a buyer
 * can't buy. extra_storage (#121: storage is free) and voice (#134/D42:
 * calling is included on every plan) are filtered the same way; those two
 * are belt-and-suspenders since the catalog mirror no longer carries them.
 * With voice retired the sellable set is EMPTY today — the builder hides its
 * add-on step rather than render a heading over nothing.
 *
 * Plain module (no JSX) so plan-builder.test.tsx can exercise the math
 * without rendering, and so both the client island and server components can
 * share it.
 */

import {
  PLAN_MODULE_CARDS,
  PLAN_PRICING,
  US_REGISTRATION_FEE_DOLLARS,
  type PlanId,
  type PlanModule,
  type PlanModuleCard,
} from "@/lib/api/types";
import { APP_LINKS } from "@/lib/marketing/site";

/** Modules marketing never sells: regions_ca (not purchasable yet),
 *  extra_storage (retired by #121: storage is free), and voice (retired by
 *  #134/D42: calling is included on every plan). */
const UNSELLABLE_MODULES: readonly string[] = [
  "regions_ca",
  "extra_storage",
  "voice",
];

/** The add-ons a buyer can actually purchase today (API SELLABLE_MODULES). */
export const SELLABLE_ADDON_CARDS: PlanModuleCard[] = PLAN_MODULE_CARDS.filter(
  (card) => !UNSELLABLE_MODULES.includes(card.id),
);

/**
 * A sellable add-on's monthly price in whole USD, read out of the catalog
 * mirror's own "$5" string so the number exists in exactly one place. Throws
 * on an unparseable price: a broken catalog entry must fail the build/tests,
 * never render a wrong total.
 */
export function addonMonthlyDollars(card: PlanModuleCard): number {
  const parsed = Number(card.price.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Unparseable module price for "${card.id}": ${JSON.stringify(card.price)}`,
    );
  }
  return parsed;
}

/** One buildable configuration: a plan plus zero or more sellable add-ons. */
export interface PlanSelection {
  plan: PlanId;
  addons: readonly PlanModule[];
}

/**
 * The SSR default state (owner ruling: "Starter, no add-ons, $29"), rendered
 * before (and without) JavaScript. Zero fake state: this is exactly what the
 * checkout defaults to.
 */
export const DEFAULT_SELECTION: PlanSelection = { plan: "starter", addons: [] };

/** The recurring monthly total for a selection, in whole USD. */
export function monthlyTotalDollars(selection: PlanSelection): number {
  return SELLABLE_ADDON_CARDS.filter((card) =>
    selection.addons.includes(card.id),
  ).reduce(
    (sum, card) => sum + addonMonthlyDollars(card),
    PLAN_PRICING[selection.plan].monthlyDollars,
  );
}

/**
 * The US-shop first-month total: the monthly total plus the one-time carrier
 * registration fee. ALWAYS presented as a separate line next to the monthly
 * figure, never rolled into it (owner ruling).
 */
export function firstMonthTotalDollars(selection: PlanSelection): number {
  return monthlyTotalDollars(selection) + US_REGISTRATION_FEE_DOLLARS;
}

/** "$29" / "$1,234" (whole-dollar USD; totals here are always whole). */
export function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/**
 * The signup URL carrying the chosen configuration (owner ruling: "the
 * builder's CTA carries the chosen configuration into signup"). Add-ons are
 * emitted in catalog order so the same selection always yields the same URL.
 */
export function signupHref(selection: PlanSelection): string {
  const params = new URLSearchParams({ plan: selection.plan });
  const addons = SELLABLE_ADDON_CARDS.filter((card) =>
    selection.addons.includes(card.id),
  ).map((card) => card.id);
  if (addons.length > 0) params.set("modules", addons.join(","));
  return `${APP_LINKS.signup}?${params.toString()}`;
}
