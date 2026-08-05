"use client";

import { CANCELLATION_GRACE_DAYS, roleHasCapability } from "@loonext/shared";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CancelSubscriptionCard } from "@/components/settings/cancel-subscription-card";
import {
  HoldSentence,
  ResubscribeButton,
  WinbackAnswer,
} from "@/components/settings/cancellation-answer";
import { ChangePlanDialog } from "@/components/settings/change-plan-dialog";
import { MissedWhileOff } from "@/components/settings/missed-while-off";
import { OffRampCard } from "@/components/settings/off-ramp-card";
import { PlanModulesCard } from "@/components/settings/plan-modules-card";
import { PrepaidYearCard } from "@/components/settings/prepaid-year-card";
import { ReferralCard } from "@/components/settings/referral-card";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBillingPortal } from "@/lib/api/billing";
import { useCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

import { planFactsFor } from "./plan-facts";

function fullDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function PortalButton({
  label = "Manage payment & invoices",
  variant = "outline",
}: {
  label?: string;
  variant?: "outline" | "default";
}) {
  const portal = useBillingPortal();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        disabled={portal.isPending}
        onClick={() => {
          setError(null);
          portal.mutate(undefined, {
            onSuccess: ({ url }) => window.location.assign(url),
            onError: (cause) =>
              setError(
                cause instanceof ApiError
                  ? cause.message
                  : "Couldn't open the billing portal. Try again.",
              ),
          });
        }}
      >
        {portal.isPending ? "Opening…" : label}
        <ExternalLink strokeWidth={1.75} aria-hidden />
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function StatusNotices({ company }: { company: CompanyView }) {
  if (company.subscription_status === "past_due") {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
        <p className="text-sm">
          Your last payment didn&apos;t go through. Update your payment method
          to keep sending messages.
        </p>
        <div className="mt-2">
          <PortalButton label="Update payment method" variant="default" />
        </div>
      </div>
    );
  }
  if (company.subscription_status === "unpaid") {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
        <p className="text-sm">
          Sending is paused until your payment method is updated.
        </p>
        <div className="mt-2">
          <PortalButton label="Update payment method" variant="default" />
        </div>
      </div>
    );
  }
  // A portal cancellation scheduled for period end: Stripe keeps the
  // subscription `active` with cancel_at_period_end=true, mirrored onto the
  // company by the webhook (SPEC §9 "handle cancel_at_period_end display").
  if (
    company.subscription_status === "active" &&
    company.cancel_at_period_end
  ) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
        {/* The hold is counted from the day cancelling was REQUESTED, not from
            the day texting stops — `canceled_at` comes off Stripe's own
            `subscription.canceled_at`. This notice used to read "texting stops
            then; we hold your number for 30 days", which invites the reader to
            count from the period end and can overstate the real deadline by
            most of a month. The exact date cannot be shown here (nothing has
            stamped `canceled_at` yet), so the anchor is named instead. */}
        <p className="text-sm">
          Your plan is set to cancel
          {company.current_period_end
            ? ` on ${fullDate(company.current_period_end)}`
            : " at the end of this period"}
          . Texting stops then. Your number is held for{" "}
          {CANCELLATION_GRACE_DAYS} days from the day you cancelled — not from
          that date — so it can be released soon afterwards. You can undo this
          from the payment portal.
        </p>
        <div className="mt-2">
          <PortalButton label="Keep my plan" />
        </div>
      </div>
    );
  }
  return null;
}

