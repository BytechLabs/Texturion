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
import { isKilled } from "../flags/evaluate";
import type { AiCostFeature } from "../billing/costs";

type Db = ReturnType<typeof getDb>;

/** Everything a cost center must declare before it may spend anything. */
export interface AiFeatureSpec {
  /**
   * The per-feature key in the monthly ledger (`ai_usage_reserve`).
   *
   * #380: typed as the PRICED keys rather than `string`, so a new cost centre
   * cannot reach the model without also existing in the profitability model.
   * Adding a feature now fails to compile until `AI_UNIT_COST_CENTS` in
   * billing/costs.ts carries a price for it — the guard sits where the thing is
   * declared, not in a document someone has to remember.
   */
  key: AiCostFeature;
  /** Human label for the ops alert ("voicemail transcript"). */
  label: string;
  /** Hard monthly cap per company. */
  cap: number;
  /**
   * #380: what ONE request of this feature costs us, in cents.
   *
   * Required, and deliberately duplicated from `AI_UNIT_COST_CENTS` rather
   * than only looked up there: a cost centre should state its own price at the
   * point it declares its cap, so the two are read together. A test asserts the
   * two agree, so the duplication cannot drift.
   *
   * Before this existed, every AI feature declared a cap, an alert and a
   * timeout — all of which bound BLAST RADIUS — and nothing that answered
   * "does this tenant still make money". The caps guaranteed the loss was
   * bounded; they said nothing about whether it was happening.
   */
  unitCostCents: number;
  /** Alert threshold, below the cap. */
  alertThreshold: number;
  /** Plain sentence for the alert: what the company loses at the cap. */
  stops: string;
  /** Never let a model call outlive this. */
  timeoutMs: number;
  /** The company's opt-in for this feature. */
  enabled: (settings: CompanyAiSettings) => boolean;
  /**
   * #431: what the three recorded outcomes MEAN for this feature, in this
   * feature's own words.
   *
   * The ledger stores three generic counters, because "used / changed first /
   * not used" is the same measurement everywhere. What differs is what the
   * person actually did: a draft is *sent*, an enrichment is *kept*, a
   * transcript is *read*. Declaring the wording next to the cap is what lets
   * all three clients label the same numbers identically without any of them
   * inventing copy — the failure #437 found sixteen times over.
   *
   * EVERY label is nullable, and a null one means "this feature cannot observe
   * that outcome" — not "it has not happened yet". Voicemail transcripts are the
   * case that forces it: the only signal available is the negative one (#431's
   * own "played the audio anyway"), because "read the words and moved on" is a
   * person NOT doing something, which no client can observe without inventing a
   * heuristic out of scroll and unmount timing — and three platforms inventing
   * three different heuristics would make the number worthless.
   *
   * So a null label means the row omits that line entirely, rather than printing
   * a zero. Printing "0 read without listening" would report an unobservable
   * outcome as a measured absence, which is worse than saying nothing.
   */
  outcomes: {
    /** The output was used as it came. Null where that is unobservable. */
    used: string | null;
    /** Changed, then used. Null where the output is not editable. */
    edited: string | null;
    /** Not used. Not necessarily a quality failure — see the ledger comments. */
    discarded: string | null;
  };
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
    /**
     * A second model to try when the first answers with nothing the caller can
     * use. It runs inside the SAME reservation: the monthly cap counts requests
     * a person asked for, not how many shapes it took to answer one, and
     * reserving per attempt would halve every cap that has a fallback.
     */
    fallback?: { model: string; input: Record<string, unknown> };
    /**
     * Whether a raw answer is usable. Only consulted to decide on the
     * fallback; the caller still parses the value it gets back.
     */
    accept?: (raw: unknown) => boolean;
  },
): Promise<AiRunResult> {
  const { companyId, spec } = args;
  try {
    if (!env.AI) return { ok: false, reason: "unavailable" };

    // #283: the AI kill switch, at the one gate every AI feature passes
    // through. Reads as "unavailable" rather than "disabled" on purpose —
    // "disabled" is the customer's own setting, and conflating an incident
    // with a preference would make the switch invisible in support.
    if (await isKilled(env, "kill:ai", companyId, db)) {
      return { ok: false, reason: "unavailable" };
    }

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

    const attempts = args.fallback
      ? [{ model: args.model, input: args.input }, args.fallback]
      : [{ model: args.model, input: args.input }];
    for (const [index, attempt] of attempts.entries()) {
      const last = index === attempts.length - 1;
      // Each attempt catches its OWN failure. A model that REJECTS is the main
      // reason a second shape exists (a wrong input contract rejects, it does
      // not answer with something unusable), so letting a rejection escape to
      // the outer catch would skip the fallback in exactly the case it was
      // added for.
      let raw: unknown;
      try {
        raw = await Promise.race([
          env.AI.run(attempt.model, attempt.input),
          new Promise<typeof TIMED_OUT>((resolve) =>
            setTimeout(() => resolve(TIMED_OUT), spec.timeoutMs),
          ),
        ]);
      } catch (cause) {
        console.error(
          `ai ${spec.key}: ${attempt.model} threw:`,
          cause instanceof Error ? cause.message : String(cause),
        );
        if (last) return { ok: false, reason: "model_error" };
        continue;
      }
      if (raw === TIMED_OUT) {
        console.error(
          `ai ${spec.key}: ${attempt.model} timed out after ${spec.timeoutMs}ms`,
        );
        if (last) return { ok: false, reason: "model_error" };
        continue;
      }
      if (last || args.accept === undefined || args.accept(raw)) {
        return { ok: true, raw };
      }
      console.error(
        `ai ${spec.key}: ${attempt.model} returned nothing usable`,
        JSON.stringify(raw)?.slice(0, 300) ?? "null",
      );
    }
    return { ok: false, reason: "model_error" };
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
