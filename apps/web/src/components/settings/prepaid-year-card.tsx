"use client";

import { CalendarCheck } from "lucide-react";
import { useState } from "react";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { useBuyPrepaidYear, usePrepayOffer } from "@/lib/api/billing";
import { ApiError } from "@/lib/api/error";
import { PLAN_PRICING, type PlanId } from "@/lib/api/types";

/**
 * #400 / D107 — pay for a year up front.
 *
 * # What this card refuses to do, which is most of its design
 *
 * IT RENDERS ONLY WHEN THE SERVER SAYS SO. Eligibility is not a client
 * judgement: the workspace has to have actually sent a message, be paying
 * without trouble, have no plan change pending, have no year already running,
 * and the catalog has to be provisioned. Every one of those is a server fact,
 * so the card asks and shows nothing until the answer is yes. A purchase button
 * that 409s on click is worse than no button.
 *
 * IT DOES NOT APPEAR AT SIGNUP. That is #400's own sequencing insight and the
 * server enforces it — asking somebody to pre-pay twelve months before they
 * have sent a single text, on a product that may still be waiting on carrier
 * approval and can be REJECTED, extracts the most at the moment the customer
 * has received the least.
 *
 * IT QUOTES NO HAND-TYPED PRICE. The figure comes from the server's
 * `price_cents`, and the comparison it is set against comes from PLAN_PRICING —
 * the same table every other price on this screen traces to. A literal here
 * would be the first hardcoded number on a paying customer's billing page.
 *
 * # Why the daily figure is there
 *
 * Applying Contrast & Anchoring: $290 is a number somebody has to think about;
 * 79 cents a day is one they can place instantly against what they already
 * spend. #400 asks for exactly this frame, and it is the most favourable
 * HONEST comparison this product can make — it is the real price divided by the
 * real number of days, not a marketing rounding.
 *
 * Also applying Loss Aversion, in the one direction that is fair here: the card
 * names what the year SAVES against paying monthly, rather than implying
 * anything is lost by not buying. The reader is already a paying customer.
 */

/** The saving, and the daily figure, from real numbers only. */
export function prepaidYearFraming(priceCents: number, plan: PlanId) {
  const monthlyCents = PLAN_PRICING[plan].monthlyDollars * 100;
  const twelveMonths = monthlyCents * 12;
  return {
    /** What twelve monthly payments would have cost. */
    twelveMonthsCents: twelveMonths,
    /** What the year saves. Never negative — a year that saves nothing is not an offer. */
    savingCents: Math.max(0, twelveMonths - priceCents),
    /** Cents a day, rounded to the cent. 365 days, not 360 — this has to be true. */
    perDayCents: Math.round(priceCents / 365),
  };
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

export function PrepaidYearCard({
  plan,
  show,
}: {
  plan: PlanId;
  /** The caller's gate: an owner or admin, on an active subscription. */
  show: boolean;
}) {
  const offer = usePrepayOffer(show);
  const buy = useBuyPrepaidYear();
  const [error, setError] = useState<string | null>(null);

  // Never a skeleton and never an error box. This is an offer on somebody
  // else's screen — a billing page showing a broken panel where a price should
  // be looks like the billing itself is broken, which is the same rule
  // MissedWhileOff follows.
  if (!show || !offer.data) return null;

  const { eligible, price_cents: priceCents, months, open } = offer.data;

  // A year already running is worth saying, once, without a button. The
  // customer paid; the useful fact is when it ends.
  if (open) {
    return (
      <SettingsCard title="Your year">
        <p className="text-sm text-muted-foreground">
          You paid for a year on this plan. Your monthly plan fee is covered
          until{" "}
          <span className="font-medium text-foreground">
            {new Date(open.granted_through).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
          . Texts beyond your included allowance are still billed each month.
        </p>
      </SettingsCard>
    );
  }

  if (!eligible || priceCents === null) return null;

  const { twelveMonthsCents, savingCents, perDayCents } = prepaidYearFraming(
    priceCents,
    plan,
  );

  return (
    <SettingsCard title="Pay for a year">
      <div className="flex items-start gap-3">
        <CalendarCheck
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {dollars(priceCents)} for {months} months
            </span>{" "}
            instead of {dollars(twelveMonthsCents)} — that&apos;s{" "}
            {dollars(savingCents)} saved, about {perDayCents}&cent; a day.
          </p>
          <p className="text-sm text-muted-foreground">
            One charge today. Your plan fee is covered for {months} months;
            texts beyond your included allowance are still billed each month, as
            now. Nothing else about your account changes.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setError(null);
                buy.mutate(undefined, {
                  onSuccess: ({ url }) => window.location.assign(url),
                  onError: (cause) =>
                    setError(
                      cause instanceof ApiError
                        ? cause.message
                        : "That didn't go through. Try again in a moment.",
                    ),
                });
              }}
              disabled={buy.isPending}
            >
              {buy.isPending ? "Opening checkout..." : `Pay ${dollars(priceCents)}`}
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
