"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Info } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

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
import type { PlanId } from "@/lib/api/types";

import { StepError, StepLoading, StepShell } from "../step-shell";
import { owesUsRegistration, stepProgress } from "../steps";
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
  const [choosing, setChoosing] = useState<PlanId | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
  const timeline = owes ? HONEST_TIMELINE : HONEST_TIMELINE_CA_ONLY;

  async function choose(plan: PlanId) {
    setFormError(null);
    setChoosing(plan);
    try {
      const { url } = await checkout.mutateAsync({ companyId, plan });
      window.location.assign(url);
      // Keep the button in its busy state while the browser navigates.
    } catch (cause) {
      setChoosing(null);
      if (cause instanceof ApiError) {
        setFormError(cause.message);
        if (cause.code === "conflict") {
          // A live subscription or missing draft changed under us — refetch;
          // the step guard re-routes to the honest surface.
          void queryClient.invalidateQueries({
            queryKey: keys.company(companyId),
          });
          void queryClient.invalidateQueries({
            queryKey: keys.registration(companyId),
          });
        }
      } else {
        setFormError("Something went wrong on our end. Try again in a moment.");
      }
    }
  }

  return (
    <StepShell
      backHref={owes ? "/onboarding/texting" : "/onboarding/number"}
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
              <p className="mt-1">
                <span className="text-3xl font-semibold tabular-nums tracking-tight">
                  {plan.price}
                </span>
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

        {/* The honest-timeline card (G7, pre-payment; SPEC §4.1 verbatim). */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium">What happens after you pay</h2>
          <ul className="mt-2 space-y-1.5">
            {timeline.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/50"
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
