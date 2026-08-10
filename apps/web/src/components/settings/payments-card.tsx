"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { payoutRequirementCopy } from "@loonext/shared";

import { LoadError, SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/error";
import {
  usePayoutAccount,
  useStartPayoutOnboarding,
  useStripeDashboardLink,
} from "@/lib/api/payments";

/**
 * #224 — "Getting paid", the owner's side of text-to-pay.
 *
 * ## Evaluation
 *
 * This screen has exactly one job: say where the business stands, and offer the
 * one thing that moves them forward. There are five states and each has a
 * different next action, so the temptation is a status grid. A grid would be
 * wrong — the reader is a plumber who wants to know whether they can take a
 * card, not an operator auditing a Stripe account.
 *
 * ## The decisions
 *
 * - **One sentence, one button.** The state copy is composed on the SERVER, so
 *   web, Android and iOS say the same thing and none of them can drift into
 *   paraphrase. *Applying: Chunking — three or four items is the ceiling, and a
 *   status page that lists nine booleans is nine.*
 *
 * - **No progress bar.** Onboarding progress belongs to Stripe, which owns the
 *   flow and is the only thing that knows how far through it somebody is. A bar
 *   we invented would either start at 0% — which the manual forbids, because it
 *   tells somebody who has already done work that they have done none — or
 *   would be a number we made up. The honest equivalent is what is OUTSTANDING,
 *   listed below. *Applying: the Goal Gradient Effect, honoured by naming the
 *   remaining steps rather than faking a fraction.*
 *
 * - **Outstanding requirements in plain words.** Stripe answers with
 *   `individual.verification.document`. A person reads "Photo ID for the
 *   business owner". *Applying: Outcomes Over Features.*
 *
 * - **Loss aversion is deliberately ABSENT.** There is no "you are losing
 *   payments" framing on this page. The business has not lost anything; they
 *   have not started. Manufacturing a loss to drive a bank-details form would
 *   be the one place in this product where that lever would be dishonest.
 *
 * - **The Stripe dashboard link is the refund path**, and it is the only place
 *   refunds are offered. See docs/TEXT-TO-PAY.md: we deliberately do not build
 *   a thin copy of a back office that already exists and stays compliant.
 */
export function PaymentsCard() {
  const account = usePayoutAccount();
  const onboarding = useStartPayoutOnboarding();
  const dashboard = useStripeDashboardLink();

  if (account.isLoading) {
    return (
      <SettingsCard title="Getting paid">
        {/* A skeleton, not a spinner: the shape of what is coming is itself
            information, and it stops the card jumping when it lands. */}
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </SettingsCard>
    );
  }

  if (account.isError || !account.data) {
    return <LoadError onRetry={() => void account.refetch()} />;
  }

  const state = account.data;

  async function startOnboarding() {
    try {
      const { url } = await onboarding.mutateAsync();
      // A full navigation, not a new tab. Stripe's flow ends by sending them
      // back to this page, and a tab that closes onto a stale page is how
      // somebody concludes nothing happened.
      window.location.href = url;
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't open Stripe. Try again in a moment.",
      );
    }
  }

  async function openDashboard() {
    try {
      const { url } = await dashboard.mutateAsync();
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : "Couldn't open Stripe. Try again in a moment.",
      );
    }
  }

  const needsOnboarding =
    state.readiness === "not_connected" ||
    state.readiness === "onboarding_incomplete";
  const busy = onboarding.isPending || dashboard.isPending;

  return (
    <SettingsCard title="Getting paid" description={state.title}>
      <p className="text-sm text-muted-foreground">{state.detail}</p>

      {state.requirements_due.length > 0 && (
        <div className="mt-4 rounded-app-ctrl border border-app-amber-line bg-app-amber-bg/60 px-3 py-2.5">
          <p className="text-[13px] font-medium text-app-amber-ink">
            Stripe still needs:
          </p>
          <ul className="mt-1 space-y-0.5">
            {state.requirements_due.map((requirement) => (
              <li
                key={requirement}
                className="text-[13px] text-app-amber-ink/90"
              >
                {payoutRequirementCopy(requirement)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.action && (
        <div className="mt-4">
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void (needsOnboarding ? startOnboarding() : openDashboard())
            }
            className="gap-1"
          >
            {state.action}
            {/* A right chevron on a forward action, an out-arrow on one that
                leaves the product. The difference tells somebody whether they
                are about to leave before they tap. */}
            {needsOnboarding ? (
              <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
            ) : (
              <ArrowUpRight className="size-4" strokeWidth={1.75} aria-hidden />
            )}
          </Button>
        </div>
      )}

      {state.readiness === "ready" && (
        <dl className="mt-5 grid gap-x-6 gap-y-2 border-t border-border-subtle pt-4 text-sm sm:grid-cols-2">
          <Fact
            label="Payouts"
            value={
              state.payouts_enabled
                ? "On — money reaches your bank"
                : "Stripe has not switched payouts on yet"
            }
          />
          <Fact
            label="Charged in"
            value={(state.currency ?? "usd").toUpperCase()}
          />
        </dl>
      )}

      {state.readiness === "ready" && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Refunds, receipts and payout history all live in your Stripe
          dashboard. We never hold your money and we take nothing on top of what
          you charge — Stripe&rsquo;s own card fee is the only deduction.
        </p>
      )}
    </SettingsCard>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}
