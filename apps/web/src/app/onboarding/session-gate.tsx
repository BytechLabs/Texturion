"use client";

import { SessionExpiredCard } from "@/components/shell/session-expired";
import { useSessionState } from "@/lib/auth/use-session-ready";

/**
 * The wizard's dead-session branch (#257).
 *
 * Onboarding runs outside CompanyProvider, so it never inherited the provider's
 * expired-session handling — and every step gates `/v1/me` on
 * `useSessionReady()`, which is false for "signed-out" as well as "pending". A
 * disabled TanStack query stays `isPending` forever, so the wizard's status
 * never left "loading": a customer who left /onboarding/plan open past token
 * expiry came back to "Picking up where you left off…" and stayed there. The
 * middleware deliberately does not bounce them (a session cookie plus a
 * getUser() error is the documented fail-open), and `GateEscape` hides itself
 * without a session, so there was no sign-out and no way back either.
 *
 * One gate for the whole wizard rather than a branch per step: every screen,
 * including the paid setting-up one, is a dead end in exactly the same way.
 */
export function OnboardingSessionGate({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const sessionState = useSessionState();
  if (sessionState === "signed-out") return <SessionExpiredCard />;
  return <>{children}</>;
}
