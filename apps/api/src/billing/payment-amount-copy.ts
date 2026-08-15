/**
 * #228 — the English a rejected amount goes out in, on the wire.
 *
 * `paymentAmountProblemCopy` names catalogue keys now, and all three clients
 * resolve them in the reader's language. The API cannot: it throws an
 * `ApiError` whose message a client built last month renders verbatim, and the
 * server does not know the reader's language anyway — `profiles.locale`'s null
 * means "ask the device, then the workspace", and no client sends the device
 * half.
 *
 * This is the same shape as `extra-number-copy.ts` beside it, and for the same
 * reason. The difference worth knowing: this one should almost never be seen.
 * Every client checks `paymentAmountProblem` locally before the round trip, so
 * a person sees their own language and this text only surfaces when something
 * skipped the client gate.
 *
 * The strings must stay word-for-word identical to the English in
 * `apps/web/src/i18n/catalog.ts`. A test asserts exactly that.
 */
import type { PaymentAmountKey } from "@loonext/shared";

export const PAYMENT_AMOUNT_REASONS_EN: Record<PaymentAmountKey, string> = {
  /*
   * `{amount}` is filled by the caller from `formatMoney`, which knows the
   * currency. A figure typed in here would be the USD one shown to a Canadian
   * workspace — the bug the currency parameter exists to prevent.
   */
  "payments.amountTooSmall": "The smallest payment we can take is {amount}.",
  "payments.amountTooLarge": "The largest payment we can take by text is {amount}.",
  "payments.amountNotWhole": "Enter an amount in dollars and cents.",
};

/** The wire's language. See the module docblock for why it is not the reader's. */
export const englishAmountProblem = (key: PaymentAmountKey): string =>
  PAYMENT_AMOUNT_REASONS_EN[key];
