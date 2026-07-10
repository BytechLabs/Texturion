/**
 * #12 modular plan builder — the opt-in module catalog. The BASE plan (starter
 * or pro, see plans.ts) always includes texting (in+out segment allowance), one
 * US number, and US 10DLC. Everything here is a toggleable add-on so a customer
 * only pays for what they use ("not everyone needs everything").
 *
 * Each module gates one cost-incurring capability and — when billed — maps to a
 * Stripe licensed (+ optional metered) price created by `pnpm stripe:setup` and
 * referenced by env id, exactly like the base plan prices. The numbers below
 * are DECISIONS owned per the #12 "make all decisions yourself" directive:
 * placeholders sized above true cost (docs/PRICING-AUDIT.md §8), kept as
 * constants so retuning is one edit. Enablement lives in `company_modules`;
 * `company-modules.ts` reads it, checkout writes it.
 */
import type { Env } from "../env";
import { EXTRA_STORAGE_BYTES, PLAN_VOICE_MINUTES } from "./plans";

/**
 * The toggleable modules (mirrors the company_modules.module CHECK).
 * #97/#103: `mms` is RETIRED — picture messages are free and meter as segments
 * (3 per MMS through the normal usage pipeline), so the paid add-on is gone
 * from the catalog. Stale Stripe line items are stripped by the daily
 * reconcile's retired-price sweep (billing/reconcile.ts).
 */
export const PLAN_MODULES = ["voice", "extra_storage", "regions_ca"] as const;
export type PlanModule = (typeof PLAN_MODULES)[number];

export interface ModuleSpec {
  id: PlanModule;
  /** Plan-builder card title. */
  label: string;
  /** One-line plain-language description for the plan-builder card. */
  blurb: string;
  /**
   * A concrete, quantifiable line ("300 forwarded minutes a month") sourced
   * from the plan constants, so the add-on cards say what you actually get.
   * Omitted where there is no honest number to state yet.
   */
  detail?: string;
  /** Monthly add-on price in cents (the licensed Stripe price). */
  monthlyCents: number;
  /** The capability this module gates, for the "why is this off?" copy. */
  gates: string;
  /** Name of the env var holding this module's licensed Stripe price id. */
  priceEnvKey: string;
}

export const MODULE_CATALOG: Record<PlanModule, ModuleSpec> = {
  voice: {
    id: "voice",
    label: "Call forwarding",
    blurb:
      "Forward calls from your business number to your cell, and text back the ones you miss.",
    detail: `${PLAN_VOICE_MINUTES.starter} forwarded minutes a month included.`,
    monthlyCents: 800,
    gates: "forwarding incoming calls",
    priceEnvKey: "STRIPE_MODULE_VOICE_PRICE_ID",
  },
  extra_storage: {
    id: "extra_storage",
    label: "Extra storage",
    blurb:
      "More room for files on notes and saved picture messages, on top of your plan's included storage.",
    detail: `Adds ${EXTRA_STORAGE_BYTES / 1024 ** 3} GB to each storage pool (files and pictures).`,
    monthlyCents: 500,
    gates: "extra file + picture storage",
    priceEnvKey: "STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID",
  },
  regions_ca: {
    id: "regions_ca",
    label: "Canada numbers",
    blurb: "Get and text Canadian phone numbers alongside your US number.",
    monthlyCents: 500,
    gates: "using Canadian numbers",
    priceEnvKey: "STRIPE_MODULE_REGIONS_CA_PRICE_ID",
  },
};

/** Type guard: is a raw string one of the known modules? */
export function isPlanModule(value: string): value is PlanModule {
  return (PLAN_MODULES as readonly string[]).includes(value);
}

/**
 * The configured Stripe licensed price id for a module, or null when the
 * catalog hasn't been provisioned in this environment yet (the env id is
 * optional so the Worker boots without it). Checkout treats null as "module
 * not purchasable here" and rejects a selection referencing it.
 */
export function modulePrice(env: Env, module: PlanModule): string | null {
  switch (module) {
    case "voice":
      return env.STRIPE_MODULE_VOICE_PRICE_ID ?? null;
    case "extra_storage":
      return env.STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID ?? null;
    case "regions_ca":
      return env.STRIPE_MODULE_REGIONS_CA_PRICE_ID ?? null;
  }
}

/** Which module a Stripe price id belongs to; null for a non-module price. */
export function moduleForPrice(env: Env, priceId: string): PlanModule | null {
  for (const module of PLAN_MODULES) {
    if (modulePrice(env, module) === priceId) return module;
  }
  return null;
}

/**
 * #103: Stripe prices of RETIRED modules. These no longer sell or map to a
 * catalog module, but an existing subscription may still carry a line item on
 * one — the daily reconcile (billing/reconcile.ts) strips such items with a
 * prorated credit so the customer stops being billed for a module that no
 * longer exists. Empty when the price was never provisioned in this
 * environment (then the sweep is a no-op).
 */
export function retiredModulePrices(env: Env): string[] {
  return [env.STRIPE_MODULE_MMS_PRICE_ID].filter(
    (price): price is string => typeof price === "string" && price.length > 0,
  );
}
