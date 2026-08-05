import {
  formatMoney,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import {
  readSaysPaused,
  readSaysRunning,
  type PauseRead,
} from "@/components/settings/pause-read";

/**
 * #525 — what the enable-US card promises a workspace whose plan is paused.
 *
 * # The decision, and the fact it rests on
 *
 * `POST /v1/registration/enable-us` charges the one-time fee and submits the
 * 10DLC registration without reading `paused_at`, and it stays that way: THIS
 * FILE ADDS NO GATE. Refusing would be the option that costs the customer.
 * Carrier review takes days to weeks, a seasonal crew's quiet winter is exactly
 * when that wait is free, and the fee is charged once per workspace ever
 * (`companies.registration_fee_paid_at`) — so buying it during the pause is
 * better value than buying it in spring, not worse.
 *
 * That argument only holds because the registration genuinely COMPLETES while
 * paused, and that was established before any of this was written rather than
 * assumed: nothing in the route, `runSubmitRegistration`, the Telnyx brand and
 * campaign submissions, the approval transition, or the SQL claim functions
 * reads the pause. `company_send_block` — the one place `paused_at` gates
 * anything — is called only by the five SEND claims. Our gates block SENDING;
 * none of them blocks REGISTERING.
 *
 * So the screen owes the reader two things it did not say: that the wait runs
 * during the pause (the reason to do it now), and that approval does not switch
 * sending back on (the expectation the pause changes).
 *
 * # Why the words live here and not in the component
 *
 * A sentence inside JSX can only be guarded by rendering the component and
 * matching a phrase typed into the test — and a test that quotes a string
 * nobody renders cannot fail. These are the shipped strings; the card imports
 * them, and `us-registration-timing.test.ts` asserts on these constants, so
 * changing the copy either updates the guard or breaks it.
 */

/**
 * Which story the card may tell about timing.
 *
 * THREE, NOT TWO, and the third is the reason this is a resolver. `paused_at`
 * is deliberately absent from `company_view` — it is a `billing.manage` fact
 * behind `GET /v1/billing/pause`, kept off every app boot — so this card reads
 * it the same way the billing screen does, through `PauseRead`, and inherits
 * that type's rule: A SCREEN MAY NOT STATE A FACT IT HAS NOT READ.
 */
export type UsRegistrationTiming =
  /** Answered, and the workspace is paused right now. */
  | "paused"
  /** Answered running, or a workspace that cannot be paused at all. */
  | "running"
  /** In flight, or the ask failed. Nothing is claimed in either direction. */
  | "unknown";

/**
 * What this reader has actually been told about the pause.
 *
 * Composed out of `pause-read`'s exported predicates rather than re-deriving
 * them, for the reason `holdForPort` composes `numberHoldState`: two copies of
 * one rule are not two opinions, they are silently the looser one.
 *
 * `unasked` IS "running", and it is knowledge rather than a shrug. The gate
 * that leaves us unasked is `pauseQueryEnabled`, false only for a workspace
 * with no plan or no live subscription — precisely the shape a paused workspace
 * cannot have, since a pause is a licensed-price swap that leaves `plan` set
 * and `subscription_status` genuinely `active`. Same carve-out, same reasoning,
 * as `readAllowsPlanChange`.
 *
 * `loading` and `failed` are NOT folded into "running". That fold is the whole
 * defect `PauseRead` was built to stop: it answers "not paused" for a read that
 * never landed, and here it would promise a paused owner that their US texting
 * goes live — on the one screen where they are agreeing to pay for it.
 */
export function usRegistrationTiming(read: PauseRead): UsRegistrationTiming {
  if (readSaysPaused(read)) return "paused";
  if (readSaysRunning(read) || read.state === "unasked") return "running";
  return "unknown";
}

/**
 * The fee, in the currency the invoice will actually arrive in.
 *
 * #328: Stripe prices this fee with a CAD currency option, so a CA workspace
 * billed in CAD is charged the CAD figure — naming the US one would be a price
 * the owner can check against their statement and find wrong. Derived here,
 * from the shared price book, so no caller can hand the copy a number of its
 * own: every figure this card prints resolves to `US_REGISTRATION_FEE_CENTS`.
 */
export function usRegistrationFee(currency: BillingCurrency): string {
  return formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency);
}

