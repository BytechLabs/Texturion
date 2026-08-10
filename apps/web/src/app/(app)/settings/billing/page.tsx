"use client";

import {
  billingCurrencyOf,
  CANCELLATION_GRACE_DAYS,
  roleHasCapability,
} from "@loonext/shared";
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
import { HeldNumbersCard } from "@/components/settings/held-numbers-card";
import { MissedWhileOff } from "@/components/settings/missed-while-off";
import { OffRampCard } from "@/components/settings/off-ramp-card";
import {
  PausedPlanCard,
  pauseQueryEnabled,
} from "@/components/settings/pause-plan";
import {
  type PlanBadge,
  pauseReadOf,
  planBadge,
  planStateUnknownNote,
  readSaysRunning,
} from "@/components/settings/pause-read";
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
import { useT } from "@/i18n/provider";
import { useBillingPortal, usePauseOffer } from "@/lib/api/billing";
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
  label,
  variant = "outline",
}: {
  label?: string;
  variant?: "outline" | "default";
}) {
  const t = useT();
  const portal = useBillingPortal();
  const [error, setError] = useState<string | null>(null);
  // The default lives in the body rather than the signature: a default
  // parameter is evaluated before any hook can run.
  const text = label ?? t("appShell.billingManagePortal");

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
                  : t("appShell.billingPortalFailed"),
              ),
          });
        }}
      >
        {portal.isPending ? t("appShell.billingOpening") : text}
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

/**
 * The plan's state, in the one slot on this card that claims one.
 *
 * THREE TONES FOR THREE MEANINGS, and never a fourth for "we don't know" —
 * `planBadge` answers null there and nothing renders, because an absent badge
 * is the honest shape of an unread fact and a grey pill saying "Unknown" is a
 * screen worrying at somebody about our network.
 *
 *   active    positive green, the house `bg-success/10 text-success` pair.
 *   paused    the house warning pair (`number-card` uses the same one): the
 *             plan named an inch to the left is NOT what is being charged
 *             today, so the badge may not read as a healthy state.
 *   checking  neutral secondary. It says only that we are asking, which is all
 *             that is true yet — and it holds the slot so the badge does not
 *             pop into a line that had none, which is the layout shift a
 *             skeleton exists to avoid.
 */
function PlanStateBadge({ badge }: { badge: PlanBadge | null }) {
  const t = useT();
  if (badge === "active") {
    return (
      <Badge className="border-transparent bg-success/10 text-success">
        {t("appShell.billingBadgeActive")}
      </Badge>
    );
  }
  if (badge === "paused") {
    return (
      <Badge className="border-transparent bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning">
        {t("appShell.billingBadgePaused")}
      </Badge>
    );
  }
  if (badge === "checking") {
    return <Badge variant="secondary">{t("appShell.billingBadgeChecking")}</Badge>;
  }
  return null;
}

function StatusNotices({ company }: { company: CompanyView }) {
  const t = useT();
  if (company.subscription_status === "past_due") {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
        <p className="text-sm">
          {t("appShell.billingPastDue")}
        </p>
        <div className="mt-2">
          <PortalButton
            label={t("appShell.billingUpdatePayment")}
            variant="default"
          />
        </div>
      </div>
    );
  }
  if (company.subscription_status === "unpaid") {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
        <p className="text-sm">
          {t("appShell.billingUnpaid")}
        </p>
        <div className="mt-2">
          <PortalButton
            label={t("appShell.billingUpdatePayment")}
            variant="default"
          />
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
            stamped `canceled_at` yet), so the anchor is named instead.

            #524 — AND "Texting stops then" IS FALSE FOR A PAUSED READER. A
            pause is a price swap rather than a cancellation, so Stripe can hold
            `cancel_at_period_end` on a workspace that is ALSO paused, and this
            notice then sits on the same screen as the paused card saying
            texting is already off. The qualifier is unconditional rather than
            branched on `GET /v1/billing/pause`: this notice renders above the
            cancel card, and EXIT-R3 requires everything down to the exit to be
            byte-for-byte identical whatever that read says. A sentence that
            reflows when a Stripe round trip lands is an exit that moves under
            somebody's thumb. PAGE-PAUSE-7 pins both halves. */}
        {/* Head / when / tail rather than two whole sentences: the tail is the
            qualified "texting stops" claim PAGE-PAUSE-7 pins, and two copies of
            it is two chances for one of them to drift. */}
        <p className="text-sm">
          {t("appShell.billingCancelScheduled")}
          {company.current_period_end
            ? t("appShell.billingCancelOnDate", {
                date: fullDate(company.current_period_end) ?? "",
              })
            : t("appShell.billingCancelAtPeriodEnd")}
          {t("appShell.billingCancelTail", {
            days: CANCELLATION_GRACE_DAYS,
          })}
        </p>
        <div className="mt-2">
          <PortalButton label={t("appShell.billingKeepPlan")} />
        </div>
      </div>
    );
  }
  return null;
}

