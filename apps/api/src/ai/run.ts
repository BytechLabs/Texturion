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
 *   3. The workspace has stopped paying → `subscription_inactive` (#581).
 *   4. Reserve one unit against THIS feature's monthly cap. A reservation that
 *      errors counts as over cap: a broken ledger costs a suggestion, never an
 *      unbounded bill.
 *   5. Alert once at the threshold, BEFORE the cap bites. Never blocks.
 *   6. Over cap → `over_cap`, model not called.
 *   7. Build the model input — never before here, see {@link AiInput}.
 *   8. Call the model, raced against the feature's timeout.
 *
 * Per-feature keys keep the buckets separate, so a runaway in one cost center
 * cannot starve another.
 */
import { loadAiSettings, reserveAiUsage, sendAiCapAlert, type CompanyAiSettings } from "./settings";
import type { getDb } from "../db";
import type { Env } from "../env";
import { isKilled } from "../flags/evaluate";
import type { AiCostFeature } from "../billing/costs";
import {
  hasLiveSubscription,
  SUBSCRIPTION_STATUSES,
  type LocalSubscriptionStatus,
} from "../billing/plans";

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
  /**
   * #581: the workspace has stopped paying, so Lou has stopped spending.
   *
   * The word is the product's OWN, not a new one: `subscription_inactive` is
   * already the code every send path, the scheduled-send hold roster and all
   * three clients use for "billing, not breakage" ("Your subscription has
   * lapsed…"). A fifth synonym for the same fact would be a fifth sentence for
   * somebody to write and get subtly wrong.
   */
  | "subscription_inactive"
  | "model_error";

/**
 * A model input, or a thunk that builds one.
 *
 * The thunk is a COST feature and not a style choice. An input can be the
 * expensive object in the request — the wrap-up dictation base64-encodes a
 * recording of up to 8 MB, and its fallback shape spreads the same bytes into
 * an array of eight million numbers — and a caller that passes a value has
 * already paid for it in full by the time any refusal below is reached. So a
 * gate that owns the ORDER of the checks has to own when the input is built,
 * otherwise the order it enforces is only ever about the model call.
 *
 * Plain values still work, and most callers pass one: a prompt built from a
 * dozen messages is not worth deferring, and `() =>` on every call site would
 * make the cheap cases read as if they were the expensive ones.
 */
export type AiInput = Record<string, unknown> | (() => Record<string, unknown>);

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
    input: AiInput;
    /** Pre-loaded settings, when the caller already fetched them. */
    settings?: CompanyAiSettings;
    /**
     * A second model to try when the first answers with nothing the caller can
     * use. It runs inside the SAME reservation: the monthly cap counts requests
     * a person asked for, not how many shapes it took to answer one, and
     * reserving per attempt would halve every cap that has a fallback.
     */
    fallback?: { model: string; input: AiInput };
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

    // #581: Lou stops spending on a workspace that has stopped paying. Here,
    // because this is the one door — a check at each cost centre is a check the
    // next cost centre forgets.
    //
    // AFTER the opt-in, so a workspace that switched the feature off hears
    // about its own switch rather than about its card. BEFORE the reservation,
    // so a dead workspace's month is not walked down by requests that were
    // never going to be answered — the ledger is what the cap alert reads, and
    // it should count spending, not refusals.
    if (!(await mayStillSpend(db, companyId, spec))) {
      return { ok: false, reason: "subscription_inactive" };
    }

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
          // Built HERE, one attempt at a time (see {@link AiInput}): past every
          // refusal above, and the fallback's shape only if the first shape
          // actually failed. A thunk that throws is this attempt's failure like
          // any other, which is what the per-attempt catch is for.
          env.AI.run(attempt.model, resolveAiInput(attempt.input)),
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

/** The input, built now if it was deferred. */
function resolveAiInput(input: AiInput): Record<string, unknown> {
  return typeof input === "function" ? input() : input;
}

/**
 * #581 — may we still spend model tokens on this workspace?
 *
 * THE PRODUCT JUDGEMENT, which is the whole of this function and the reason it
 * is not simply `status === 'active'`:
 *
 * Cutting Lou off the moment a card fails is hostile and expensive in the way
 * that matters. A payment fails for a day and recovers — an expired card, a
 * bank's fraud hold, a limit reached on a Friday — and in the meantime Stripe is
 * still collecting and the invoice is still ours. Lou going silent in the middle
 * of somebody's conversations, on a Tuesday they had no warning about, is a
 * worse outcome for a customer who is about to pay us than the tenth of a cent
 * we saved. So `past_due` and `unpaid` keep working: {@link hasLiveSubscription}
 * already means exactly "live, or collectible", and reusing it rather than
 * writing a second predicate is what stops the two drifting.
 *
 * What genuinely stops is a subscription nothing more will ever be collected on:
 * `canceled`, and the two `incomplete` states where the first payment never
 * succeeded at all. Cancelled workspaces keep their number and their inbox for
 * the 30-day grace window (billing/grace.ts) and inbound texts keep arriving —
 * that is a promise about the number, not a licence to keep buying inference
 * that can never be invoiced. And `incomplete` is the hole worth naming: a
 * signup that never completed checkout is a workspace that has paid nothing,
 * which is the one case where an attacker's bill is entirely ours.
 *
 * FAILS OPEN, deliberately, and only here. A status we cannot READ is not a dead
 * workspace, and silencing a paying customer's AI over a lookup blip is the
 * expensive mistake in the other direction. The cost mandate is still honoured
 * by what sits immediately behind this: `reserveAiUsage` fails CLOSED, so the
 * outage that hides a subscription also refuses the spend. Loud rather than
 * silent, per the house rule — an unreadable standing is a real fault.
 */
async function mayStillSpend(
  db: Db,
  companyId: string,
  spec: AiFeatureSpec,
): Promise<boolean> {
  const { data, error } = await db
    .from("companies")
    .select("subscription_status")
    .eq("id", companyId)
    .limit(1)
    // ONE attempt. postgrest-js retries an idempotent read three times with
    // backoff by default, which is right for a read whose answer is needed and
    // wrong for this one: the failure is already decided ("spend anyway"), so
    // retrying would only make somebody wait about five seconds for a verdict we
    // were always going to reach optimistically. The first `.retry` in this
    // codebase, and the reason is latency on a path a person is sitting in front
    // of — nothing about the retries themselves is wrong.
    .retry(false);
  const status = (data?.[0] as { subscription_status?: unknown } | undefined)
    ?.subscription_status;
  // Only a status we RECOGNISE is a verdict. An absent row, a read that failed,
  // or a value outside the enum all mean "we could not establish it" — which
  // must stay distinguishable from "it is dead", or a renamed column would
  // silently switch every AI feature in the product off.
  if (
    error ||
    typeof status !== "string" ||
    !(SUBSCRIPTION_STATUSES as readonly string[]).includes(status)
  ) {
    console.error(
      `ai ${spec.key}: no subscription standing for ${companyId}, spending anyway:`,
      error?.message ?? JSON.stringify(status ?? null),
    );
    return true;
  }
  return hasLiveSubscription(status as LocalSubscriptionStatus);
}

/**
 * A distinct sentinel rather than null, because a model returning null is a
 * different thing from a model never answering, and the log line should say
 * which happened.
 */
const TIMED_OUT = Symbol("ai-timeout");