/**
 * The note on the card itself, shown ONLY on a confirmed pause.
 *
 * IT LEADS WITH THE REASON TO DO IT, not with what the pause blocks. A paused
 * owner looking at a US texting card with no acknowledgement of their pause
 * concludes the feature is unavailable to them and does not press — which is
 * the same outcome as refusing, arrived at by silence. The thing they need
 * first is that the wait is free right now; the thing the pause blocks is a
 * term of the purchase, and it belongs in the dialog where they agree to it.
 *
 * No count of days here. The card is an invitation, and the dialog states the
 * carrier window once, where the money is.
 */
export const US_REGISTRATION_PAUSED_HEADING =
  "You can start this while your plan is paused";

export const US_REGISTRATION_PAUSED_NOTE =
  "Carrier review takes days either way, and none of it needs your plan " +
  "running. Doing it now means the waiting happens in your quiet season " +
  "rather than in your first week back.";

/**
 * The terms every reader gets, paused or not — what is charged, by whom it is
 * reviewed, and how long that takes.
 *
 * Word for word what this dialog has always said, split at the sentence
 * boundary so the branch below adds a clause rather than rewriting the
 * agreement. The carrier window is the same "3 to 7 business days" the review
 * timeline further down this screen and the marketing pages already state.
 */
export function usRegistrationTerms(currency: BillingCurrency): string {
  return (
    `A one-time ${usRegistrationFee(currency)} registration fee is charged to ` +
    "your card on file, and we register your business with US carriers. " +
    "Approval usually takes 3 to 7 business days."
  );
}

/**
 * The closing line for a plan that is running. Today's sentence, untouched.
 */
export const US_REGISTRATION_RUNNING_TAIL =
  "We handle it and email you when it's live.";

/**
 * The three things a paused buyer is agreeing to, as three things.
 *
 * CHUNKED RATHER THAN CONCATENATED, because only the third one changes an
 * expectation, and a third clause buried at the end of a 45-word paragraph is
 * the clause that gets skimmed. Each line is one fact:
 *
 *   the money    charged today, and charged once ever. The fee is stamped on
 *                `registration_fee_paid_at`, so paying during the pause is not
 *                paying again in spring — which is the whole value argument,
 *                and it is worthless unspoken.
 *   the wait     runs during the pause. Established end to end, not assumed:
 *                nothing between the route and the campaign approval reads
 *                `paused_at`.
 *   the limit    approval does NOT lift the pause. `runPreSendGates` refuses
 *                with `workspace_paused` no matter what the carriers say, and
 *                somebody who read "we email you when it's live" and then could
 *                not text a customer would have been misled by us, at the exact
 *                moment we took their money.
 */
export function usRegistrationPausedTerms(
  currency: BillingCurrency,
): readonly string[] {
  return [
    `The ${usRegistrationFee(currency)} is charged today, and it is charged ` +
      "once ever — not again when you come back.",
    "Carriers review you while your plan is paused. The pause does not hold " +
      "the registration up.",
    "Sending stays off until you resume. Approval means US texting is set up " +
      "and waiting for you, not that a paused plan starts sending.",
  ];
}

/**
 * The closing line, given what we know. NULL is a real answer.
 *
 * On `unknown` the dialog says the terms and stops. Promising "we email you
 * when it's live" would state the absence of a pause we have not read, and
 * inventing a hedge ("if your plan is paused, then…") would narrate our own
 * network request at somebody holding a card. The core terms above are true in
 * every state, so silence here costs the reader nothing and claims nothing —
 * the same discipline `planStateUnknownNote` applies on the billing screen.
 */
export function usRegistrationTail(timing: UsRegistrationTiming): string | null {
  return timing === "running" ? US_REGISTRATION_RUNNING_TAIL : null;
}

/**
 * What the toast says once the charge has landed.
 *
 * #525: branched for the same reason the confirm body is. Android and iOS both
 * branch this and web did not, so a paused owner pressed the button, paid, and
 * was told "we'll email you when it's approved" - true, and silent about the
 * one fact that decides whether they can use it. The sentence they need is not
 * about approval, it is about the resume.
 *
 * `unknown` takes the running wording deliberately, matching the rest of this
 * module: the safe reading of "we have not been told" is not paused, because
 * telling a paying crew to go and resume a plan that is already running is the
 * worse error.
 */
export function usRegistrationStarted(timing: UsRegistrationTiming): string {
  return timing === "paused"
    ? "US registration started. We'll email you when the carriers approve it, " +
        "and US texting works when you resume."
    : "US registration started. We'll email you when it's approved.";
}
