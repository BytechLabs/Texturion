import {
  BILLING_CURRENCIES,
  DEFAULT_BILLING_CURRENCY,
  formatMoney,
  type BillingCurrency,
} from "@loonext/shared";

import type { Translate } from "@/i18n/provider";
import type { ConversationEvent, ConversationEventType } from "@/lib/api/types";

/**
 * #607 A3 — the figures a payment timeline line is allowed to say.
 *
 * ## Why the amount is in the line at all
 *
 * "Payment refunded" is a notification that makes you open something else to
 * learn anything, and the something else is not always there: the strip beside
 * the composer drops a settled request after a week, and the request that was
 * disputed six weeks ago is exactly the one somebody is arguing about. The
 * money is the fact, so it is in the sentence. *Applying: Meaningful Highlights
 * & Context — data is paired with the thing the reader can act on.* Same
 * argument `jobRatedLine` makes for putting the score in the line rather than
 * behind a tap.
 *
 * ## The rule is hand-ported, so it is written to be portable
 *
 * `Timeline.kt` and `Timeline.swift` narrate the same five events from the same
 * payload, and nothing connects the three implementations — see
 * `media-refused-parity.test.ts` for what that costs. So this is a pure
 * function over the payload with no web-specific input, and every branch is one
 * the other two already have. Where they and this file could differ, this file
 * moved: the currency fallback and the refund's zero-is-absent rule below are
 * theirs, not a web opinion.
 */

const AMOUNT_KEY = "amount_cents";
const REFUNDED_AMOUNT_KEY = "amount_refunded_cents";
const CURRENCY_KEY = "currency";
const DESCRIPTION_KEY = "description";

/**
 * A minor-unit figure off an untyped payload, or null when the payload does not
 * carry one this line can say.
 *
 * INTEGER-ONLY, matching Android's `payloadCents` (kotlinx's `intOrNull`
 * answers null for a fractional literal). A minor unit is a whole number by
 * definition, and 200.5 would render as "$2.005" — a figure no reader could act
 * on and no writer meant.
 */
function centsAt(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value;
}

/**
 * What the figure is written in — the CONNECTED Stripe account's currency,
 * which need not be the one the workspace is billed in.
 *
 * Unknown or absent reads as USD rather than dropping the figure, which is the
 * fleet's rule and the right one: a payment line that silently loses its amount
 * because an older row omitted a field is the #607 A3 defect with extra steps,
 * and the two live currencies both render a bare "$" to their own reader
 * anyway.
 */
function currencyOf(payload: Record<string, unknown>): BillingCurrency {
  const raw = payload[CURRENCY_KEY];
  if (typeof raw !== "string") return DEFAULT_BILLING_CURRENCY;
  const code = raw.trim().toLowerCase();
  return (BILLING_CURRENCIES as readonly string[]).includes(code)
    ? (code as BillingCurrency)
    : DEFAULT_BILLING_CURRENCY;
}

/**
 * The money this event is about, formatted — or null when the payload carries
 * no figure, in which case the caller says the amount-less twin sentence rather
 * than one with a hole in it.
 *
 * A REFUND REPORTS WHAT WENT BACK, not what was charged. A partial refund is
 * the ordinary case — a deposit returned less a call-out fee — and quoting the
 * original would tell the crew the customer got more back than they did. Zero
 * is treated as absent rather than rendered: `amount_refunded_cents` is
 * nullable and a stored zero means the webhook did not know the figure, never
 * that nothing moved.
 *
 * A DISPUTE deliberately does not do this. `settle()` passes `amount: null` for
 * a chargeback, so the refunded column is not the disputed figure — the charge
 * is.
 *
 * The currency is passed as both amount and audience, which is what drops the
 * "US$" / "CA$" qualifier: a business reading its own money in its own thread
 * is not the case that qualifier exists for. Same call the strip makes.
 */
export function paymentEventAmount(event: ConversationEvent): string | null {
  const payload = event.payload;
  const cents = centsAt(payload, AMOUNT_KEY);
  const figure =
    event.type === "payment_refunded"
      ? ((centsAt(payload, REFUNDED_AMOUNT_KEY) ?? 0) > 0
          ? centsAt(payload, REFUNDED_AMOUNT_KEY)
          : cents)
      : cents;
  if (figure === null) return null;
  return formatMoney(figure, currencyOf(payload));
}

