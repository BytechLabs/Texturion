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
 * #312 — a visitor raised their hand without buying.
 *
 * The one step in the arrive-and-do-not-buy path that was invisible. Page views
 * and `checkout_completed` already bracket non-conversion, so "arrived, did not
 * buy" was measurable in aggregate — but "arrived, did not buy, and *asked us
 * something*" was not, and that is the population worth a follow-up rather than
 * a statistic.
 *
 * Carries NOTHING about who they are. The submitter's name, email and message
 * are already stored server-side in `contact_messages` under #340's retention;
 * putting any of it here would move a non-customer's identity into a third party
 * for a count, which SPEC §10 forbids and this module is typed to prevent.
 *
 * Not guarded: a second genuine enquiry a fortnight later is a real event, and
 * PostHog funnels read the first occurrence anyway.
 */
export function trackContactSubmitted(): void {
  capture("contact_submitted");
}

/**
 * #312 — a visitor asked us to email them the comparison instead of buying.
 *
 * The other half of the same population as `contact_submitted`, and a distinct
 * signal: an enquiry is a question we have to answer, this is somebody who liked
 * the numbers enough to want them in writing and was not ready to sign up. Both
 * are "arrived, did not buy, raised a hand", and telling them apart is what makes
 * the step actionable rather than a single undifferentiated count.
 *
 * Carries NOTHING about who they are — the address and their consent are stored
 * server-side in `marketing_contacts` with their own retention. Same reason as
 * above: SPEC §10 allows UUIDs, counts and feature events only, and moving a
 * non-customer's identity into a third party for the sake of a count would fail
 * it even without the module's typing preventing it.
 *
 * Not guarded. Somebody who asks again from a different page is asking again.
 */
export function trackComparisonRequested(): void {
  capture("comparison_requested");
}

/**
 * The checkout return confirmed as paid on the setting-up screen (client
 * view; the API Worker's server-side checkout_completed stays authoritative).
 */
export function trackCheckoutCompleted(): void {
  if (!claimOnce("sessionStorage", CHECKOUT_COMPLETED_GUARD_KEY)) return;
  capture("checkout_completed");
}

/**
 * #255 — the plan builder, opened.
 *
 * The funnel already brackets non-conversion: `signup_started` carries the
 * intent, `plan_selected` and `checkout_started` record the commitment. What
 * was missing is the DENOMINATOR for the builder itself — how many people
 * arranged a plan and then did not commit one — and #255 asks for exactly that:
 * "where people abandon the plan builder, and on which module".
 *
 * `surface` separates the two builders. The marketing one on /pricing is a
 * stranger deciding whether to buy; the onboarding one is somebody who already
 * signed up. They abandon for different reasons and mixing them would average
 * the two into a number that describes neither.
 */
export function trackPlanBuilderViewed(
  surface: "pricing" | "onboarding",
  plan: PlanId,
  modules: readonly PlanModule[],
): void {
  capture("plan_builder_viewed", { surface, plan, modules: [...modules] });
}

/**
 * #255 — a module was switched on or off, and which one.
 *
 * The single event #255 names that nothing else can answer. A module toggled ON
 * and then absent from `plan_selected` is somebody who considered it and
 * decided against it at the price, which is the most useful pricing signal this
 * product can collect — and it is invisible from the endpoints alone.
 *
 * Carries the module ENUM and nothing else. Per D8 and SPEC §10 no analytics
 * event here identifies a workspace or a person; the question is which module
 * loses people, not who.
 */
export function trackPlanModuleToggled(
  surface: "pricing" | "onboarding",
  module: PlanModule,
  on: boolean,
): void {
  capture("plan_module_toggled", { surface, module, on });
}

/**
 * #255 — the plan tier changed on a builder card.
 *
 * Distinct from `plan_selected`, which is the commitment. Somebody moving from
 * Pro to Starter before committing is a price objection; the two events read
 * identically without this one.
 */
export function trackPlanTierChanged(
  surface: "pricing" | "onboarding",
  plan: PlanId,
): void {
  capture("plan_tier_changed", { surface, plan });
}
