import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  CompanyView,
  HostedUrl,
  PlanId,
  PlanModule,
  RegistrationState,
} from "./types";

/**
 * Onboarding-scoped hooks (new file — foundation lib/api files are
 * read-only). The /onboarding wizard runs OUTSIDE the (app) CompanyProvider
 * (the provider needs a membership to exist), so these variants take the
 * company id explicitly instead of reading it from context. They reuse the
 * foundation query keys so the cache is shared with the in-app hooks.
 */

/** GET /v1/company for an explicit company id (null = not created yet). */
export function useOnboardingCompany(companyId: string | null) {
  return useQuery({
    queryKey: keys.company(companyId ?? "none"),
    queryFn: () =>
      apiFetch<CompanyView>("/v1/company", { companyId: companyId as string }),
    enabled: companyId !== null,
  });
}

/** GET /v1/registration for an explicit company id. */
export function useOnboardingRegistration(companyId: string | null) {
  return useQuery({
    queryKey: keys.registration(companyId ?? "none"),
    queryFn: () =>
      apiFetch<RegistrationState>("/v1/registration", {
        companyId: companyId as string,
      }),
    enabled: companyId !== null,
  });
}

/** PUT /v1/registration — save brand and/or campaign wizard drafts (§4.1 step 3). */
export function useSaveOnboardingRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      companyId: string;
      brand?: Record<string, unknown>;
      campaign?: Record<string, unknown>;
    }) =>
      apiFetch<RegistrationState>("/v1/registration", {
        method: "PUT",
        companyId: input.companyId,
        body: {
          ...(input.brand ? { brand: input.brand } : {}),
          ...(input.campaign ? { campaign: input.campaign } : {}),
        },
      }),
    onSuccess: (state, { companyId }) => {
      queryClient.setQueryData(keys.registration(companyId), state);
    },
  });
}

/** POST /v1/billing/checkout — { plan, modules? } → hosted Stripe Checkout URL. */
export function useOnboardingCheckout() {
  return useMutation({
    mutationFn: (input: {
      companyId: string;
      plan: PlanId;
      modules?: PlanModule[];
    }) =>
      apiFetch<HostedUrl>("/v1/billing/checkout", {
        method: "POST",
        companyId: input.companyId,
        body: {
          plan: input.plan,
          ...(input.modules && input.modules.length > 0
            ? { modules: input.modules }
            : {}),
        },
      }),
  });
}

/** POST /v1/registration/otp — sole-prop 6-digit code (422 wrong/expired). */
export function useOnboardingVerifyOtp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { companyId: string; code: string }) =>
      apiFetch<RegistrationState>("/v1/registration/otp", {
        method: "POST",
        companyId: input.companyId,
        body: { code: input.code },
      }),
    onSuccess: (state, { companyId }) => {
      queryClient.setQueryData(keys.registration(companyId), state);
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/registration/otp/resend — fresh PIN, new 24 h window (§4.2). */
export function useOnboardingResendOtp() {
  return useMutation({
    mutationFn: (input: { companyId: string }) =>
      apiFetch<{ ok: true }>("/v1/registration/otp/resend", {
        method: "POST",
        companyId: input.companyId,
      }),
  });
}
