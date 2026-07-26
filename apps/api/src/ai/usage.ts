/**
 * What Lou has done this month, per feature, for the usage screen.
 *
 * The caps were enforced entirely server-side and surfaced nowhere: a crew hit
 * one mid-sentence, got a per-feature failure message, and had no way to have
 * seen it coming or to check where they stood afterwards. Every other cost
 * centre in the product answers "where do I stand" on that screen; this one
 * did not.
 *
 * Read-only. The ledger is written exclusively by `ai_usage_reserve`, which is
 * what makes the count and the cap the same number the gate uses.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  VOICEMAIL_TRANSCRIPT_FEATURE_SPEC,
} from "../calls/voicemail-transcript";
import { SUGGEST_REPLY_FEATURE_SPEC } from "../messaging/reply-suggestions";
import { ENRICHMENT_FEATURE_SPEC } from "../tasks/enrichment";

import type { CompanyAiSettings } from "./settings";

/** One feature's line on the usage screen. */
export interface AiFeatureUsage {
  /** The ledger key, so a client can match a row without matching on copy. */
  key: string;
  /** Plain label, the same words the cap alert uses. */
  label: string;
  used: number;
  cap: number;
  /** Whether the workspace has this feature turned on at all. */
  enabled: boolean;
}

/**
 * Every AI cost centre, in the order they appear on the screen. Sourced from
 * the same specs the gate reads, so a cap can never be changed in one place
 * and reported wrongly in the other.
 */
export const AI_USAGE_FEATURES = [
  SUGGEST_REPLY_FEATURE_SPEC,
  ENRICHMENT_FEATURE_SPEC,
  VOICEMAIL_TRANSCRIPT_FEATURE_SPEC,
] as const;

/** The ledger's month bucket: 'YYYY-MM' in UTC, matching ai_usage_reserve. */
export function aiUsagePeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export async function readAiUsage(
  db: SupabaseClient,
  companyId: string,
  settings: CompanyAiSettings,
  now: Date = new Date(),
): Promise<AiFeatureUsage[]> {
  const { data, error } = await db
    .from("company_ai_usage")
    .select("feature,request_count")
    .eq("company_id", companyId)
    .eq("period", aiUsagePeriod(now));
  if (error) {
    throw new Error(`ai usage lookup failed: ${error.message}`);
  }

  const used = new Map<string, number>();
  for (const row of (data ?? []) as {
    feature: string;
    request_count: number | string;
  }[]) {
    used.set(row.feature, Number(row.request_count));
  }

  // Driven by the spec list, not by the rows: a feature nobody has used yet
  // still needs a line, or the screen looks like it does not exist.
  return AI_USAGE_FEATURES.map((spec) => ({
    key: spec.key,
    label: spec.label,
    used: used.get(spec.key) ?? 0,
    cap: spec.cap,
    enabled: spec.enabled(settings),
  }));
}
