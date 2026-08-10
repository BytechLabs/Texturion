import { ChevronRight, Lock } from "lucide-react";

import { DEFAULT_LOCALE, isLocale, type PaymentRequestState } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * #224 — the page a homeowner opens after a text asking them to pay.
 *
 * ## Evaluation
 *
 * This is the highest-stakes page in the product and the one with the least on
 * it. The reader tapped a link in a text message asking for money. Their
 * default posture is suspicion, and they are right to hold it — this is exactly
 * the shape of a scam. Everything below is chosen to answer "is this real?"
 * before it asks for anything.
 *
 * ## What binds it
 *
 * *The Safety Principle, taken to its limit.* Conventional to the point of
 * dull. No animation, no cookie banner, no navigation, nothing to dismiss, and
 * none of OUR branding anywhere — the page appears under the BUSINESS's name,
 * because that is who the customer has a relationship with. A payment page that
 * behaves unexpectedly reads as a phishing site, which is the only failure that
 * matters here.
 *
 * *Prioritize Intent.* Three facts, in the order the reader needs them: who is
 * asking, how much, what for. Then one button. Nothing competes with it.
 *
 * *Anchoring, deliberately unused.* No "only $X", no comparison, no urgency, no
 * countdown. This is a bill somebody already agreed to, not an offer, and every
 * persuasion device would push it further towards looking like a scam.
 *
 * *Zen of Clarity.* The card form is Stripe's. We do not embed it, wrap it, or
 * reimplement it: the reader's card details never touch anything of ours, and
 * the domain they type them into is one their bank recognises.
 *
 * ## Every failure is one page
 *
 * Expired, revoked, cancelled, never existed: one message, saying what to do
 * next rather than what went wrong. The customer cannot act on the difference,
 * and telling them apart hands an oracle to anybody guessing URLs (D75).
 */
export function PaymentPage({
  businessName,
  amount,
  description,
  state,
  payUrl,
  locale,
  notAvailable = false,
}: {
  businessName?: string;
  /** Pre-formatted by the API, so the currency is stated where it differs. */
  amount?: string;
  description?: string;
  state?: PaymentRequestState;
  payUrl?: string | null;
  /**
   * #228: the BUSINESS's language, sent by the API.
   *
   * Not the reader's device and not ours. The person opening this has a
   * relationship with the tradesperson, and a Quebec crew's customer meeting an
   * English payment page is the Bill 96 problem in miniature. There is no
   * provider here — this renders outside the app shell, for somebody with no
   * account — so the lookup is built directly rather than taken from context.
   */
  locale?: string;
  notAvailable?: boolean;
}) {
  const t = makeTranslate(isLocale(locale) ? locale : DEFAULT_LOCALE);
  if (notAvailable || !state || !amount) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("payments.linkUnavailableTitle")}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {t("payments.linkUnavailableDetail")}
        </p>
      </main>
    );
  }

  if (state !== "requested" || !payUrl) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight">
          {settledHeading(state, t)}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {settledDetail(state, businessName ?? t("payments.theBusiness"), amount, t)}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      {/* WHO is asking, first and largest of the three facts — a payment
          request from an unnamed sender is a phishing text. */}
      <p className="text-[15px] text-muted-foreground">
        {t("payments.asksFor", { business: businessName ?? "" })}
      </p>
      {/* HOW MUCH. The one number on the page, at the one size nobody can
          mistake. Optical, not mathematical: tracking is tightened because
          large numerals read loose at this weight. */}
      <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
        {amount}
      </p>
      {/* WHAT FOR, in the business's own words. */}
      <p className="mt-3 text-[15px] leading-relaxed text-foreground">
        {description}
      </p>

      <a
        href={payUrl}
        className="mt-8 inline-flex min-h-[52px] items-center justify-center gap-1 rounded-app-ctrl bg-primary px-6 text-[16px] font-medium text-primary-foreground transition-colors duration-150 ease-out hover:opacity-90"
      >
        {t("payments.payAmount", { amount })}
        {/* A right chevron: the action continues somewhere, and saying so
            before the tap is what stops the next page feeling like a redirect
            they did not agree to. */}
        <ChevronRight className="size-5" strokeWidth={1.75} aria-hidden />
      </a>

      <p className="mt-4 flex items-start gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        <span>
          {t("payments.cardHandledByStripe", { business: businessName ?? "" })}
        </span>
      </p>
    </main>
  );
}

/** The heading for a request that is no longer payable. */
export function settledHeading(
  state: PaymentRequestState,
  t: Translate,
): string {
  switch (state) {
    case "paid":
    case "refunded":
    case "disputed":
      return t("payments.settledPaidTitle");
    case "cancelled":
      return t("payments.settledCancelledTitle");
    case "expired":
      return t("payments.settledExpiredTitle");
    case "requested":
      return t("payments.linkUnavailableTitle");
  }
}

/** And what to do about it, which is usually nothing. */
export function settledDetail(
  state: PaymentRequestState,
  businessName: string,
  amount: string,
  t: Translate,
): string {
  switch (state) {
    case "paid":
    case "refunded":
    case "disputed":
      return t("payments.settledPaidDetail", { business: businessName, amount });
    case "cancelled":
      return t("payments.settledCancelledDetail", { business: businessName });
    case "expired":
      return t("payments.settledExpiredDetail", { business: businessName, amount });
    case "requested":
      return t("payments.askForANewOne");
  }
}
