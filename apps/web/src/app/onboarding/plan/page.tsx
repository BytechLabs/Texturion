"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

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
import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";
import { useOnboardingCheckout } from "@/lib/api/onboarding";
import { usePortRequestsForCompany } from "@/lib/api/porting";
import {
  PLAN_MODULE_CARDS,
  type PlanId,
  type PlanModule,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { StepError, StepLoading, StepShell } from "../step-shell";
import { owesUsRegistration, previousStepHref, stepProgress } from "../steps";
import { useWizardStepGuard } from "../use-onboarding-state";

/**
 * G7 step 4 — plan cards (SPEC §2 pricing) with the honest-timeline card
 * pre-payment (SPEC §4.1 step 4 checkout copy, verbatim) and the US one-time
 * fee line. Checkout is hosted Stripe; returning without paying lands back
 * here via /dashboard?checkout=canceled with a calm note.
 */

interface PlanCard {
  id: PlanId;
  name: string;
  price: string;
  lines: string[];
}

// SPEC §2 plan table, in human terms (G7: feature deltas in 5 lines max).
const PLANS: PlanCard[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$29",
    lines: [
      "500 outgoing texts included each month",
      "Your whole crew — 3 teammates",
      "1 business number",
      "Incoming texts & photos free, always",
      "3¢ per extra outgoing text",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$79",
    lines: [
      "2,500 outgoing texts included each month",
      "10 teammates",
      "2 business numbers",
      "Incoming texts & photos free, always",
      "2.5¢ per extra outgoing text",
    ],
  },
];

function PlanStep() {
  const { state, ready } = useWizardStepGuard("plan");
  const searchParams = useSearchParams();
  const checkout = useOnboardingCheckout();
  const queryClient = useQueryClient();
  const ports = usePortRequestsForCompany(state.companyId);
  const [choosing, setChoosing] = useState<PlanId | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // #12 plan builder: opt-in add-ons carried into checkout.
  const [modules, setModules] = useState<PlanModule[]>([]);

  function toggleModule(id: PlanModule) {
    setModules((current) =>
      current.includes(id)
        ? current.filter((m) => m !== id)
        : [...current, id],
    );
  }

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  if (!ready || !state.snapshot || !state.company || !state.companyId) {
    return <StepLoading />;
  }

  const company = state.company;
  const companyId = state.companyId;
  const progress = stepProgress("plan", state.snapshot);
  const owes = owesUsRegistration(company);
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
    try {
      const { url } = await checkout.mutateAsync({ companyId, plan, modules });
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
          : "We couldn't open checkout — this is usually a brief connection hiccup. Check your connection and try again.";
      toast.error(message, {
        action: { label: "Try again", onClick: () => void choose(plan) },
      });
    }
  }

  return (
    <StepShell
      backHref={previousStepHref("plan", state.snapshot) ?? undefined}
      index={progress.index}
      total={progress.total}
      title="Pick your plan"
      subtitle="One flat price for your whole crew. No contracts — cancel any time."
    >
      <div className="space-y-6">
        {canceledReturn ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
          >
            Checkout was canceled — you haven&apos;t been charged. Pick a plan
            whenever you&apos;re ready.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="flex flex-col rounded-lg border border-border bg-card p-5"
            >
              <h2 className="text-sm font-medium text-muted-foreground">
                {plan.name}
              </h2>
              <p className="mt-1 flex items-baseline gap-1.5">
                {/* §3.4: the price in the tokens-track emotional-number scale. */}
                <span className="app-emotional-number">{plan.price}</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </p>
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
                  Sole proprietor registrations are limited to 1 number by
                  carriers — Pro still adds teammates and texts.
                </p>
              ) : null}
              <Button
                size="lg"
                className="mt-5 w-full"
                variant={plan.id === "starter" ? "default" : "outline"}
                onClick={() => choose(plan.id)}
                disabled={choosing !== null}
              >
                {choosing === plan.id
                  ? "Sending you to checkout…"
                  : `Choose ${plan.name}`}
              </Button>
            </div>
          ))}
        </div>

        {/* #12 plan builder: opt-in add-ons. Toggle before choosing a plan;
            the selection rides into checkout. Calm selectable rows — hairline
            border, a petrol check when on, price on the right. */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-medium">Add-ons</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Optional — turn on only what you need. Add or remove them any time.
          </p>
          <div className="mt-4 space-y-2">
            {/* regions_ca is inert in the single-region model (numbers are
                fixed to the company's country), so it isn't offered yet. */}
            {PLAN_MODULE_CARDS.filter((mod) => mod.id !== "regions_ca").map(
              (mod) => {
              const on = modules.includes(mod.id);
              return (
                <button
                  key={mod.id}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleModule(mod.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    on
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {on ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{mod.label}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {mod.price}/mo
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">
                      {mod.blurb}
                    </span>
                    {mod.detail ? (
                      <span className="mt-1 block text-[13px] font-medium text-foreground/80">
                        {mod.detail}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {owesFee ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            + $29 one-time carrier registration (US texting)
            <Tooltip>
              <TooltipTrigger
                aria-label="Why the registration fee?"
                className="rounded-full focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Info className="size-4" strokeWidth={1.75} aria-hidden />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                US carriers require every business to register before texting
                customers. This covers their registration and vetting fees —
                charged once, ever. We file the paperwork for you.
              </TooltipContent>
            </Tooltip>
          </p>
        ) : null}

        {/* The honest-timeline card (G7, pre-payment; SPEC §4.1 verbatim) —
            the §3.4 emotional peak: one warm section, calm padding, plain
            language, no wall of compliance text. */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-[15px] font-medium">
            {porting ? "Bringing your number over" : "What happens after you pay"}
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

        <p className="text-[13px] text-muted-foreground">
          A &ldquo;text&rdquo; is one 160-character message segment — long
          texts and emoji use more than one. Incoming texts never count.
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
