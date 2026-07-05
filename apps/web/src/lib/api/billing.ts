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
