"use client";

import { HandCoins } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  formatMoney,
  PAYMENT_DESCRIPTION_MAX,
  paymentAmountProblem,
  paymentAmountProblemCopy,
  paymentRequestSms,
  roleHasCapability,
  type BillingCurrency,
} from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { useCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import {
  useCreatePaymentRequest,
  usePayoutAccount,
} from "@/lib/api/payments";

/**
 * #224 — "that'll be $250 for the deposit", asked in the thread.
 *
 * ## Evaluation, and the constraints that bound the design
 *
 * This is the only control in the composer that asks somebody else for money,
 * and it is used by a tech standing in a driveway on a phone. So:
 *
 * - **Absent unless the workspace can actually take a payment.** Same rule as
 *   #520's on-my-way button: a control that is present and inert costs every
 *   reader the moment it takes to work out why it does nothing, on every thread,
 *   forever. A workspace that has not connected Stripe sees nothing here — the
 *   setup lives in Settings, where the owner is, and a tech cannot action it
 *   anyway. *Applying: Zen of Clarity, and Prioritize Intent.*
 *
 * - **Never an empty form.** The description arrives pre-filled with "Deposit",
 *   which is the ask this feature exists for and the one most likely to be
 *   right. *Applying: Smart Defaults.*
 *
 * - **The preview IS the ethical friction.** Sending a bill to a customer is
 *   customer-visible and cannot be unsent, so the exact text that will arrive is
 *   shown before the button that sends it — not a summary of it, the message
 *   itself, composed by the same shared function the server uses. A confirm
 *   dialog would add a step without adding information; this adds the
 *   information. *Applying: Ethical Friction, at the only edge that has any.*
 *
 * - **Amount in the account's own currency.** A Canadian business's Stripe
 *   account settles in CAD, so the field is prefixed with what they will
 *   actually receive rather than a bare dollar sign. *Applying: the money-literal
 *   rule — a price with no currency is a price in a currency nobody chose.*
 */
export function AskForPayment({ conversationId }: { conversationId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  // Smart Defaults: the ask this feature was built for, editable in one tap.
  const [description, setDescription] = useState("Deposit");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const { role } = useActiveCompany();
  // #315: a read-only observer sees the work and never acts as the business
  // toward a customer. Asking one for money is the sharpest possible instance
  // of that, so the control is absent rather than present-and-refused — the
  // server would refuse it, but a button that always errors is a defect report
  // waiting to be filed.
  const canAsk = roleHasCapability(role, "conversations.send");
  const account = usePayoutAccount(canAsk);
  const company = useCompany();
  const create = useCreatePaymentRequest(conversationId);

  const currency: BillingCurrency =
    account.data?.currency === "cad" ? "cad" : "usd";
  const businessName = company.data?.name ?? "";

  const cents = useMemo(() => parseAmountToCents(amount), [amount]);
  const problem = cents === null ? null : paymentAmountProblem(cents);

  const preview =
    cents !== null && problem === null && description.trim().length > 0
      ? paymentRequestSms({
          businessName: businessName || "Your business",
          amountCents: cents,
          currency,
          description,
          // The real URL is minted by the server; this stands in for it at the
          // same length so the preview does not lie about how long the text is.
          url: "https://app.loonext.com/pay/…",
        })
      : null;

  // Not a disabled button. A workspace that cannot charge sees no control at
  // all, and the owner is told why on the settings screen that can fix it.
  if (!canAsk) return null;
  if (!account.data || account.data.readiness !== "ready") return null;

  async function submit() {
    if (cents === null || problem !== null) return;
    try {
      await create.mutateAsync({
        amountCents: cents,
        description: description.trim(),
        idempotencyKey,
      });
      toast.success(
        t("payments.asked", { amount: formatMoney(cents, currency) }),
      );
      setOpen(false);
      setAmount("");
      setDescription("Deposit");
      // A new key for the next ask: reusing it would let the server dedupe a
      // genuinely different request as a retry of this one.
      setIdempotencyKey(crypto.randomUUID());
    } catch (cause) {
      // The server's words. A refusal here is usually a RULE — the customer
      // opted out, the plan lapsed, Stripe is still verifying — and "couldn't
      // send" would read as the button being broken rather than the rule
      // working.
      toast.error(
        cause instanceof ApiError ? cause.message : t("payments.sendFailed"),
      );
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <HandCoins className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t("payments.askAction")}
      </Button>
    );
  }

  return (
    <div className="mx-auto mb-2 max-w-[42rem] rounded-app-ctrl border border-app-tint-line bg-app-tint/40 px-3 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[8rem] flex-1">
          <Label htmlFor="payment-amount" className="text-[12px] text-app-muted">
            {t("payments.amountLabel")}
          </Label>
          <div className="relative">
            <span
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-app-muted"
              aria-hidden
            >
              {currency === "cad" ? "CA$" : "US$"}
            </span>
            <Input
              id="payment-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              // The phone keyboard a number belongs on, and the one this is
              // typed on nine times out of ten.
              inputMode="decimal"
              autoFocus
              placeholder="250.00"
              className={currency === "cad" ? "pl-11" : "pl-11"}
            />
          </div>
        </div>
        <div className="min-w-[10rem] flex-[2]">
          <Label
            htmlFor="payment-description"
            className="text-[12px] text-app-muted"
          >
            {t("payments.descriptionLabel")}
          </Label>
          <Input
            id="payment-description"
            value={description}
            maxLength={PAYMENT_DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      {problem !== null && (
        <p className="mt-2 text-[12px] text-app-amber-ink">
          {paymentAmountProblemCopy(problem, currency, t)}
        </p>
      )}

      {/* The message itself, not a description of it. */}
      {preview && (
        <div className="mt-3">
          <p className="text-[12px] text-app-muted">
            {t("payments.theyWillReceive")}
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-app-bub bg-app-paper px-3 py-2 text-[13px] text-app-ink">
            {preview}
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={cents === null || problem !== null || create.isPending}
          onClick={() => void submit()}
        >
          {cents !== null && problem === null
            ? t("payments.askFor", { amount: formatMoney(cents, currency) })
            : t("payments.askAction")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          {t("common.cancel")}
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-app-muted-2">
        {t("payments.footnote")}
      </p>
    </div>
  );
}

/**
 * "250", "250.50", "$250.5" → cents. Anything else → null.
 *
 * Deliberately strict about the SHAPE and forgiving about decoration: a person
 * typing on a phone adds a dollar sign or a comma without thinking, and
 * refusing that would be pedantry. What is refused is anything that is not a
 * number, because a silently-misread amount is the one error this feature
 * cannot afford.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned.length === 0) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  // Via a string rather than `* 100`: 19.99 * 100 is 1998.9999999999998, and
  // rounding that is a coin-flip nobody should be taking with somebody's bill.
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
