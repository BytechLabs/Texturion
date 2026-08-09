import type { BillingCurrency } from "@loonext/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  ChangePlanResult,
  HostedUrl,
  PlanId,
  PlanModule,
} from "./types";

/** GET /v1/billing/modules row — a module + its current enabled state. */
export interface BillingModule {
  id: PlanModule;
  label: string;
  blurb: string;
  /** Concrete quantity line ("300 forwarded minutes a month"); null if none. */
  detail: string | null;
  monthly_cents: number;
  enabled: boolean;
  available: boolean;
}

/**
 * POST /v1/billing/checkout — { plan } → hosted Stripe Checkout URL.
 * Callers navigate with `window.location.assign(url)` (hosted page).
 */
export function useCheckout() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (plan: PlanId) =>
      apiFetch<HostedUrl>("/v1/billing/checkout", {
        method: "POST",
        companyId,
        body: { plan },
      }),
  });
}

export interface PrepayOffer {
  eligible: boolean;
  /** Why not, when not. The card never shows this; the copy is server-side. */
  reason: string | null;
  price_cents: number | null;
  /**
   * #522 — the currency `price_cents` AND `monthly_cents` are in.
   *
   * Always present, including on a refusal. Formatting `price_cents` without it
   * printed a CAD year as "$290" and then collected US$290: a one-time Stripe
   * price does not refuse a session in a currency it does not carry, it just
   * bills the base one, so nothing failed loudly on the one screen whose whole
   * purpose is a large up-front payment.
   */
  currency: BillingCurrency;
  /**
   * The plan's list price, for the "instead of twelve months" comparison.
   *
   * Sent by the server in the SAME currency as `price_cents` rather than looked
   * up here, so the two halves of the comparison cannot land in different
   * money. Null only when there is no plan to compare against — which is also a
   * shape that can never be `eligible`.
   */
  monthly_cents: number | null;
  months: number;
  /** The year already running, when there is one. */
  open: {
    plan: PlanId;
    amount_cents: number;
    /**
     * What was actually COLLECTED, which is not necessarily what this workspace
     * is charged in today: a year bought before the CAD option was filed is
     * genuinely USD. Anything printing `amount_cents` must use this and not the
     * offer's `currency`, or it relabels somebody's past payment.
     */
    currency: BillingCurrency;
    granted_through: string;
    /**
     * #583 — what ending this year early would put back on the account.
     *
     * Both figures are in `currency` above (what was COLLECTED), which is not
     * necessarily what this workspace bills in today. Null on a row written
     * before this shipped.
     */
    conversion: {
      consumed_months: number;
      credit_cents: number;
    } | null;
  } | null;
}

/**
 * GET /v1/billing/prepay (#400/D107) — may this workspace buy a year, and is
 * one already running?
 *
 * `enabled` is passed by the caller so the request never fires on a screen that
 * would not render the answer — this costs a Stripe round trip server-side to
 * check for a pending plan change.
 */
export function usePrepayOffer(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [...keys.modules(companyId), "prepay"],
    queryFn: () => apiFetch<PrepayOffer>("/v1/billing/prepay", { companyId }),
    enabled,
  });
}

/** POST /v1/billing/prepay — buy a year, via hosted Stripe Checkout. */
export function useBuyPrepaidYear() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: () =>
      apiFetch<HostedUrl>("/v1/billing/prepay", { method: "POST", companyId }),
  });
}

export type ReferralStage =
  | "invited"
  | "signed_up"
  | "active"
  | "rewarded"
  | "voided";

export interface ReferralsView {
  code: string;
  /** Null when the site origin is not configured; the code alone still works. */
  link: string | null;
  referrals: { id: string; created_at: string; stage: ReferralStage }[];
  rewarded_this_year: number;
  reward_cap_per_year: number;
}

/** GET /v1/referrals (#399) — this workspace's link and what it has done. */
export function useReferrals(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "referrals"],
    queryFn: () => apiFetch<ReferralsView>("/v1/referrals", { companyId }),
    enabled,
  });
}

export interface ReferralMomentView {
  ask: boolean;
  /** Why not, when we are not asking. For us, never for the owner. */
  refusal?: string;
  /** The number the headline quotes. Present only when asking. */
  customers?: number;
}

