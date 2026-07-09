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

/**
 * POST /v1/billing/confirm-checkout — activate the subscription off the session
 * id Stripe returns to the success_url, without waiting on the webhook. Returns
 * `{ confirmed }`; idempotent server-side. Used by the setting-up screen so a
 * just-paid company flips active immediately (and, in local dev without
 * `stripe listen`, at all).
 */
export function useConfirmCheckout() {
  return useMutation({
    mutationFn: (input: { companyId: string; sessionId: string }) =>
      apiFetch<{ confirmed: boolean }>("/v1/billing/confirm-checkout", {
        method: "POST",
        companyId: input.companyId,
        body: { sessionId: input.sessionId },
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

/**
 * PATCH /v1/company for an explicit company id (onboarding runs outside the
 * CompanyProvider). Powers the plan step's "edit until checkout" summary: change
 * the workspace name and pending area code before payment. The area-code change
 * is validated + gated to pre-checkout server-side (routes/companies.ts).
 */
export function useOnboardingUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      companyId,
      ...patch
    }: {
      companyId: string;
      name?: string;
      requested_area_code?: string;
      country?: "US" | "CA";
      us_texting_enabled?: boolean;
    }) =>
      apiFetch<Omit<CompanyView, "numbers" | "registration">>("/v1/company", {
        method: "PATCH",
        companyId,
        body: patch,
      }),
    onSuccess: (_updated, { companyId }) => {
      // The wizard summary reads GET /v1/company; the sidebar/name reads /me. A
      // country / US-texting change flips whether US registration is owed, so
      // the wizard must re-route — refetch registration too.
      queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
      queryClient.invalidateQueries({ queryKey: keys.registration(companyId) });
      queryClient.invalidateQueries({ queryKey: keys.me });
    },
  });
}
