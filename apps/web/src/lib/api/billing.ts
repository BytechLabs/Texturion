import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { ChangePlanResult, HostedUrl, PlanId } from "./types";

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