/**
 * GET /v1/referrals/moment (#288) — has this crew earned the ask?
 *
 * `enabled` is the caller's, and it is `billing.manage`: the whole referrals
 * router is behind that gate, so a member asking this would collect a 403 on
 * every dashboard load for a card they were never going to be shown.
 */
export function useReferralMoment(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "referral-moment"],
    queryFn: () =>
      apiFetch<ReferralMomentView>("/v1/referrals/moment", { companyId }),
    enabled,
  });
}

/**
 * POST /v1/referrals/dismiss (#288) — "Not now."
 *
 * The moment is set to `ask: false` in the cache rather than invalidated. An
 * owner who has just put a card away should not watch it reappear for the length
 * of a round trip.
 */
export function useDismissReferralAsk() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>("/v1/referrals/dismiss", { method: "POST", companyId }),
    onMutate: () => {
      queryClient.setQueryData<ReferralMomentView>(
        [companyId, "referral-moment"],
        { ask: false, refusal: "dismissed" },
      );
    },
  });
}

/** GET /v1/billing/modules — the add-on catalog with each module's state. */
export function useModules() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.modules(companyId),
    queryFn: () =>
      apiFetch<{ modules: BillingModule[] }>("/v1/billing/modules", {
        companyId,
      }),
  });
}

export interface MissedWhileOff {
  count: number;
  /** The window's start — the count is bounded to the last 90 days. */
  since: string;
  /** The most recent one, or null. Says WHEN, not only how many. */
  last_at: string | null;
}

/**
 * GET /v1/billing/missed-while-off (#490) — how many customers rang while the
 * line could not take them.
 *
 * `enabled` is the caller's, deliberately: this is only asked on a workspace
 * whose subscription is not active. It is an aggregate over the busiest table
 * in the product, and a healthy workspace must never pay for a question it is
 * not asking.
 */
export function useMissedWhileOff(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.missedWhileOff(companyId),
    queryFn: () =>
      apiFetch<MissedWhileOff>("/v1/billing/missed-while-off", { companyId }),
    enabled,
  });
}

/** One number this workspace holds but its plan does not currently cover. */
export interface HeldNumber {
  id: string;
  number_e164: string | null;
  /** When it went on hold. Null only for a row suspended before #523 shipped. */
  suspended_at: string | null;
}

/**
 * Why this workspace's numbers are suspended. The two reasons are DIFFERENT
 * states with different answers, and the server decides which one applies
 * rather than leaving three clients to infer it from `plan` and
 * `subscription_status`:
 *
 *   over_plan_allowance   they resubscribed onto a plan smaller than the one
 *                         they left. The answer is this card's two routes back.
 *   subscription_inactive the grace window. The answer is the win-back card,
 *                         and this surface must stay out of its way.
 */
export type HeldNumbersReason = "over_plan_allowance" | "subscription_inactive";

export interface HeldNumbersView {
  plan: PlanId | null;
  /** What the plan itself covers, before anything bought on top. */
  included: number | null;
  /** Extra-number capacity actually billed today. */
  paid_extras: number;
  /** `included + paid_extras` — the line the hold is measured against. */
  allowance: number | null;
  /** The plan's hard TOTAL cap (#80), or null when it has none (Pro). */
  max_total: number | null;
  /** Null when nothing is held. */
  reason: HeldNumbersReason | null;
  held: HeldNumber[];
  /**
   * #522: what ONE held number costs to bring back, and the currency that
   * figure is denominated in. Both are served rather than derived here — a
   * client that renders "$5" out of its own head on a workspace billed in CAD
   * is the exact bug #522 was.
   */
  extra_number_cents: number | null;
  extra_number_currency: BillingCurrency;
  /**
   * Whether POST .../reinstate would be accepted right now. The button is
   * ABSENT when this is false rather than present-and-failing: being told "no"
   * after pressing something is how somebody concludes the product is broken.
   */
  can_reinstate: boolean;
  /** Starter only: the other way back, which needs no extra-number purchase. */
  can_upgrade: boolean;
}

