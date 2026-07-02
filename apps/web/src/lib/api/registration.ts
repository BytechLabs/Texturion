import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  EnableUsResult,
  RegistrationState,
  RegistrationSubmitResult,
} from "./types";

/** GET /v1/registration — brand + campaign rows (wizard data for O/A only). */
export function useRegistration() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.registration(companyId),
    queryFn: () =>
      apiFetch<RegistrationState>("/v1/registration", { companyId }),
  });
}

/**
 * PUT /v1/registration — save wizard drafts (brand and/or campaign data,
 * SPEC §4.1 step 3). Editable only in draft/rejected states (409 otherwise).
 */
export function useSaveRegistration() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      brand?: Record<string, unknown>;
      campaign?: Record<string, unknown>;
    }) =>
      apiFetch<RegistrationState>("/v1/registration", {
        method: "PUT",
        companyId,
        body: input,
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(keys.registration(companyId), state);
    },
  });
}

/** POST /v1/registration/submit — recovery / fix-and-resubmit (SPEC §4.4 R4). */
export function useSubmitRegistration() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<RegistrationSubmitResult>("/v1/registration/submit", {
        method: "POST",
        companyId,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData<RegistrationState>(
        keys.registration(companyId),
        { brand: result.brand, campaign: result.campaign },
      );
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/registration/otp — sole-prop 6-digit code (422 on wrong/expired). */
export function useVerifyRegistrationOtp() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch<RegistrationState>("/v1/registration/otp", {
        method: "POST",
        companyId,
        body: { code },
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(keys.registration(companyId), state);
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** POST /v1/registration/otp/resend — fresh PIN, new 24 h window (§4.2). */
export function useResendRegistrationOtp() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true }>("/v1/registration/otp/resend", {
        method: "POST",
        companyId,
      }),
  });
}

/**
 * POST /v1/registration/enable-us — owner-only, CA companies (SPEC §4.2):
 * $29 one-off invoice (or immediate submission when the fee was ever paid).
 */
export function useEnableUsTexting() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<EnableUsResult>("/v1/registration/enable-us", {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.registration(companyId),
        refetchType: "active",
      });
    },
  });
}
