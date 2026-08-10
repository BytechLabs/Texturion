"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { ModuleCard } from "@/components/billing/module-card";
import { PORT_CHECKOUT_TIMELINE } from "@/components/porting/copy";
import {
  HONEST_TIMELINE,
  HONEST_TIMELINE_CA_ONLY,
} from "@/components/registration/copy";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n/provider";
import {
  trackCheckoutStarted,
  trackPlanBuilderViewed,
  trackPlanModuleToggled,
  trackPlanSelected,
  trackPlanTierChanged,
} from "@/lib/analytics/events";
import {
  currencyForCountry,
  formatMoney,
  US_REGISTRATION_FEE_CENTS,
} from "@loonext/shared";

import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useOnboardingCheckout } from "@/lib/api/onboarding";
import { usePortRequestsForCompany } from "@/lib/api/porting";
import {
  PLAN_MODULE_CARDS,
  type PlanId,
  type PlanModule,
} from "@/lib/api/types";
import { consumePlanIntent } from "@/lib/marketing/plan-intent";
import { cn } from "@/lib/utils";

import { StepError, StepLoading, StepShell } from "../step-shell";
import { owesUsRegistration, previousStepHref, stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";
import { PLANS } from "./plans";
import { WorkspaceSummary } from "./workspace-summary";

/**
 * G7 step 4 — plan cards (SPEC §2 pricing) with the honest-timeline card
 * pre-payment (SPEC §4.1 step 4 checkout copy, verbatim) and the US one-time
 * fee line. Checkout is hosted Stripe; returning without paying lands back
 * here via /dashboard?checkout=canceled with a calm note.
 */

/** The add-on cards this step may offer: the catalog minus regions_ca, which
 *  is inert in the single-region model and refused by the checkout API. */
const offerableModuleCards = PLAN_MODULE_CARDS.filter(
  (mod) => mod.id !== "regions_ca",
);

function PlanStep() {
  const t = useT();
  const { state, ready } = useWizardStepGuard("plan");
  const searchParams = useSearchParams();
  const checkout = useOnboardingCheckout();
  const queryClient = useQueryClient();
  const ports = usePortRequestsForCompany(state.companyId);
  const [choosing, setChoosing] = useState<PlanId | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // #12 plan builder: opt-in add-ons carried into checkout.
  const [modules, setModules] = useState<PlanModule[]>([]);
  // Selected plan (radio-style): the cards select, a single "Continue to
  // checkout" button below commits. Starts on Starter, or the /pricing
  // plan-builder intent when one arrived (stashed at signup or carried in this
  // URL). Consumed exactly once in an effect so the SSR pass renders identically.
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("starter");
  useEffect(() => {
    const intent = consumePlanIntent(window.location.search);
    // #255: the builder's denominator, with whatever arrived from /pricing.
    // Reported once per mount, before the intent is applied, so the event says
    // what the person was shown rather than what they later changed it to.
    trackPlanBuilderViewed(
      "onboarding",
      intent?.plan ?? "starter",
      intent?.modules ?? [],
    );
    if (!intent) return;
    setSelectedPlan(intent.plan);
    setModules(intent.modules);
  }, []);

  function toggleModule(id: PlanModule) {
    setModules((current) => {
      const on = !current.includes(id);
      // #255: the same signal as the marketing builder, kept separate by
      // surface. A stranger on /pricing and somebody who has already signed up
      // abandon for different reasons, and averaging the two describes neither.
      trackPlanModuleToggled("onboarding", id, on);
      return on ? [...current, id] : current.filter((m) => m !== id);
    });
  }

  /** Choosing a tier before committing. Moving down is a price objection. */
  function selectPlan(next: PlanId) {
    if (next !== selectedPlan) trackPlanTierChanged("onboarding", next);
    setSelectedPlan(next);
  }

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  // Wait for the port status too: without it a port-in user briefly sees the
  // non-port checkout copy + an editable number before it swaps (the gate
  // short-circuits on !companyId first, so the query is always enabled here).
  if (
    !ready ||
    !state.snapshot ||
    !state.company ||
    !state.companyId ||
    ports.isPending
  ) {
    return <StepLoading />;
  }

  const company = state.company;
  const companyId = state.companyId;
  const progress = stepProgress("plan", state.snapshot);
  const owes = owesUsRegistration(company);
  /**
   * #522: the same fee, resolved the same way the summary above resolves it.
   *
   * This line printed `US_REGISTRATION_FEE_CENTS.usd` while `WorkspaceSummary`
   * on this very screen resolved through the country and printed the CAD
   * figure, so a Canadian reader was shown two different prices for one fee,
   * inches apart, on the last screen before paying.
   *
   * WHICH ONE IS TRUE IS NOT SETTLED HERE, and that is worth being plain
   * about: before a checkout exists Stripe has not pinned a currency, and the
   * catalog decides it (`checkoutCurrency` degrades to USD for a price with no
   * CAD amount, and the row is corrected to match once the session is made).
   * What this screen can guarantee is that it does not contradict itself, and
   * that it quotes the higher of the two rather than the lower, because being
   * charged less than quoted is the recoverable direction.
   */
  const registrationFee = formatMoney(
    US_REGISTRATION_FEE_CENTS[currencyForCountry(company?.country ?? null)],
    currencyForCountry(company?.country ?? null),
  );

  const owesFee = owes && company.registration_fee_paid_at === null;
  const soleProp = state.registration?.brand?.sole_proprietor === true;
  const canceledReturn = searchParams.get("checkout") === "canceled";
  // A pending (non-cancelled) port swaps the checkout copy to the porting
  // window (PORTING.md §8.1) — honest that a transfer takes days.
  const porting = (ports.data?.data ?? []).some(
    (p) => p.status !== "cancelled",
  );
  const timeline = porting
    ? PORT_CHECKOUT_TIMELINE
    : owes
      ? HONEST_TIMELINE
      : HONEST_TIMELINE_CA_ONLY;

  async function choose(plan: PlanId) {
    setFormError(null);
    setChoosing(plan);
    // Funnel: the committed selection (hydrated intent or hand-picked) —
    // plan/module enums only (D8).
    trackPlanSelected(plan, modules);
    try {
      const { url } = await checkout.mutateAsync({ companyId, plan, modules });
      // Funnel: a hosted Checkout session exists and the redirect begins.
      trackCheckoutStarted(plan, modules);
      window.location.assign(url);
      // Keep the button in its busy state while the browser navigates.
    } catch (cause) {
      setChoosing(null);
      if (cause instanceof ApiError && cause.code === "conflict") {
        // A live subscription or missing draft changed under us — the message
        // is specific and actionable; surface it inline (no retry — refetch
        // re-routes the step guard to the honest surface).
        setFormError(cause.message);
        void queryClient.invalidateQueries({
          queryKey: keys.company(companyId),
        });
        void queryClient.invalidateQueries({
          queryKey: keys.registration(companyId),
        });
        return;
      }
      // G10 error toast: what happened + what to do, with a one-tap retry.
      const message =
        cause instanceof ApiError
          ? cause.message
          : t("onboarding.checkoutOpenFailed");
      toast.error(message, {
        action: {
          label: t("common.retry"),
          onClick: () => void choose(plan),
        },
      });
    }
  }

  return (
    <StepShell
      backHref={previousStepHref("plan", state.snapshot) ?? undefined}
      index={progress.index}
      total={progress.total}
      title={t("onboarding.planTitle")}
      subtitle={t("onboarding.planSubtitle")}
    >
      <div className="space-y-6">
        {canceledReturn ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
          >
            {t("onboarding.checkoutCanceled")}
          </p>
        ) : null}

        {/* Edit-until-checkout (G7): the fields that lock at provisioning —
            workspace name + number (country, area code, US-texting) — stay
            editable here, the last step before payment. A country change
            re-routes the wizard. Number edit is hidden for a port-in. */}
        <WorkspaceSummary
          companyId={companyId}
          name={company.name}
          country={company.country}
          chosenNumber={company.chosen_number_e164 ?? null}
          areaCode={company.requested_area_code}
          usTexting={company.us_texting_enabled}
          canEditNumber={!porting}
        />

        {/* Select a plan (radio-style cards), tune add-ons below, then one
            "Continue to checkout" button commits — plan isn't charged on tap. */}
        <div
          role="radiogroup"
          aria-label={t("onboarding.planGroupAria")}
          className="grid gap-4 sm:grid-cols-2"
        >
          {PLANS.map((plan) => {
            const selected = selectedPlan === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectPlan(plan.id)}
                disabled={choosing !== null}
                className={cn(
                  "flex flex-col rounded-lg border bg-card p-5 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:bg-accent/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {plan.name}
                  </h2>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {selected ? (
                      <Check className="size-3.5" strokeWidth={2.5} />
                    ) : null}
                  </span>
                </div>
                <p className="mt-1 flex items-baseline gap-1.5">
                  {/* §3.4: the price in the tokens-track emotional-number scale. */}
                  <span className="app-emotional-number">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("onboarding.perMonth")}
                  </span>
                </p>
                {/* #381: the same price in the unit it is actually felt in.
                    *Applying: Contrast & Anchoring.* */}
                <p className="mt-0.5 text-xs text-muted-foreground">{plan.daily}</p>
                <ul className="mt-4 flex-1 space-y-2">
                  {plan.lines.map((line) => (
                    <li key={line} className="flex items-start gap-2 text-sm">
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {line}
                    </li>
                  ))}
                </ul>
                {plan.id === "pro" && soleProp ? (
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    {t("onboarding.soleProp1Number")}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* #12 plan builder: opt-in add-ons. Toggle before choosing a plan;
            the selection rides into checkout. Calm selectable rows — hairline
            border, a petrol check when on, price on the right. #134/D42:
            calling retired into every plan, and regions_ca stays inert in the
            single-region model (numbers are fixed to the company's country),
            so nothing is offerable today — the whole box hides rather than
            render a heading over an empty list. */}
        {offerableModuleCards.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-[15px] font-medium">
              {t("onboarding.addOnsTitle")}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("onboarding.addOnsHint")}
            </p>
            <div className="mt-4 space-y-2">
              {offerableModuleCards.map((mod) => (
                <ModuleCard
                  key={mod.id}
                  label={mod.label}
                  price={mod.price}
                  blurb={mod.blurb}
                  detail={mod.detail}
                  on={modules.includes(mod.id)}
                  onToggle={() => toggleModule(mod.id)}
                />
              ))}
            </div>
          </div>
        )}

        {owesFee ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {t("onboarding.registrationFeeLine", { fee: registrationFee })}
            <Tooltip>
              <TooltipTrigger
                aria-label={t("onboarding.registrationFeeAria")}
                className="rounded-full focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Info className="size-4" strokeWidth={1.75} aria-hidden />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                {t("onboarding.registrationFeeTooltip")}
              </TooltipContent>
            </Tooltip>
          </p>
        ) : null}

        {/* The honest-timeline card (G7, pre-payment; SPEC §4.1 verbatim) —
            the §3.4 emotional peak: one warm section, calm padding, plain
            language, no wall of compliance text. */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-medium">
            {porting
              ? t("onboarding.portingTimelineTitle")
              : t("onboarding.afterYouPayTitle")}
          </h2>
          <ul className="mt-3 space-y-2">
            {timeline.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2.5 text-sm text-muted-foreground"
              >
                <Check
                  className="mt-0.5 size-4 shrink-0 text-success"
                  strokeWidth={1.75}
                  aria-hidden
                />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <Button
          size="lg"
          className="w-full"
          onClick={() => choose(selectedPlan)}
          disabled={choosing !== null}
        >
          {choosing !== null
            ? t("onboarding.sendingToCheckout")
            : t("onboarding.continueToCheckout")}
        </Button>

        <p className="text-[13px] text-muted-foreground">
          {t("onboarding.textDefinition")}
        </p>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
      </div>
    </StepShell>
  );
}

export default function PlanStepPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={<StepLoading />}>
      <PlanStep />
    </Suspense>
  );
}