/**
 * GET /v1/billing/held-numbers (#523) — which numbers this workspace holds that
 * its plan does not cover, and both ways to bring them back.
 *
 * A number goes on hold when a resubscribe lands on a plan smaller than the one
 * the workspace left: coming back is never refused, so the plan is respected
 * AFTER checkout instead. Nothing is released — the row still receives texts
 * and calls — but it cannot send or answer, and until this route there was
 * nowhere in the product that said why.
 *
 * `enabled` is the caller's, the same way `useMissedWhileOff` and
 * `usePauseOffer` beside it are. It is behind `billing.manage`, so a member
 * gets a 403 from it, and a healthy workspace must never pay for a question it
 * is not asking.
 */
export function useHeldNumbers(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.heldNumbers(companyId),
    queryFn: () =>
      apiFetch<HeldNumbersView>("/v1/billing/held-numbers", { companyId }),
    enabled,
  });
}

/** POST /v1/billing/held-numbers/:id/reinstate — what the route answers. */
export interface ReinstatedNumber {
  reinstated: boolean;
  /** True when it was already back — a double-press, never a second charge. */
  already_active?: boolean;
  paid_extras?: number;
  allowance?: number | null;
  held?: HeldNumber[];
}

/**
 * POST /v1/billing/held-numbers/:id/reinstate (#523) — buy the capacity for one
 * held number and bring it back.
 *
 * THIS SPENDS MONEY THE MOMENT IT IS CALLED. The server raises the
 * extra-number quantity with `always_invoice`, so the charge lands now rather
 * than surfacing on a later invoice. No caller may fire it without the customer
 * having read the amount first — that consent is the whole difference between
 * this and adding a line to the checkout session, which #523 rejected.
 *
 * THE IDEMPOTENCY KEY IS REQUIRED and is minted ONCE PER NUMBER, not once per
 * press. A lost response is the dangerous case here: the charge may well have
 * landed, and a retry carrying a fresh key would buy a second unit of capacity
 * for a number that only ever needed one. Reusing the key means the retry
 * resolves to the same Stripe operation. Same rule, same reasoning, as the
 * composer's `idempotencyKeyFor`.
 *
 * ONE AT A TIME, each with its own consent — a workspace holding three numbers
 * buys them back one by one.
 */
export function useReinstateHeldNumber() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { numberId: string; idempotencyKey: string }) =>
      apiFetch<ReinstatedNumber>(
        `/v1/billing/held-numbers/${input.numberId}/reinstate`,
        {
          method: "POST",
          companyId,
          idempotencyKey: input.idempotencyKey,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.heldNumbers(companyId) });
      // The number's own status changed, and the numbers screen renders it
      // from a different query than this one — without this the card says it
      // came back while the list beside it still reads "On hold".
      queryClient.invalidateQueries({ queryKey: keys.numbers(companyId) });
      queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
    },
  });
}

/** POST /v1/billing/modules — turn an add-on on/off on the live subscription. */
export function useSetModule() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { module: PlanModule; enabled: boolean }) =>
      apiFetch<{ module: PlanModule; enabled: boolean }>(
        "/v1/billing/modules",
        { method: "POST", companyId, body: input },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.modules(companyId) });
      queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
    },
  });
}

/** POST /v1/billing/portal — payment methods, invoices, cancellation only. */
export function useBillingPortal() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: () =>
      apiFetch<HostedUrl>("/v1/billing/portal", {
        method: "POST",
        companyId,
      }),
  });
}

/**
 * POST /v1/billing/cancellation-reason (#277): why this workspace is leaving,
 * asked before the handoff to the portal above. Afterwards they are gone, and
 * nobody answers a survey about a product they have already left.
 *
 * BOTH FIELDS ARE OPTIONAL, and a body with neither is a valid record meaning
 * "they skipped the question". There is nothing to validate here and nothing
 * that can refuse to send.
 *
 * DO NOT AWAIT IT. This is a note to us; cancelling is theirs. Callers fire it
 * alongside the portal call rather than in front of it, so an endpoint that is
 * slow, down, or answering 500 cannot add a second to somebody leaving, let
 * alone stop them. The route does not gate the portal on having been called
 * either, so the two really are independent.
 *
 * `reason` is one of the short codes the asking screen owns; the route caps it
 * at 40 characters and `detail` at 2,000, and over-length is a 422 rather than
 * a truncation.
 */
