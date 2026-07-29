/**
 * #241 — what went wrong, in OUR words rather than Telnyx's.
 *
 * `grep -rl telnyx apps/api/src` returns 20+ modules: Telnyx is not a
 * dependency we use, it is the substrate the product is built out of. That is
 * fine as an implementation and dangerous as a business — a vendor's uptime,
 * account decisions and pricing are all single points of failure.
 *
 * This file is the smallest useful piece of the seam: a taxonomy of REASONS
 * that business logic and all three clients branch on, so a second provider
 * means writing one more mapping function rather than editing every gate.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ONE FIRST, out of everything #241 lists.
 *
 * The vendor's error codes had leaked further than anything else. `send.ts`
 * compared against the literal `"40300"`, and so did **all three client
 * apps** — each carrying its own copy of a Telnyx constant to decide whether
 * to offer a retry button. Adding a carrier would have meant editing three
 * mobile apps and shipping them, and #339 established what that costs: a
 * store release reaches people over weeks, not hours.
 *
 * A code is a vendor's vocabulary. A reason is ours.
 */

/**
 * Why a send failed, at the granularity anything actually branches on.
 *
 * Deliberately small. Each value exists because some code makes a DIFFERENT
 * DECISION for it — not because the vendor distinguishes them. Telnyx has
 * dozens of codes and four of them mean "their phone did not take it"; that is
 * one reason here, because nothing we do differs between them.
 */
export type CarrierFailureReason =
  /** The customer texted STOP. Only they can lift it — never retryable. */
  | "opt_out"
  /** Nothing on the other end can receive a text. Retrying will not help. */
  | "unreachable"
  /** Carriers judged the content. Rewording and retrying can work. */
  | "content_blocked"
  /** Judged as spam specifically. Reputation territory (#235). */
  | "spam_blocked"
  /** Too fast. The message is fine; the timing was not. */
  | "rate_limited"
  /** It sat too long to still be worth sending. */
  | "expired"
  /** Our own setup: registration, number configuration, capability. */
  | "not_provisioned"
  /** We could not classify it. Never guessed — see `classifySendFailure`. */
  | "unknown";

/**
 * Telnyx messaging error codes → our reasons.
 *
 * THE ONLY PLACE a Telnyx code appears in a decision. A second provider adds
 * its own map beside this one and changes nothing else.
 *
 * Grouped identically to the copy table in `send-failures.ts`, because they
 * are two views of the same judgement and letting them drift would mean a
 * message whose sentence and whose retry affordance disagree.
 */
const TELNYX_REASONS: Record<string, CarrierFailureReason> = {
  "40300": "opt_out",

  "40001": "unreachable",
  "40012": "unreachable",
  "40310": "unreachable",
  "40004": "unreachable",
  "40006": "unreachable",
  "40008": "unreachable",

  "40002": "content_blocked",
  "40017": "content_blocked",
  "40009": "content_blocked",
  "40316": "content_blocked",
  "40317": "content_blocked",
  "40328": "content_blocked",

  "40003": "spam_blocked",
  "40015": "spam_blocked",
  "40322": "spam_blocked",

  "40011": "rate_limited",
  "40016": "rate_limited",
  "40018": "rate_limited",
  "40318": "rate_limited",

  "40005": "expired",
  "40014": "expired",

  "40010": "not_provisioned",
  "40329": "not_provisioned",
  "40330": "not_provisioned",
  "40100": "not_provisioned",
  "40314": "not_provisioned",
  "40305": "not_provisioned",
  "40308": "not_provisioned",
};

/**
 * Classify a raw provider code.
 *
 * `"unknown"` for anything unmapped, and that is the honest answer rather than
 * a soft default: a code we have not classified must not silently acquire the
 * behaviour of one we have. In particular it must never become `opt_out`,
 * because that is the one reason with a legal meaning — a STOP can only be
 * lifted by the customer, so treating an unrecognised failure as an opt-out
 * would take somebody's number out of service on a guess.
 */
export function classifySendFailure(
  errorCode: string | null | undefined,
): CarrierFailureReason {
  if (!errorCode) return "unknown";
  return TELNYX_REASONS[errorCode.trim()] ?? "unknown";
}

/**
 * The reason to act on, preferring what the server already classified.
 *
 * `reason` is written on the row from the send path onward. `errorCode` is the
 * fallback for rows that predate it — which, per #339, will exist on somebody's
 * phone for months. A client that only understood the new field would show the
 * wrong affordance on every historical failure.
 */
export function failureReasonOf(
  reason: string | null | undefined,
  errorCode: string | null | undefined,
): CarrierFailureReason {
  if (reason && isCarrierFailureReason(reason)) return reason;
  return classifySendFailure(errorCode);
}

/** A server value we do not recognise is `unknown`, never a crash (D44). */
export function isCarrierFailureReason(value: string): value is CarrierFailureReason {
  return (
    value === "opt_out" ||
    value === "unreachable" ||
    value === "content_blocked" ||
    value === "spam_blocked" ||
    value === "rate_limited" ||
    value === "expired" ||
    value === "not_provisioned" ||
    value === "unknown"
  );
}

/**
 * Is offering "try again" honest for this failure?
 *
 * The one rule three clients were each implementing against a Telnyx constant.
 * An opt-out is never retryable — the block is the customer's own choice and
 * only they can lift it (`opt-out-carrier-truth`). Everything else may be
 * worth another attempt, and the copy in `send-failures.ts` tells the person
 * whether it is likely to help.
 */
export function isRetryableFailure(reason: CarrierFailureReason): boolean {
  return reason !== "opt_out";
}
