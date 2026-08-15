/**
 * #224 — the two payment sentences that need a money formatter.
 *
 * Separate from `payments.ts` for one mechanical reason worth stating, because
 * it looks arbitrary otherwise: `scripts/generate-parity-vectors.mjs` imports
 * the shared rules directly into Node's TypeScript stripper, which resolves
 * extension-less specifiers not at all. A module that pulls in
 * `./billing-currency` as a VALUE therefore cannot be a vector source, and the
 * payment state machine has to be one — a divergence there is somebody chased
 * for a bill they paid.
 *
 * The split lands on the right line anyway: `payments.ts` is the RULES, which
 * all three clients must agree on to the letter and which the vectors pin. This
 * file is COPY, which the vector generator's own header says is deliberately
 * out of scope — a platform is allowed to phrase things its own way.
 */

import { formatMoney, type BillingCurrency } from "./billing-currency";
import {
  PAYMENT_MAX_CENTS,
  PAYMENT_MIN_CENTS,
  type PaymentAmountProblem,
} from "./payments";

/** The sentence a crew member reads when the amount is refused. */
/** Every catalogue key this module names. */
export type PaymentAmountKey =
  | "payments.amountTooSmall"
  | "payments.amountTooLarge"
  | "payments.amountNotWhole";

/** The reader's resolver. */
export type SayPaymentAmount = (key: PaymentAmountKey) => string;

export function paymentAmountProblemCopy(
  problem: PaymentAmountProblem,
  currency: BillingCurrency,
  /**
   * #228 — the reader's resolver.
   *
   * The API passes an English one: this refusal leaves as an `ApiError`
   * message, so it is on the wire and a client built last month renders it
   * verbatim. The three clients check the same rule locally before the round
   * trip and pass the reader's — which is the copy a person actually sees,
   * because the local check fires first.
   */
  say: SayPaymentAmount,
): string {
  /*
   * #228 — the AMOUNT is formatted here and the sentence around it is a key.
   *
   * `formatMoney` already knows the currency; what it does not know is the
   * language the sentence is in. Both phones have said these three from
   * `payments.amount*` for months.
   */
  switch (problem) {
    case "too_small":
      return say("payments.amountTooSmall").replace(
        "{amount}",
        formatMoney(PAYMENT_MIN_CENTS, currency),
      );
    case "too_large":
      return say("payments.amountTooLarge").replace(
        "{amount}",
        formatMoney(PAYMENT_MAX_CENTS, currency),
      );
    case "not_whole":
      return say("payments.amountNotWhole");
  }
}

/**
 * The text the customer receives.
 *
 * Composed HERE and used by the API, so the composer's preview on all three
 * clients is the message that actually goes out rather than an approximation of
 * it. The shape is fixed and short for three reasons that are all the same
 * reason — this is an SMS somebody reads on a lock screen:
 *
 *   THE BUSINESS NAME IS FIRST. A payment link from an unnamed sender is a
 *   phishing text, and the customer is right to think so.
 *   THE AMOUNT IS SECOND. Nobody should have to open a link to find out what
 *   they are being asked for.
 *   THE LINK IS LAST, on its own line, so every phone linkifies the whole of it.
 *
 * No "click here", no urgency, no shortened domain: all three are what a
 * carrier's spam filter and a homeowner's instinct are both looking for.
 */
export function paymentRequestSms(args: {
  businessName: string;
  amountCents: number;
  currency: BillingCurrency;
  description: string;
  url: string;
}): string {
  const amount = formatMoney(args.amountCents, args.currency);
  const description = args.description.trim();
  return (
    `${args.businessName.trim()}: ${amount} for ${description}.\n` +
    `Pay securely here:\n${args.url}`
  );
}