export function useRecordCancellationReason() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (input: { reason: string | null; detail: string | null }) =>
      // 204 No Content: apiFetch resolves to undefined, which is the whole
      // answer: there is nothing to show for it and nothing to invalidate.
      apiFetch<void>("/v1/billing/cancellation-reason", {
        method: "POST",
        companyId,
        body: input,
      }),
  });
}

/** GET /v1/billing/cancellation-reason — the OPEN row, read back. */
export interface StatedCancellationReason {
  /**
   * The code the cancel card recorded, or null.
   *
   * NULL IS NOT THE SAME AS NO ROW, and both arrive here as null: one is
   * somebody who opened the cancel screen and skipped the question, the other
   * is a workspace that never saw it. Both render nothing, so the client does
   * not need to tell them apart — the report the route feeds does, which is why
   * the route keeps them distinct on its side.
   */
  reason: string | null;
  stated_at: string | null;
}

/**
 * GET /v1/billing/cancellation-reason (#277 follow-up) — what they told us on
 * the way out, so the canceled-state card can answer it during the grace
 * window.
 *
 * NOT ON `company_view`, deliberately: that shape is loaded on every app boot
 * for every role, and this answer can only ever be non-null for a workspace
 * that has already left. `enabled` is the caller's for the same reason
 * `useMissedWhileOff` beside it does it — a workspace that is not cancelled,
 * or one that has already waved the offer away, must not pay for the question.
 *
 * The route never returns the free text. `detail` is what somebody wrote about
 * us in their own words, and reading it back to them would be quoting them at
 * themselves; the CODE is all the card needs to pick an answer.
 */
export function useCancellationReason(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "cancellation-reason"],
    queryFn: () =>
      apiFetch<StatedCancellationReason>("/v1/billing/cancellation-reason", {
        companyId,
      }),
    enabled,
  });
}

/**
 * POST /v1/billing/dismiss-winback (#277 follow-up) — "stop showing me this".
 *
 * The grace emails on day 1, 15 and 27 all link to /settings/billing, so the
 * offer is seen on a cadence rather than once, and anything shown three times
 * needs a way to be shown zero times.
 *
 * The server stores a TIMESTAMP compared against `canceled_at`, not a boolean,
 * so the dismissal belongs to one cancellation and a later one brings the offer
 * back without anything having to clear it. The company query is invalidated
 * because `winback_dismissed_at` rides on that shape; the pressing surface
 * hides itself first and does not wait for either.
 */
export function useDismissWinback() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    // 204 No Content: nothing comes back that the caller did not already know.
    mutationFn: () =>
      apiFetch<void>("/v1/billing/dismiss-winback", {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
    },
  });
}

/**
 * GET /v1/billing/pause (#277) — the paid pause, in one answer.
 *
 * A crew that goes quiet for the winter keeps its number and its history, stops
 * texting, and pays a small monthly fee instead of the plan. No 30-day fuse.
 *
 * `eligible` IS THE ONLY THING THAT MAY PUT A PAUSE CONTROL ON SCREEN. The
 * route computes it as `eligibility.eligible && offer !== null`, so a pause we
 * cannot quote — an unset, archived, $0 or tiered Stripe price — reports false
 * and the offer is simply absent. There is no greyed-out state and no "why not"
 * on any surface here: a billing screen that explains our unprovisioned catalog
 * to a customer is noise, and one that explains it on the CANCEL screen is noise
 * standing between somebody and the exit.
 *
 * `monthly_cents` IS THE REAL PRICE, read from Stripe before anybody presses
 * anything, and it is why `reason` is never rendered. Every surface below either
 * has the figure and shows it on the control, or shows nothing at all — nobody
 * agrees to a recurring charge whose amount we did not state.
 *
 * `paused_at` NON-NULL MEANS PAUSED RIGHT NOW, and it is the reason this is a
 * query rather than something read off the company. It is deliberately NOT on
 * `company_view`: that shape loads on every app boot for every role, and this is
 * a billing fact behind `billing.manage`. So `enabled` is the caller's, the same
 * way `useMissedWhileOff` and `usePrepayOffer` beside it are — and it matters
 * more here, because this route round-trips to Stripe twice (the subscription,
 * then the price) on a screen that renders on every visit.
 *
 * Two surfaces share this one query by key: the seasonal answer on the cancel
 * card and the paused state at the top of the billing screen. One request
 * answers both, which is the shape the route was built for.
 */
