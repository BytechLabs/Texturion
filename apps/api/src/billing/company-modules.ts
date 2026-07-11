/**
 * #12 plan builder — the `company_modules` state layer. `isModuleEnabled` is
 * the gate every module-guarded action calls; `enabledModules` powers the
 * usage / plan-builder surfaces; `planModuleReconcile` + `applyModuleReconcile`
 * converge the table onto the Stripe subscription's actual module line items
 * (#17). A row with `disabled_at IS NULL` means ON.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
} from "./plans";
import { isPlanModule, PLAN_MODULES, type PlanModule } from "./modules";

/**
 * #41: the subset of the catalog we actually SELL today. `regions_ca` is
 * admittedly inert — nothing in number provisioning reads it yet — so selling
 * it would charge $5/mo for nothing (a chargeback/trust risk). It stays in the
 * catalog (GET /v1/billing/modules reports it with `available: false` as
 * coming-soon), but checkout and the module toggle refuse it server-side until
 * multi-region provisioning ships. Grandfathered seed rows are untouched.
 * (#103: `mms` left the catalog entirely — picture messages are free now.)
 */
export const SELLABLE_MODULES: readonly PlanModule[] = PLAN_MODULES.filter(
  (module) => module !== "regions_ca",
);

/** Is the module deliverable — i.e. allowed to be sold — today? (#41) */
export function isSellableModule(module: PlanModule): boolean {
  return SELLABLE_MODULES.includes(module);
}

/** Is a specific module currently enabled for the company? */
export async function isModuleEnabled(
  db: SupabaseClient,
  companyId: string,
  module: PlanModule,
): Promise<boolean> {
  const { data, error } = await db
    .from("company_modules")
    .select("module")
    .eq("company_id", companyId)
    .eq("module", module)
    .is("disabled_at", null)
    .limit(1);
  if (error) {
    throw new Error(`company_modules lookup failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/** The set of currently-enabled modules for the company. */
export async function enabledModules(
  db: SupabaseClient,
  companyId: string,
): Promise<PlanModule[]> {
  const { data, error } = await db
    .from("company_modules")
    .select("module")
    .eq("company_id", companyId)
    .is("disabled_at", null);
  if (error) {
    throw new Error(`company_modules lookup failed: ${error.message}`);
  }
  return ((data ?? []) as { module: string }[])
    .map((row) => row.module)
    .filter(isPlanModule);
}

/** #133: enabled modules WITH the grandfathered flag — the overage
 *  projection needs both (a grandfathered voice module earns no revenue and
 *  pauses at the legacy allowance). */
export async function enabledModuleFlags(
  db: SupabaseClient,
  companyId: string,
): Promise<{ module: PlanModule; grandfathered: boolean }[]> {
  const { data, error } = await db
    .from("company_modules")
    .select("module,grandfathered")
    .eq("company_id", companyId)
    .is("disabled_at", null);
  if (error) {
    throw new Error(`company_modules lookup failed: ${error.message}`);
  }
  return ((data ?? []) as { module: string; grandfathered: boolean }[])
    .filter((row) => isPlanModule(row.module))
    .map((row) => ({
      module: row.module as PlanModule,
      grandfathered: row.grandfathered === true,
    }));
}

/** The `company_modules` row shape the #17 reconcile decides from. */
export interface CompanyModuleRow {
  module: string;
  disabled_at: string | null;
  grandfathered: boolean;
}

/** The writes that converge `company_modules` onto the paid module set (#17). */
export interface ModuleReconcilePlan {
  enable: PlanModule[];
  disable: PlanModule[];
}

/**
 * #17: derive the writes that converge `company_modules` onto the set of
 * modules the live Stripe subscription actually PAYS for. Pure so every entry
 * point (checkout completion, subscription sync, daily reconcile) decides
 * identically:
 *
 * - a paid module that is missing, disabled, or still grandfathered is
 *   (re-)enabled with the grandfather flag cleared — the company pays now, so
 *   from here on the subscription is the truth for it;
 * - an enabled module with a configured price but NO paid line item is
 *   disabled, UNLESS grandfathered (the 20260704160000 seeds granted live
 *   pre-#12 capability without a line item on purpose). Without this, a
 *   cancel-then-resubscribe-base-only keeps every add-on active for $0.
 *
 * `billable` is the set of modules whose Stripe price is configured in this
 * environment — a module we cannot bill is a module whose paid-ness we cannot
 * judge, so it is never auto-disabled.
 */
export function planModuleReconcile(
  rows: CompanyModuleRow[],
  paid: PlanModule[],
  billable: readonly PlanModule[],
): ModuleReconcilePlan {
  const byModule = new Map<PlanModule, CompanyModuleRow>();
  for (const row of rows) {
    if (isPlanModule(row.module)) byModule.set(row.module, row);
  }
  const paidSet = new Set(paid);
  const enable = [...paidSet].filter((module) => {
    const row = byModule.get(module);
    return !row || row.disabled_at !== null || row.grandfathered;
  });
  const disable = [...byModule.entries()]
    .filter(
      ([module, row]) =>
        row.disabled_at === null &&
        !row.grandfathered &&
        billable.includes(module) &&
        !paidSet.has(module),
    )
    .map(([module]) => module);
  return { enable, disable };
}

/**
 * Apply a {@link planModuleReconcile} plan. Disabling `voice` clears the
 * forwarding capability exactly like the POST /v1/billing/modules disable path
 * does — a module that is no longer paid for must stop costing us the moment
 * the reconcile sees it (cost-protection mandate). Idempotent: the enable
 * upsert converges on the same row and the disable update is guarded on
 * `disabled_at IS NULL`.
 */
export async function applyModuleReconcile(
  db: SupabaseClient,
  companyId: string,
  plan: ModuleReconcilePlan,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (plan.enable.length > 0) {
    const { error } = await db.from("company_modules").upsert(
      plan.enable.map((module) => ({
        company_id: companyId,
        module,
        enabled_at: nowIso,
        disabled_at: null,
        grandfathered: false,
      })),
      { onConflict: "company_id,module" },
    );
    if (error) {
      throw new Error(`module reconcile enable failed: ${error.message}`);
    }
  }
  if (plan.disable.length > 0) {
    const { error } = await db
      .from("company_modules")
      .update({ disabled_at: nowIso })
      .eq("company_id", companyId)
      .in("module", plan.disable)
      .is("disabled_at", null);
    if (error) {
      throw new Error(`module reconcile disable failed: ${error.message}`);
    }
    // #134/D42: voice retired — calling is included on every plan, so a
    // module disable never clears forwarding/MCTB settings anymore (the old
    // clear-on-voice-disable branch died with the module).
  }
}


