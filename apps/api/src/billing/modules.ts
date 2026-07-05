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

/** The toggleable modules (mirrors the company_modules.module CHECK). */
export const PLAN_MODULES = [
  "mms",
  "voice",
  "extra_storage",
  "regions_ca",
] as const;
export type PlanModule = (typeof PLAN_MODULES)[number];

export interface ModuleSpec {
  id: PlanModule;
  /** Plan-builder card title. */
  label: string;
  /** One-line plain-language description for the plan-builder card. */
  blurb: string;
  /** Monthly add-on price in cents (the licensed Stripe price). */
  monthlyCents: number;
  /** The capability this module gates, for the "why is this off?" copy. */
  gates: string;
  /** Name of the env var holding this module's licensed Stripe price id. */
  priceEnvKey: string;
}

export const MODULE_CATALOG: Record<PlanModule, ModuleSpec> = {
  mms: {
    id: "mms",
    label: "Picture messages",
    blurb:
      "Send photos and images in your texts. (Incoming pictures are always received.)",
    monthlyCents: 500,
    gates: "sending picture (MMS) messages",
    priceEnvKey: "STRIPE_MODULE_MMS_PRICE_ID",
  },
  voice: {
    id: "voice",
    label: "Call forwarding",
    blurb:
      "Forward calls from your business number to your cell, and text back the ones you miss.",
    monthlyCents: 800,
    gates: "forwarding incoming calls",
    priceEnvKey: "STRIPE_MODULE_VOICE_PRICE_ID",
  },
  extra_storage: {
    id: "extra_storage",
    label: "Extra storage",
    blurb:
      "More room for files on notes and saved picture messages, on top of your plan's included storage.",
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
