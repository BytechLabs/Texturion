"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  pathForLocation,
  resolveOnboardingLocation,
} from "./steps";
import { StepError, StepLoading } from "./step-shell";
import { useOnboardingState } from "./use-onboarding-state";

/**
 * /onboarding — the resume dispatcher (G7: resumable, state from GET /v1/me +
 * GET /v1/registration). Computes where this account left off and replaces
 * the URL with that step / the setting-up screen / the inbox.
 */
export default function OnboardingDispatchPage() {
  const state = useOnboardingState();
  const router = useRouter();

  // Port-in resume (PORTING.md §8.1): an in-progress port draft (mode "port"
  // with a confirmed number) that hasn't been submitted yet — and whose company
  // hasn't paid — belongs back in the port sub-wizard, not the standard machine.
  // The sub-wizard clears the draft when it creates the port row, so this only
  // fires mid-collection. resolveOnboardingLocation is untouched (its tests
  // never set mode "port").
  const paid =
    state.company !== null &&
    state.company.subscription_status !== "incomplete" &&
    state.company.subscription_status !== "incomplete_expired";
  const portResuming =
    state.status === "ready" &&
    !paid &&
    state.draft.mode === "port" &&
    Boolean(state.draft.port?.phoneE164);

  const target = portResuming
    ? "/onboarding/port/carrier"
    : state.snapshot
      ? pathForLocation(resolveOnboardingLocation(state.snapshot))
      : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  return <StepLoading />;
}