/**
 * What the money was for, when the crew typed one.
 *
 * ONE trailing clause for all five lines rather than five branches.
 * `payment_cancelled` is the only payload the API writes without a description,
 * so its line simply never gets one — a fact about the writer, not a rule about
 * the sentence, and not a fourth thing to keep in step across three clients.
 */
export function paymentEventDescription(event: ConversationEvent): string | null {
  const raw = event.payload[DESCRIPTION_KEY];
  if (typeof raw !== "string") return null;
  const description = raw.trim();
  return description === "" ? null : description;
}

/**
 * The five `conversation_event_type` labels this timeline narrates.
 *
 * NOT the same set as `PAYMENT_EVENT_TYPES` in `lib/realtime/events.ts`, and
 * the difference is the point rather than an oversight: that one is the THREE
 * the database broadcasts, this is the FIVE the timeline reads. Broadcasting is
 * about what arrives without a fetch; narrating is about what the transcript
 * says once it has been fetched. `payment_requested` needs no broadcast because
 * the request IS an outbound text and `message.created` already carried it —
 * but the audit row is still there, and a row nobody narrates is the A3 defect.
 *
 * `satisfies` pins every member to a label the server can actually write:
 * `ConversationEventType` is held to the SQL enum in both directions by
 * `scripts/check-conversation-events.mjs`, so a typo here fails tsc rather than
 * becoming an arm that renders for nothing.
 */
export const NARRATED_PAYMENT_EVENT_TYPES = [
  "payment_requested",
  "payment_paid",
  "payment_cancelled",
  "payment_refunded",
  "payment_disputed",
] as const satisfies readonly ConversationEventType[];

export type NarratedPaymentEventType =
  (typeof NARRATED_PAYMENT_EVENT_TYPES)[number];

/**
 * One payment line, in the reader's language.
 *
 * ## The words are not this client's to choose
 *
 * Every sentence below is the shared #607 A3 wording, implemented identically
 * on web, Android (`Timeline.kt` `paymentLine`) and iOS (`Timeline.swift`
 * `paymentEventLine`). A crew comparing the phone and the laptop must not read
 * two different histories for one conversation (#273).
 *
 * Each verb is one this feature already ships, which is what keeps the timeline
 * and the strip one product rather than two glossaries: "asked for" is the
 * composer's own button (`payments.askFor`), "called off" is what the customer
 * page calls cancelling an ask, "went back to them" is the strip's refund line
 * (`payments.refundedBack`), and the strip's dispute row already says their
 * bank pulled it back (`payments.disputedNote`).
 *
 * ## Who each line credits
 *
 * `payment_requested` and `payment_cancelled` are things a crew member does in
 * this app, so they carry `by`. The other three carry `actor_user_id: null`
 * because NOBODY IN THE WORKSPACE DID THEM — the customer paid, the business
 * refunded from Stripe's own dashboard, the customer's bank pulled the money
 * back — so they name nobody, exactly as `appointment_confirmed` and
 * `job_rated` name nobody. Passing `by` into them would print the "Loonext"
 * fallback and credit us with the customer's action.
 */
export function paymentEventLine(
  event: ConversationEvent,
  type: NarratedPaymentEventType,
  by: string,
  t: Translate,
): string {
  const amount = paymentEventAmount(event);
  const line = paymentHeadline(type, by, amount, t);
  const description = paymentEventDescription(event);
  return description
    ? t("thread.sysPaymentWithDescription", { line, description })
    : line;
}

function paymentHeadline(
  type: NarratedPaymentEventType,
  by: string,
  amount: string | null,
  t: Translate,
): string {
  switch (type) {
    case "payment_requested":
      return amount
        ? t("thread.sysPaymentRequested", { by, amount })
        : t("thread.sysPaymentRequestedGeneric", { by });
    case "payment_paid":
      return amount
        ? t("thread.sysPaymentPaid", { amount })
        : t("thread.sysPaymentPaidGeneric");
    case "payment_cancelled":
      return amount
        ? t("thread.sysPaymentCancelled", { by, amount })
        : t("thread.sysPaymentCancelledGeneric", { by });
    case "payment_refunded":
      return amount
        ? t("thread.sysPaymentRefunded", { amount })
        : t("thread.sysPaymentRefundedGeneric");
    case "payment_disputed":
      return amount
        ? t("thread.sysPaymentDisputed", { amount })
        : t("thread.sysPaymentDisputedGeneric");
  }
}