export default function BillingSettingsPage() {
  const t = useT();
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
  /**
   * #277: whether this workspace is on a paid pause, and may it take one.
   *
   * ASKED HERE AND NOWHERE ELSE ON THIS PAGE. `GET /v1/billing/pause` round-trips
   * to Stripe twice — the subscription, then the price — and this screen renders
   * it on every visit, so the gate is deliberately narrow: somebody who can
   * manage billing, on a workspace with a plan and a live subscription. That is
   * also the only shape a paused workspace can have, because a pause is a price
   * swap and leaves `subscription_status` genuinely `active`. The cancel card
   * asks for the same key, so the two surfaces cost one request between them.
   *
   * THE PREDICATE IS SHARED WITH THAT CARD rather than re-typed here. Both
   * surfaces enable the same query key, so react-query fires the request if
   * either says yes — two hand-kept gates cannot be two opinions, only the wider
   * one. See `pauseQueryEnabled`.
   */
  const showPause = pauseQueryEnabled(canManage, company.data);
  /**
   * WHAT WAS READ, not what a missing answer looks like.
   *
   * This was `usePauseOffer(showPause).data?.paused_at != null`, and that
   * expression is false in three different situations: nobody asked, the read
   * has not landed, and the read failed. None of them is "not paused" — so a
   * genuinely paused workspace on a cold start got the green Active badge, the
   * allowance lines of a plan that is not running, and a "Switch to Starter"
   * that `POST /v1/billing/change-plan` refuses with a 409 by design. See
   * `pause-read.ts` for the four states and what each one licenses.
   */
  const pauseQuery = usePauseOffer(showPause);
  const pause = pauseReadOf(showPause, pauseQuery);
  const badge = planBadge(pause, {
    subscriptionActive: company.data?.subscription_status === "active",
    cancelAtPeriodEnd: company.data?.cancel_at_period_end === true,
  });
  const unknownNote = planStateUnknownNote(pause);
  /**
   * The plan's own terms, which are only true of a plan that is running.
   *
   * `unasked` keeps them, and it is the one carve-out: nobody asked because
   * nobody could (a member cannot read `GET /v1/billing/pause` at all), and
   * blanking a plan's contents would punish the one reader who has no control
   * on this card to be misled about. The BADGE — the only thing here that
   * claims a state — is withheld for them either way.
   */
  const showsPlanTerms = readSaysRunning(pause) || pause.state === "unasked";

  return (
    <SettingsPage
      title={t("appShell.billingTitle")}
      description={t("appShell.billingDescription")}
    >
      {company.isPending ? (
        <div className="space-y-4" aria-label={t("appShell.billingLoading")}>
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : company.isError ? (
        <LoadError onRetry={() => company.refetch()} />
      ) : (
        <div className="space-y-6">
          <StatusNotices company={company.data} />

          {/* #277: the paid pause, when this workspace is on one. It is the
              state of the whole screen — it is why the plan below has no Active
              badge and why nothing can be sent — so it goes at the top, and it
              renders nothing at all otherwise.

              BELOW the payment notices rather than above them: a card that has
              stopped working is the one thing more urgent than the pause, and it
              is the one thing that can end a pause badly. */}
          <PausedPlanCard show={showPause} />

          {/* #490: directly under the status notice that says the line is off,
              because it is the consequence of that sentence rather than a
              separate topic. Renders nothing when nobody called. */}
          <MissedWhileOff show={company.data.subscription_status !== "active"} />

          {/* #481: only for a workspace on its way out — the card returns null
              otherwise. Directly under the count of customers who rang into
              nothing, because this is what to DO about that. */}
          <OffRampCard />

          {company.data.subscription_status === "canceled" ? (
            <SettingsCard title={t("appShell.billingSubscription")}>
              <div className="space-y-3">
                <p className="text-sm">{t("appShell.billingCanceled")}</p>

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
            <SettingsCard title={t("appShell.billingPlan")}>
              <p className="text-sm text-muted-foreground">
                {t("appShell.billingNoPlanYet")}
              </p>
            </SettingsCard>
          ) : (
            <SettingsCard title={t("appShell.billingPlan")}>
              <div className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-lg font-semibold">
                    {planFacts.name}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {planFacts.price}
                  </p>
                  {/* #277: what we have been TOLD, never what a missing answer
                      looks like. The subscription really is `active` in Stripe
                      — that is the point of a price swap — so this badge is the
                      only thing on the screen that can contradict the paused
                      card above it, and it is the half a reader acts on. It is
                      green only on an answer that said the plan is running;
                      before that answer lands it says it is checking, and after
                      one that failed it says nothing at all. */}
                  <PlanStateBadge badge={badge} />
                </div>
                {showsPlanTerms && (
                  <>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      <li>{planFacts.included}</li>
                      <li>{planFacts.overage}</li>
                      <li>{planFacts.seats}</li>
                      <li>{planFacts.numbers}</li>
                    </ul>
                    {/* #85: the exact allowances live in the fair-use policy,
                        not on the plan card. */}
                    <p className="text-xs text-muted-foreground">
                      {t("appShell.billingFairUse")}{" "}
                      <Link
                        href="/legal/fair-use"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {t("appShell.billingSeePolicy")}
                      </Link>
                      .
                    </p>
                  </>
                )}
                {/* Asked, and the ask failed. One sentence and a way to ask
                    again — and nothing at all while it is still in flight,
                    because the badge above already says so and narrating a
                    request is not information. */}
                {unknownNote && (
                  <p className="text-sm text-muted-foreground">
                    {unknownNote}{" "}
                    <button
                      type="button"
                      onClick={() => void pauseQuery.refetch()}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t("common.retry")}
                    </button>
                  </p>
                )}
                {company.data.current_period_end && (
                  <p className="text-xs text-muted-foreground">
                    {t("appShell.billingPeriodEnds", {
                      date: fullDate(company.data.current_period_end) ?? "",
                    })}
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
              <PrepaidYearCard show />
            )}

          {/* #399: the referral link. On the billing screen because the reward
              is a month off the invoice, and behind the same owner/admin gate
              for the same reason. */}
          {canManage &&
            company.data.plan !== null &&
            company.data.subscription_status === "active" && (
              <ReferralCard
                plan={company.data.plan}
                // #522: the reward is a month of THIS workspace's plan, so the
                // figure naming it comes from the same currency the plan card
                // above is quoted in.
                currency={billingCurrencyOf(company.data.billing_currency)}
                show
              />
            )}

          {/* #277: only on a plan we have been TOLD is running. `POST
              /v1/billing/change-plan` answers 409 while `paused_at` is set and
              names the two steps instead ("resume first, then switch plans"),
              so a switcher here would be a control whose only outcome is a
              refusal — and that was equally true of the window before the read
              landed, which is why the gate is `readSaysRunning` rather than "no
              pause in hand". The same fact takes the second one off the cancel
              card below. */}
          {canManage &&
                  company.data.subscription_status === "active" &&
                  readSaysRunning(pause) && (
                    <ChangePlanDialog company={company.data} />
                  )}
              </div>
            </SettingsCard>
          )}

          {/* #523: numbers held back because the plan they resubscribed onto
              covers fewer than they hold. DIRECTLY UNDER the plan card, because
              it is a consequence of the allowance stated on it and one of its
              two routes back is the "Upgrade to Pro" control inside it —
              putting it further down would separate the problem from the
              button that solves it. *Applying: Prioritize Intent.*

              Gated on `billing.manage` because the route is: a member gets a
              403 from it, and enabling the query for them would spend a request
              to render nothing.

              Gated on an ACTIVE subscription for a sharper reason than saving a
              request. `over_plan_allowance` is the only reason this card
              renders for, and the server can only produce it on a live
              subscription — a cancelled workspace's numbers are suspended for
              the grace window instead, which the win-back card above owns. So
              this predicate is the client half of the same distinction, not a
              second opinion about it. */}
          <HeldNumbersCard
            show={canManage && company.data.subscription_status === "active"}
          />

          {/* Add-ons wait for the read, the same as the plan switch above. A
              pause leaves `subscription_status` genuinely "active" (it is a
              price swap, not a cancellation), so this gate cannot see one on
              its own. `POST /v1/billing/modules` refuses to turn an add-on ON
              while paused, and the card's own promise that "changes prorate to
              today" is false in that state, so offering the toggle is offering
              a 409 under a sentence that is not true. */}
          {canManage &&
            company.data.plan !== null &&
            company.data.subscription_status === "active" &&
            readSaysRunning(pause) && <PlanModulesCard />}

          {canManage ? (
            <>
              <SettingsCard
                title={t("appShell.billingPaymentTitle")}
                description={t("appShell.billingPaymentDescription")}
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
              {t("appShell.billingNotYourRole")}
            </p>
          )}
        </div>
      )}
    </SettingsPage>
  );
}
