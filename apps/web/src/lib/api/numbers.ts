import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { Page, PhoneNumberSummary } from "./types";

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
 * POST /v1/numbers/provision — Pro's 2nd number (owner/admin). Requires a
 * client-UUID Idempotency-Key (SPEC §7); the same key replays the same row.
 */
export function useProvisionNumber() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestedAreaCode: string) =>
      apiFetch<PhoneNumberSummary>("/v1/numbers/provision", {
        method: "POST",
        companyId,
        idempotencyKey: crypto.randomUUID(),
        body: { requested_area_code: requestedAreaCode },
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
