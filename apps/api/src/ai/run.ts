/**
 * The ONE door onto Lou.
 *
 * Every AI cost center — task enrichment, drafted replies, voicemail
 * transcription, and whatever comes next — runs through `runAiFeature`. It is
 * the only place that calls `env.AI.run`, so a feature cannot reach the model
 * without also going through the company's opt-in, its own monthly cap, the
 * alert before that cap, and the timeout.
 *
 * Why a gate and not just shared helpers: the helpers already existed
 * (`loadAiSettings` / `reserveAiUsage` / `sendAiCapAlert`) and each caller
 * assembled them itself, which meant each caller could assemble them WRONGLY.
 * The sequence was hand-written a third time for the voicemail backfill, and
 * "spend first, check later" is one transposed line away in every copy. With a
 * gate, a new feature declares a spec and gets the whole posture; forgetting is
 * not an option it has.
 *
 * The posture, in order, and none of it is optional:
 *   1. No binding  → `unavailable`, nothing spent.
 *   2. Company opted out of THIS feature → `disabled`, nothing spent.
 *   3. Reserve one unit against THIS feature's monthly cap. A reservation that
 *      errors counts as over cap: a broken ledger costs a suggestion, never an
 *      unbounded bill.
 *   4. Alert once at the threshold, BEFORE the cap bites. Never blocks.
 *   5. Over cap → `over_cap`, model not called.
 *   6. Call the model, raced against the feature's timeout.
 *
 * Per-feature keys keep the buckets separate, so a runaway in one cost center
 * cannot starve another.
 */
import { loadAiSettings, reserveAiUsage, sendAiCapAlert, type CompanyAiSettings } from "./settings";
import type { getDb } from "../db";
import type { Env } from "../env";

type Db = ReturnType<typeof getDb>;

/** Everything a cost center must declare before it may spend anything. */
export interface AiFeatureSpec {
  /** The per-feature key in the monthly ledger (`ai_usage_reserve`). */
  key: string;
  /** Human label for the ops alert ("voicemail transcript"). */
  label: string;
  /** Hard monthly cap per company. */
  cap: number;
  /** Alert threshold, below the cap. */
  alertThreshold: number;
  /** Plain sentence for the alert: what the company loses at the cap. */
  stops: string;
  /** Never let a model call outlive this. */
  timeoutMs: number;
  /** The company's opt-in for this feature. */
  enabled: (settings: CompanyAiSettings) => boolean;
}

/**
 * Why nothing came back. These map onto the reason strings the clients already
 * show, so a caller passes them straight through.
 */
export type AiRunFailure =
  | "unavailable"
  | "disabled"
  | "over_cap"
  | "model_error";

export type AiRunResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: AiRunFailure };

/**
 * Run one model call for one company under one feature's budget.
 *
 * Returns the RAW model output: parsing, validating and sanitizing belong to
 * the feature, because only the feature knows what a good answer looks like.
 * Never throws — every failure is a reason, so no AI feature can take down the
 * thing it was decorating.
 */
export async function runAiFeature(
  env: Env,
  db: Db,
  args: {
    companyId: string;
    spec: AiFeatureSpec;
    model: string;
    input: Record<string, unknown>;
    /** Pre-loaded settings, when the caller already fetched them. */
    settings?: CompanyAiSettings;
  },
): Promise<AiRunResult> {
  const { companyId, spec } = args;
  try {
    if (!env.AI) return { ok: false, reason: "unavailable" };

    const settings = args.settings ?? (await loadAiSettings(db, companyId));
    if (!spec.enabled(settings)) return { ok: false, reason: "disabled" };

    const reservation = await reserveAiUsage(db, {
      companyId,
      feature: spec.key,
      cap: spec.cap,
      alertThreshold: spec.alertThreshold,
    });
    if (reservation.should_alert) {
      // Never blocks the call it is warning about.
      await sendAiCapAlert(env, {
        companyId,
        label: spec.label,
        count: reservation.count,
        cap: spec.cap,
        alertThreshold: spec.alertThreshold,
        stops: spec.stops,
      }).catch((cause) => {
        console.error(
          `ai cap alert failed for ${companyId}/${spec.key}:`,
          cause instanceof Error ? cause.message : String(cause),
        );
      });
    }
    if (reservation.over_cap) return { ok: false, reason: "over_cap" };

    const raw = await Promise.race([
      env.AI.run(args.model, args.input),
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), spec.timeoutMs),
      ),
    ]);
    if (raw === TIMED_OUT) {
      console.error(
        `ai ${spec.key}: ${args.model} timed out after ${spec.timeoutMs}ms`,
      );
      return { ok: false, reason: "model_error" };
    }
    return { ok: true, raw };
  } catch (cause) {
    console.error(
      `ai ${spec.key}: ${args.model} threw:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return { ok: false, reason: "model_error" };
  }
}

/**
 * A distinct sentinel rather than null, because a model returning null is a
 * different thing from a model never answering, and the log line should say
 * which happened.
 */
const TIMED_OUT = Symbol("ai-timeout");