export interface PauseOffer {
  eligible: boolean;
  /**
   * Why not, when `eligible` is false.
   *
   * Read by nothing on this client, on purpose — see above. Typed because the
   * response carries it and a shape that hides a field is a shape that invites
   * somebody to re-derive it.
   */
  reason: string | null;
  /** ISO. Non-null means paused RIGHT NOW. */
  paused_at: string | null;
  /** The pause fee while paused, the quote while eligible. Null otherwise. */
  monthly_cents: number | null;
  /** What they come back to. The pause never touches `plan`. */
  resume_plan: PlanId | null;
}

export function usePauseOffer(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    // Its own root rather than a segment under `company`, so the routine
    // company invalidations (a plan change, a module toggle, a dismissed
    // win-back) do not each buy two Stripe round trips.
    queryKey: [companyId, "billing-pause"],
    queryFn: () => apiFetch<PauseOffer>("/v1/billing/pause", { companyId }),
    enabled,
  });
}

/** POST /v1/billing/pause — what the route answers once the swap has landed. */
export interface PausedPlan {
  paused_at: string;
  monthly_cents: number | null;
  resume_plan: PlanId | null;
}

/** POST /v1/billing/resume — the plan, re-read after the swap back. */
export interface ResumedPlan {
  plan: PlanId | null;
  paused_at: string | null;
}

/**
 * POST /v1/billing/pause and POST /v1/billing/resume (#277).
 *
 * BOTH ROUTES RE-READ THE DATABASE MIRROR AFTER THE STRIPE SWAP AND 409 IF IT
 * DISAGREES, rather than reporting a success they cannot see. So a caller may
 * trust the response and may never assume the request worked: on a 409 the
 * `ApiError` message is written for the customer ("Your plan hasn't paused yet.
 * If you resumed earlier today, try again tomorrow — you won't be charged twice
 * for pausing.") and is shown as-is.
 *
 * Neither is idempotent-by-accident on our side: the route keys Stripe on the
 * pause being taken or lifted, which is what stops a double proration. Nothing
 * here retries.
 */
export function usePausePlan() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<PausedPlan>("/v1/billing/pause", { method: "POST", companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [companyId, "billing-pause"] });
      queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
    },
  });
}

export function useResumePlan() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<ResumedPlan>("/v1/billing/resume", {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [companyId, "billing-pause"] });
      queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
    },
  });
}

/**
 * POST /v1/billing/change-plan — upgrade prorates now; downgrade applies at
 * period end and is blocked (409) until numbers/seats fit Starter (SPEC §9).
 */
export function useChangePlan() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * #583: a plain plan id still works, and means "no prepaid year involved".
     *
     * The object form carries the acknowledgement. It is a separate flag rather
     * than an inferred one because the server refuses without it BY DESIGN — a
     * prepaid year is only ever ended by somebody who read the amount coming
     * back, and a client that could opt in implicitly would defeat that.
     */
    mutationFn: (input: PlanId | { plan: PlanId; convertPrepaid: boolean }) =>
      apiFetch<ChangePlanResult>("/v1/billing/change-plan", {
        method: "POST",
        companyId,
        body:
          typeof input === "string"
            ? { plan: input }
            : { plan: input.plan, convert_prepaid: input.convertPrepaid },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.usage(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({ queryKey: keys.me });
      // #523: an upgrade RAISES the allowance, and the server reinstates what
      // now fits inside it. Both the held-numbers card and the numbers list are
      // stale the instant that happens — without this the owner pays for Pro
      // and the screen still shows the line they just bought back as on hold.
      queryClient.invalidateQueries({ queryKey: keys.heldNumbers(companyId) });
      queryClient.invalidateQueries({ queryKey: keys.numbers(companyId) });
    },
  });
}
