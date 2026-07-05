/**
 * #12 plan builder — read side of `company_modules`. `isModuleEnabled` is the
 * gate every module-guarded action calls; `enabledModules` powers the usage /
 * plan-builder surfaces. A row with `disabled_at IS NULL` means ON.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EXTRA_STORAGE_BYTES,
  MMS_STORAGE_BUDGET_BYTES,
  STORAGE_BUDGET_BYTES,
  type PlanId,
} from "./plans";
import { isPlanModule, type PlanModule } from "./modules";

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

/**
 * #12: the company's EFFECTIVE storage budgets — the plan's base attachment +
 * MMS pools, each grown by EXTRA_STORAGE_BYTES when the extra_storage module is
 * on. The single source of truth for every storage gate/alert/meter so they
 * never disagree about how much room a company actually has.
 */
export async function effectiveStorageBudgets(
  db: SupabaseClient,
  companyId: string,
  plan: PlanId,
): Promise<{ attachmentBytes: number; mmsBytes: number }> {
  const extra = (await isModuleEnabled(db, companyId, "extra_storage"))
    ? EXTRA_STORAGE_BYTES
    : 0;
  return {
    attachmentBytes: STORAGE_BUDGET_BYTES[plan] + extra,
    mmsBytes: MMS_STORAGE_BUDGET_BYTES[plan] + extra,
  };
}
