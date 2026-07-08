"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { ChangePlanDialog } from "@/components/settings/change-plan-dialog";
import { PlanModulesCard } from "@/components/settings/plan-modules-card";
import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBillingPortal, useCheckout } from "@/lib/api/billing";
import { useCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import type { CompanyView, PlanId } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";

import { PLAN_FACTS } from "./plan-facts";

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

function ResubscribeButton({ plan }: { plan: PlanId }) {
  const checkout = useCheckout();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        disabled={checkout.isPending}
        onClick={() => {
          setError(null);
          checkout.mutate(plan, {
            onSuccess: ({ url }) => window.location.assign(url),
            onError: (cause) =>
              setError(
                cause instanceof ApiError
                  ? cause.message
                  : "Couldn't start checkout. Try again.",
              ),
          });
        }}
      >
        {checkout.isPending ? "Opening…" : "Resubscribe"}
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
        <p className="text-sm">
          Your plan is set to cancel
          {company.current_period_end
            ? ` on ${fullDate(company.current_period_end)}`
            : " at the end of this period"}
          . Texting stops then; we hold your number for 30 days in case you
          come back. You can undo this from the payment portal.
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
  const canManage = role === "owner" || role === "admin";

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

          {company.data.subscription_status === "canceled" ? (
            <SettingsCard title="Subscription">
              <div className="space-y-3">
                <p className="text-sm">
                  Your subscription is canceled. We hold your number for 30
                  days after your last period — resubscribe before then and
                  everything picks up where it left off.
                </p>
                {canManage && (
                  <ResubscribeButton plan={company.data.plan ?? "starter"} />
                )}
              </div>
            </SettingsCard>
          ) : company.data.plan === null ? (
            <SettingsCard title="Plan">
              <p className="text-sm text-muted-foreground">
                No plan yet — finish setup to pick one and get your number.
              </p>
            </SettingsCard>
          ) : (
            <SettingsCard title="Plan">
              <div className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-lg font-semibold">
                    {PLAN_FACTS[company.data.plan].name}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {PLAN_FACTS[company.data.plan].price}
                  </p>
                  {company.data.subscription_status === "active" &&
                    !company.data.cancel_at_period_end && (
                      <Badge className="border-transparent bg-success/10 text-success">
                        Active
                      </Badge>
                    )}
                </div>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>{PLAN_FACTS[company.data.plan].included}</li>
                  <li>{PLAN_FACTS[company.data.plan].overage}</li>
                  <li>{PLAN_FACTS[company.data.plan].seats}</li>
                  <li>{PLAN_FACTS[company.data.plan].numbers}</li>
                </ul>
                {company.data.current_period_end && (
                  <p className="text-xs text-muted-foreground">
                    Current period ends{" "}
                    {fullDate(company.data.current_period_end)}.
                  </p>
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

              {company.data.subscription_status === "active" && (
                <SettingsCard title="Cancel">
                  <p className="text-sm text-muted-foreground">
                    Cancel anytime from the payment portal. Texting stops at
                    the end of your billing period, and we hold your number
                    for 30 days in case you change your mind — after that
                    it&apos;s released for good.
                  </p>
                </SettingsCard>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only owners and admins can change billing.
            </p>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
