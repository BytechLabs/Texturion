import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  AvailableNumbersResult,
  NumberAccess,
  Page,
  PhoneNumberSummary,
} from "./types";

/** GET /v1/numbers — number cards with status (G8 Numbers). */
export function useNumbers() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.numbers(companyId),
    queryFn: () =>
      apiFetch<Page<PhoneNumberSummary>>("/v1/numbers", { companyId }),
  });
}

/**
 * GET /v1/available-numbers — the number-picker feed (choose-your-number).
 * Company-EXEMPT (no X-Company-Id): the US onboarding number step runs before
 * the company exists. Fires immediately with a broad country-wide search; an
 * area code, when set, is just an optional narrowing filter (#86), not a
 * precondition. `staleTime: 0` and the returned `refetch` back the picker's
 * Refresh button (Telnyx inventory rotates). `bestEffort` is the user's "show
 * nearby numbers" toggle.
 */
export function useAvailableNumbers(params: {
  country: "US" | "CA";
  areaCode: string | null;
  bestEffort: boolean;
}) {
  return useQuery({
    queryKey: keys.availableNumbers(
      params.country,
      params.areaCode,
      params.bestEffort,
    ),
    queryFn: () =>
      apiFetch<AvailableNumbersResult>("/v1/available-numbers", {
        searchParams: {
          country: params.country,
          area_code: params.areaCode ?? undefined,
          best_effort: params.bestEffort ? "true" : undefined,
          // Fetch a fuller batch — the picker filters it client-side by digits
          // (Telnyx's own digit filters are silently ignored on this endpoint).
          limit: 50,
        },
      }),
    staleTime: 0,
  });
}

/**
 * POST /v1/numbers/provision — Pro's 2nd number (owner/admin). Requires a
 * client-UUID Idempotency-Key (SPEC §7); the same key replays the same row.
 * The user picks a specific number first (issue #75): a full E.164 is ordered
 * exactly; a bare area code (masked/CA) assigns a number in that code.
 */
export function useProvisionNumber() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      chosen_number_e164?: string;
      requested_area_code?: string;
    }) =>
      apiFetch<PhoneNumberSummary>("/v1/numbers/provision", {
        method: "POST",
        companyId,
        idempotencyKey: crypto.randomUUID(),
        body,
      }),
    onSuccess: (number) => {
      queryClient.setQueryData<Page<PhoneNumberSummary>>(
        keys.numbers(companyId),
        (page) =>
          page && !page.data.some((n) => n.id === number.id)
            ? { ...page, data: [...page.data, number] }
            : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/**
 * POST /v1/numbers/:id/remediate — owner/admin: finish a provision_failed number
 * on the EXISTING paid row (choose a number and/or a new area code, or just
 * retry). No Idempotency-Key / slot claim — it never re-charges. Patches the
 * numbers cache + refreshes the company view.
 */
export function useRemediateNumber(numberId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      requested_area_code?: string;
      chosen_number_e164?: string;
    }) =>
      apiFetch<PhoneNumberSummary>(`/v1/numbers/${numberId}/remediate`, {
        method: "POST",
        companyId,
        body,
      }),
    onSuccess: (number) => {
      queryClient.setQueryData<Page<PhoneNumberSummary>>(
        keys.numbers(companyId),
        (page) =>
          page
            ? {
                ...page,
                data: page.data.map((n) => (n.id === number.id ? number : n)),
              }
            : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/**
 * DELETE /v1/numbers/:id — owner only, type-to-confirm in the UI (G8);
 * needed pre-downgrade, never automatic (SPEC §7).
 */
export function useReleaseNumber() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (numberId: string) =>
      apiFetch<PhoneNumberSummary>(`/v1/numbers/${numberId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: (released) => {
      queryClient.setQueryData<Page<PhoneNumberSummary>>(
        keys.numbers(companyId),
        (page) =>
          page
            ? {
                ...page,
                data: page.data.map((n) =>
                  n.id === released.id ? released : n,
                ),
              }
            : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** #106: the number's access shape (GET /v1/numbers/:id/access, O/A). */
export function useNumberAccess(numberId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.numberAccess(companyId, numberId),
    queryFn: () =>
      apiFetch<NumberAccess>(`/v1/numbers/${numberId}/access`, { companyId }),
    enabled,
  });
}

/** #106: replace the number's access rules (PUT, O/A). */
export function useSetNumberAccess(numberId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (access: NumberAccess) =>
      apiFetch<NumberAccess>(`/v1/numbers/${numberId}/access`, {
        method: "PUT",
        companyId,
        body: access,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.numberAccess(companyId, numberId), saved);
      // A tightened rule changes what the inbox may list for teammates; the
      // caller's own view refreshes lazily (owners/admins are unrestricted).
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
    },
  });
}
