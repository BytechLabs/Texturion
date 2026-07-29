/**
 * #235 — the customer-facing half of number health.
 *
 * Kept apart from `number-health.ts` (the assessor) because the two have
 * opposite failure postures and mixing them would blur that. The assessor may
 * fail loudly: it is a cron, and a cron that silently stops is what #387
 * exists to catch. This must NEVER fail loudly — it decorates the numbers
 * list, which the composer's "text from" picker reads, and a reputation lookup
 * has no business being able to stop somebody texting a customer.
 *
 * `api_number_health` already flattens 'watch' to 'healthy', so nothing here
 * can leak an internal state to a customer even by accident.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** What the owner is told about one number. */
export interface NumberHealthView {
  /** 'healthy' | 'degraded'. 'watch' is internal and never appears here. */
  state: string;
  /** 0-1 over the assessment window, or null when there was too little to say. */
  delivery_rate: number | null;
  /** When it first left healthy — the banner says how long, not just "bad". */
  degraded_since: string | null;
  /** Plain language: "delivery 54% against a baseline of 97%". */
  detail: string | null;
}

interface HealthRow extends NumberHealthView {
  phone_number_id: string;
}

/**
 * Health for every assessed number in a workspace, keyed by number id.
 *
 * Returns an EMPTY MAP on any failure, which renders as no banner. That is the
 * honest reading: absent health means "we have not assessed this", and a
 * database blip must not be able to tell a customer their business line is
 * degraded — nor to stop the list loading at all.
 */
export async function loadNumberHealth(
  db: SupabaseClient,
  companyId: string,
): Promise<Map<string, NumberHealthView>> {
  try {
    const { data, error } = await db.rpc("api_number_health", {
      p_company_id: companyId,
    });
    if (error) throw new Error(error.message);

    const map = new Map<string, NumberHealthView>();
    for (const row of (data ?? []) as HealthRow[]) {
      // Only a degraded number gets a row. A 'healthy' entry would be noise on
      // the wire and one more thing for three clients to ignore identically.
      if (row.state !== "degraded") continue;
      map.set(row.phone_number_id, {
        state: row.state,
        delivery_rate: row.delivery_rate,
        degraded_since: row.degraded_since,
        detail: row.detail,
      });
    }
    return map;
  } catch (cause) {
    console.error(`number health read failed for ${companyId}: ${String(cause)}`);
    return new Map();
  }
}
