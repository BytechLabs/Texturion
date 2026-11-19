import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { expectOk, unwrap } from "../routes/core/http";
import { PLAN_LIMITS, planForLicensedPrice } from "./plans";
import type { Stripe } from "./stripe";

export const PENDING_PLAN_SEAT_LIMIT = "P8801";
export const PENDING_PLAN_NUMBER_LIMIT = "P8802";

interface ScheduledDowngrade {
  id: string;
  effectiveAt: string;
}

export function pendingDowngrade(env: Env, schedule: Stripe.SubscriptionSchedule): ScheduledDowngrade | null {
  if (schedule.status !== "active" && schedule.status !== "not_started") return null;
  const phase = schedule.phases.find((candidate) =>
    candidate.start_date >= (schedule.current_phase?.end_date ?? 0) &&
    candidate.items.some((item) =>
      planForLicensedPrice(env, typeof item.price === "string" ? item.price : item.price.id) === "starter",
    ),
  );
  return phase ? { id: schedule.id, effectiveAt: new Date(phase.start_date * 1000).toISOString() } : null;
}

export async function recordPendingDowngrade(
  db: SupabaseClient,
  companyId: string,
  subscriptionId: string,
  downgrade: ScheduledDowngrade,
  checkCapacity: boolean,
) {
  const limits = PLAN_LIMITS.starter;
  return unwrap<"scheduled" | "not_applicable" | "seat_limit" | "number_limit">(
    await db.rpc("api_record_pending_downgrade", {
      p_company_id: companyId,
      p_subscription_id: subscriptionId,
      p_schedule_id: downgrade.id,
      p_effective_at: downgrade.effectiveAt,
      p_seats: limits.seats,
      p_numbers: limits.numbers,
      p_check_capacity: checkCapacity,
    }),
    "save pending plan change",
  );
}

export async function clearPendingDowngrade(
  db: SupabaseClient,
  companyId: string,
  scheduleId: string,
) {
  expectOk(await db.from("companies").update({
    pending_plan: null,
    pending_plan_effective_at: null,
    pending_plan_schedule_id: null,
    pending_plan_seat_limit: null,
    pending_plan_number_limit: null,
  }).eq("id", companyId).eq("pending_plan_schedule_id", scheduleId), "clear pending plan change");
}
