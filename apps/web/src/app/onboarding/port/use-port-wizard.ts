"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { stepProgress, type OnboardingSnapshot, type PortDraft } from "../steps";
import { useOnboardingState, type OnboardingState } from "../use-onboarding-state";

/**
 * The port sub-wizard (PORTING.md §8.1) runs BEFORE the company exists, so it
 * lives outside the WizardStep machine (steps.ts) — the machine's tested
 * routing is untouched. This guard reuses the onboarding resume state and adds
 * the port-specific gates: the account holder needs a name saved (the "name"
 * step) and a portable number confirmed (port sub-step 1) before the later
 * sub-steps render; a resume without those redirects to the right place.
 *
 * Once the company + the `POST /v1/port-requests` draft are created (the final
 * sub-step), the local draft is cleared and the standard `/onboarding`
 * dispatcher takes over — routing into registration or straight to the plan.
 */

export type PortSubStep =
  | "number" // enter number + portability check
  | "carrier" // losing-carrier entity/account
  | "address" // service address on file
  | "timing"; // requested FOC + honest window + bridge opt-in

/** The order the sub-steps advance in (drives progress + back links). */
export const PORT_SUB_STEPS: PortSubStep[] = [
  "number",
  "carrier",
  "address",
  "timing",
];

/**
 * Progress dots for a port sub-step. The whole port detour IS the top-level
 * "number" step of the onboarding wizard, so its dots must mirror the wizard's
 * applicable step set rather than a fixed count: a US (or CA-with-US-texting)
 * signup walks 5 steps, a CA-only signup that skips US registration walks 3.
 * Deriving from stepProgress("number", …) — the same source every other step
 * reads — keeps the port screens' "Step 2 of N" honest for the signup's
 * country / US-texting choice (before the company exists the draft decides;
 * after creation the company view does, both handled by applicableSteps).
 */
export function portStepProgress(snapshot: OnboardingSnapshot): {
  index: number;
  total: number;
} {
  return stepProgress("number", snapshot);
}

export interface PortWizardState {
  onboarding: OnboardingState;
  /** The pre-company port intake collected so far. */
  port: PortDraft;
  /** True once resume state is loaded and this sub-step may render. */
  ready: boolean;
}

/** A portable number has been confirmed (sub-step 1 passed). */
function hasPortableNumber(port: PortDraft): boolean {
  return typeof port.phoneE164 === "string" && port.phoneE164.length > 0;
}

/**
 * Guard for one port sub-step: resolves resume state, then redirects when a
 * prerequisite is missing (deep link / stale tab).
 *
 * The company MAY already exist here — the port flow creates it at sub-step 1
 * (to run the company-scoped portability check) but the sub-wizard keeps
 * running until the `POST /v1/port-requests` draft is created on the final
 * sub-step, at which point the local draft is CLEARED. So the signal that the
 * port flow is done is the cleared draft (`mode !== "port"`), not the company's
 * existence:
 *   - already-paid company → the dispatcher (setting-up / inbox);
 *   - draft no longer a port → the standard dispatcher owns the surface;
 *   - no business name → back to the top;
 *   - later sub-steps without a confirmed portable number → sub-step 1.
 */
export function usePortWizardGuard(step: PortSubStep): PortWizardState {
  const onboarding = useOnboardingState();
  const router = useRouter();
  const port = onboarding.draft.port ?? {};

  let redirectTo: string | null = null;
  if (onboarding.status === "ready") {
    const paid =
      onboarding.company !== null &&
      onboarding.company.subscription_status !== "incomplete" &&
      onboarding.company.subscription_status !== "incomplete_expired";
    if (paid || onboarding.draft.mode !== "port") {
      // Payment happened, or the port draft was submitted + cleared → the
      // standard dispatcher decides the next surface.
      redirectTo = "/onboarding";
    } else if (!onboarding.draft.name?.trim()) {
      redirectTo = "/onboarding/name";
    } else if (step !== "number" && !hasPortableNumber(port)) {
      redirectTo = "/onboarding/port";
    }
  }

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  return {
    onboarding,
    port,
    ready: onboarding.status === "ready" && redirectTo === null,
  };
}
