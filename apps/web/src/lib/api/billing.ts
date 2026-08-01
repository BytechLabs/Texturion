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
  months: number;
  /** The year already running, when there is one. */
  open: { plan: PlanId; amount_cents: number; granted_through: string } | null;
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
 * POST /v1/billing/change-plan — upgrade prorates now; downgrade applies at
 * period end and is blocked (409) until numbers/seats fit Starter (SPEC §9).
 */
export function useChangePlan() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (plan: PlanId) =>
      apiFetch<ChangePlanResult>("/v1/billing/change-plan", {
        method: "POST",
        companyId,
        body: { plan },
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
    },
  });
}
