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

  const target = state.snapshot
    ? pathForLocation(resolveOnboardingLocation(state.snapshot))
    : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (state.status === "error") return <StepError onRetry={state.retry} />;
  return <StepLoading />;
}