export default function BillingSettingsPage() {
  const { role } = useActiveCompany();
  const company = useCompany();
  /**
   * #315: billing is an AXIS, not a rung on a ladder.
   *
   * `roleHasCapability(role, "billing.manage")` is the same answer a rank check
   * gave for owner and admin, and a different one for the preset that exists
   * precisely for this screen. The bookkeeper carries `billing.manage` and
   * nothing else: every route behind these controls is gated on that one
   * capability (`billingRoutes.use("*", requireCapability("billing.manage"))`,
   * and `referralRoutes` the same), and `withBillingRedacted` serves them
   * `canceled_at`, `cancel_at_period_end` and `winback_dismissed_at` on that
   * same test. So a rank check here served the data, allowed the call, and then
   * hid the card from the one role built to use it — `company-view.ts` warns
   * against exactly this ("a rank check here would lock the one role built for
   * this out of it") a few lines above the field list it guards.
   *
   * Cancelling stays owner-only below, and that is not a rank check standing
   * in for a capability — it is #421: `POST /v1/billing/portal` hands an owner
   * the full portal and everybody else `flow_data.type =
   * "payment_method_update"`, which has no cancellation surface on it at all.
   */
  const canManage = roleHasCapability(role, "billing.manage");
  // #328: the plan card quotes the currency this workspace is actually
  // charged in. Reading "$29/mo" beside a Canadian invoice for $39 is a
  // contradiction on the one screen where the number is the whole content.
  // Falls back to USD while the company is still loading, which is also what
  // every workspace that predates the column is on.
  const planFacts = planFactsFor(company.data?.billing_currency)[
    company.data?.plan ?? "starter"
  ];

  return (
    <SettingsPage title="Billing" description="Your plan and payment details.">
      {company.isPending ? (
        <div className="space-y-4" aria-label="Loading billing">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : company.isError ? (
        <LoadError onRetry={() => company.refetch()} />
      ) : (
        <div className="space-y-6">
          <StatusNotices company={company.data} />

          {/* #490: directly under the status notice that says the line is off,
              because it is the consequence of that sentence rather than a
              separate topic. Renders nothing when nobody called. */}
          <MissedWhileOff show={company.data.subscription_status !== "active"} />

          {/* #481: only for a workspace on its way out — the card returns null
              otherwise. Directly under the count of customers who rang into
              nothing, because this is what to DO about that. */}
          <OffRampCard />

          {company.data.subscription_status === "canceled" ? (
            <SettingsCard title="Subscription">
              <div className="space-y-3">
                <p className="text-sm">Your subscription is canceled.</p>

                {/* #277 follow-up: the answer to what they told us on the way
                    out, said once more while the number can still be saved.
                    ABOVE the deadline line on purpose — the shared seasonal
                    copy points at "the date below", and the date is the next
                    thing in this card. Gated on billing.manage because both the
                    reason route and `winback_dismissed_at` are. Renders nothing
                    for the four reasons we have nothing honest to add to, once
                    it has been dismissed, and once the hold has expired. */}
                {canManage && <WinbackAnswer company={company.data} />}

                <HoldSentence company={company.data} />

                {canManage && (
                  <ResubscribeButton plan={company.data.plan ?? "starter"} />
                )}
              </div>
            </SettingsCard>
          ) : company.data.plan === null ? (
            <SettingsCard title="Plan">
              <p className="text-sm text-muted-foreground">
                No plan yet. Finish setup to pick one and get your number.
              </p>
            </SettingsCard>
          ) : (
            <SettingsCard title="Plan">
              <div className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-lg font-semibold">
                    {planFacts.name}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {planFacts.price}
                  </p>
                  {company.data.subscription_status === "active" &&
                    !company.data.cancel_at_period_end && (
                      <Badge className="border-transparent bg-success/10 text-success">
                        Active
                      </Badge>
                    )}
                </div>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>{planFacts.included}</li>
                  <li>{planFacts.overage}</li>
                  <li>{planFacts.seats}</li>
                  <li>{planFacts.numbers}</li>
                </ul>
                {/* #85: the exact allowances live in the fair-use policy, not on
                    the plan card. */}
                <p className="text-xs text-muted-foreground">
                  Allowances reflect fair use.{" "}
                  <Link
                    href="/legal/fair-use"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    See the policy
                  </Link>
                  .
                </p>
                {company.data.current_period_end && (
                  <p className="text-xs text-muted-foreground">
                    Current period ends{" "}
                    {fullDate(company.data.current_period_end)}.
                  </p>
                )}
                {/* #400/D107: the prepaid year, below the plan it applies to. Gated
              on an owner/admin with a healthy subscription — the server checks
              the rest (activated, no plan change pending, no year already
              running, catalog provisioned) and the card renders nothing until
              all of it says yes. */}
          {canManage &&
            company.data.plan !== null &&
            company.data.subscription_status === "active" && (
              <PrepaidYearCard plan={company.data.plan} show />
            )}

          {/* #399: the referral link. On the billing screen because the reward
              is a month off the invoice, and behind the same owner/admin gate
              for the same reason. */}
          {canManage &&
            company.data.plan !== null &&
            company.data.subscription_status === "active" && (
              <ReferralCard plan={company.data.plan} show />
            )}

          {canManage &&
                  company.data.subscription_status === "active" && (
                    <ChangePlanDialog company={company.data} />
                  )}
              </div>
            </SettingsCard>
          )}

          {canManage &&
            company.data.plan !== null &&
            company.data.subscription_status === "active" && <PlanModulesCard />}

          {canManage ? (
            <>
              <SettingsCard
                title="Payment & invoices"
                description="Cards, receipts, and billing details live in the secure Stripe portal."
              >
                <PortalButton />
              </SettingsCard>

              {/* #277: the cancel path used to be a sentence pointing at the
                  portal button above. It now asks why on this card, alongside
                  the export offer and the button that leaves.

                  The card renders open, and that is load-bearing rather than a
                  styling choice: the sentence it replaced cost one press to
                  reach Stripe, so anything here that has to be expanded first
                  would make leaving more expensive than it was.

                  Hidden once the cancellation is already scheduled: the notice
                  at the top of this screen says so and offers "Keep my plan",
                  and a second Cancel button beside it would do nothing. */}
              {company.data.subscription_status === "active" &&
                !company.data.cancel_at_period_end && (
                  <CancelSubscriptionCard
                    isOwner={role === "owner"}
                    company={company.data}
                  />
                )}
            </>
          ) : (
            /* Not "only owners and admins": since #315 a bookkeeper manages
               billing without being either, so a sentence that lists ranks is
               a sentence that goes stale the next time a preset is added. The
               owner is named because the owner holds every capability by
               definition, so "ask the owner" cannot become wrong. */
            <p className="text-sm text-muted-foreground">
              Billing isn&apos;t part of your role in this workspace. Ask the
              owner if you need it.
            </p>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
