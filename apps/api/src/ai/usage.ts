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

import { VOICEMAIL_INTAKE_FEATURE_SPEC } from "../calls/voicemail-intake";
import {
  VOICEMAIL_TRANSCRIPT_FEATURE_SPEC,
} from "../calls/voicemail-transcript";
import { SUGGEST_REPLY_FEATURE_SPEC } from "../messaging/reply-suggestions";
import { ENRICHMENT_FEATURE_SPEC } from "../tasks/enrichment";

import type { CompanyAiSettings } from "./settings";

/** What a person did with one feature's output, ready to render (#431). */
export interface AiOutcomeLine {
  /** This feature's own word for it: "sent as written", "cleared". */
  label: string;
  count: number;
}

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
  /**
   * #431 ask 3 — what happened to the output, beside what it cost.
   *
   * Ordered best-case first and pre-labelled by the server so all three clients
   * say the same words. Empty until outcomes start arriving, which the clients
   * must render as "not measured yet" rather than as three zeroes: a feature
   * used forty times with no outcomes recorded is an instrumentation gap, and
   * showing it as "0 sent as written" would report it as a quality result.
   */
  outcomes: AiOutcomeLine[];
  /**
   * How many outcomes are behind those lines. Reported separately from `used`
   * because they will NOT match — a draft offered and never looked at is a
   * request with no outcome — and a rate over the wrong denominator is how this
   * number would start misleading people. No rate is computed here for the same
   * reason the RPC computes none.
   */
  outcomesRecorded: number;
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
  // Beneath the transcript it reads, which is also the order the two happen in.
  VOICEMAIL_INTAKE_FEATURE_SPEC,
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
  // #431: the outcome counters live on the SAME ledger row as the spend, so
  // "what did it cost" and "did anyone use it" cannot be read apart or fall out
  // of step. One select, one row per feature, both halves.
  const { data, error } = await db
    .from("company_ai_usage")
    .select(
      "feature,request_count,outcome_used_count,outcome_edited_count,outcome_discarded_count",
    )
    .eq("company_id", companyId)
    .eq("period", aiUsagePeriod(now));
  if (error) {
    throw new Error(`ai usage lookup failed: ${error.message}`);
  }

  interface LedgerRow {
    feature: string;
    request_count: number | string;
    outcome_used_count: number | string | null;
    outcome_edited_count: number | string | null;
    outcome_discarded_count: number | string | null;
  }
  const rows = new Map<string, LedgerRow>();
  for (const row of (data ?? []) as LedgerRow[]) {
    rows.set(row.feature, row);
  }

  // Driven by the spec list, not by the rows: a feature nobody has used yet
  // still needs a line, or the screen looks like it does not exist.
  return AI_USAGE_FEATURES.map((spec) => {
    const row = rows.get(spec.key);
    const counts = {
      used: Number(row?.outcome_used_count ?? 0),
      edited: Number(row?.outcome_edited_count ?? 0),
      discarded: Number(row?.outcome_discarded_count ?? 0),
    };
    const recorded = counts.used + counts.edited + counts.discarded;
    // A null label means the outcome is UNOBSERVABLE for this feature, so the
    // line is omitted rather than printed as a zero — see AiFeatureSpec.
    const outcomes: AiOutcomeLine[] =
      recorded === 0
        ? []
        : (
            [
              [spec.outcomes.used, counts.used],
              [spec.outcomes.edited, counts.edited],
              [spec.outcomes.discarded, counts.discarded],
            ] as const
          )
            .filter(([label]) => label !== null)
            .map(([label, count]) => ({ label: label as string, count }));
    return {
      key: spec.key,
      label: spec.label,
      used: Number(row?.request_count ?? 0),
      cap: spec.cap,
      enabled: spec.enabled(settings),
      outcomes,
      outcomesRecorded: recorded,
    };
  });
}
