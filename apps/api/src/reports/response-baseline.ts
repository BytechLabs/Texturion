import {
  RESPONSE_BASELINE_DEFINITION_VERSION,
  RESPONSE_BASELINE_MAX_DAYS,
  RESPONSE_BASELINE_MIN_ANSWERS,
  RESPONSE_BASELINE_MIN_DAYS,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResponseBaseline {
  since: string;
  until: string;
  leads: number;
  answered: number;
  median_seconds: number;
}

export type ResponseBaselineResult =
  | { baseline: ResponseBaseline }
  | { reason: "collecting"; answered: number; required: number }
  | { reason: "no_answered_leads" };

export async function loadResponseBaseline(
  db: SupabaseClient,
  companyId: string,
  now: Date,
  hiddenNumberIds: readonly string[] | null = null,
): Promise<ResponseBaselineResult> {
  const { data, error } = await db.rpc("api_response_time_baseline", {
    p_company_id: companyId,
    p_now: now.toISOString(),
    p_definition_version: RESPONSE_BASELINE_DEFINITION_VERSION,
    p_min_days: RESPONSE_BASELINE_MIN_DAYS,
    p_max_days: RESPONSE_BASELINE_MAX_DAYS,
    p_min_answers: RESPONSE_BASELINE_MIN_ANSWERS,
    p_hidden_number_ids: hiddenNumberIds,
  });
  if (error) throw new Error(`response-time baseline failed: ${error.message}`);
  return data as ResponseBaselineResult;
}
