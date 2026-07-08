/**
 * Signup → checkout funnel events (D8, D12), client half. The API Worker
 * captures the authoritative server events (checkout_completed,
 * first_outbound_sent, registration_submitted/approved with
 * `distinct_id = company_id`); these client events fill in the steps the
 * server never sees — form submits, wizard progression, the moment the
 * builder intent turns into a real selection.
 *
 * Same D8 posture as posthog.ts, enforced here by construction:
 * - every helper is typed to enums/UUIDs only — no free-text parameter
 *   exists, so no PII can be passed;
 * - everything still flows through the init-time `sanitize_properties`
 *   scrubber (defense in depth);
 * - NEXT_PUBLIC_POSTHOG_KEY unset → initPostHog resolves null → every helper
 *   is a silent no-op (identical to the rest of the analytics surface);
 * - capture is fire-and-forget: an analytics outage must never block a
 *   submit handler or a redirect (initPostHog never rejects).
 */

import type { PlanId, PlanModule } from "@/lib/api/types";

import { initPostHog } from "./posthog";

/** The wizard steps (mirrors app/onboarding/steps.ts WizardStep). */
export type OnboardingStep =
  | "name"
  | "number"
  | "business"
  | "texting"
  | "plan";

/**
 * Once-guards, so re-mounts / polling effects / the dispatcher re-running
 * never double-count a milestone:
 * - signup_completed: once per BROWSER (localStorage) — it can fire from two
 *   surfaces (the signup page's instant-session branch, then the onboarding
 *   dispatcher after the confirm-email / OAuth round trip).
 * - checkout_completed: once per TAB (sessionStorage) — the setting-up screen
 *   re-renders on every poll tick while provisioning runs.
 */
const SIGNUP_COMPLETED_GUARD_KEY = "loonext.evt.signup_completed";
const CHECKOUT_COMPLETED_GUARD_KEY = "loonext.evt.checkout_completed";

function capture(
  event: string,
  ...rest: [properties?: Record<string, unknown>]
): void {
  // Forward the arguments as given: a bare milestone stays a single-arg
  // capture(event), while an event that carries (possibly undefined) intent
  // keeps its properties slot. initPostHog never rejects, so this is
  // fire-and-forget — an analytics outage never blocks a handler or redirect.
  void initPostHog().then((posthog) => {
    posthog?.capture(event, ...rest);
  });
}

/**
 * Returns true the first time a guard key is claimed. Storage failures
 * (SSR, privacy modes, quota) fail OPEN — better a rare double-count than a
 * silently missing funnel step.
 */
function claimOnce(
  store: "localStorage" | "sessionStorage",
  key: string,
): boolean {
  try {
    if (typeof window === "undefined") return true;
    const storage = window[store];
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, new Date().toISOString());
    return true;
  } catch {
    return true;
  }
}

/**
 * The signup form was submitted (client-side validation passed; the Supabase
 * call is in flight). Carries the pricing-builder intent when one exists —
 * plan/module enums only.
 */
export function trackSignupStarted(
  intent?: { plan: PlanId; modules: readonly PlanModule[] } | null,
): void {
  capture(
    "signup_started",
    intent ? { plan: intent.plan, modules: [...intent.modules] } : undefined,
  );
}

/**
 * A session exists for a brand-new account. Fired from the signup page when
 * email confirmation is disabled (instant session) AND from the onboarding
 * dispatcher (confirm-email + OAuth land there); the once-per-browser guard
 * keeps it to a single event.
 */
export function trackSignupCompleted(): void {
  if (!claimOnce("localStorage", SIGNUP_COMPLETED_GUARD_KEY)) return;
  capture("signup_completed");
}

/** A wizard step's submit succeeded and the user moved forward. */
export function trackOnboardingStepCompleted(step: OnboardingStep): void {
  capture("onboarding_step_completed", { step });
}

/**
 * The user committed a plan on the onboarding plan step (the builder intent,
 * hydrated or hand-picked, consumed into a checkout attempt).
 */
export function trackPlanSelected(
  plan: PlanId,
  modules: readonly PlanModule[],
): void {
  capture("plan_selected", { plan, modules: [...modules] });
}

/** A hosted Stripe Checkout session was created and the redirect is starting. */
export function trackCheckoutStarted(
  plan: PlanId,
  modules: readonly PlanModule[],
): void {
  capture("checkout_started", { plan, modules: [...modules] });
}

/**
 * The checkout return confirmed as paid on the setting-up screen (client
 * view; the API Worker's server-side checkout_completed stays authoritative).
 */
export function trackCheckoutCompleted(): void {
  if (!claimOnce("sessionStorage", CHECKOUT_COMPLETED_GUARD_KEY)) return;
  capture("checkout_completed");
}
