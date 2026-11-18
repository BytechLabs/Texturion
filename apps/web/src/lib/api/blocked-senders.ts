import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

export interface BlockedSender {
  id: string;
  phone_e164: string;
  reason: string | null;
  blocked_by: string | null;
  created_at: string;
}

/** GET /v1/blocked-senders — the numbers this workspace sends straight to spam. */
export function useBlockedSenders(phone?: string) {
  const companyId = useCompanyId();
  const listKey = keys.blockedSenders(companyId);
  return useQuery({
    queryKey: phone ? [...listKey, phone] : listKey,
    queryFn: () =>
      apiFetch<{ data: BlockedSender[] }>("/v1/blocked-senders", {
        companyId,
        searchParams: { phone_digits: phone?.slice(1) },
      }),
    staleTime: 5 * 60_000,
  });
}

/** POST /v1/blocked-senders — idempotent, so a double tap is harmless. */
export function useBlockSender() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phone_e164: string) =>
      apiFetch<BlockedSender>("/v1/blocked-senders", {
        companyId,
        method: "POST",
        body: { phone_e164 },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.blockedSenders(companyId) }),
  });
}

/** DELETE /v1/blocked-senders/:id — later texts and calls arrive normally again. */
export function useUnblockSender() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/v1/blocked-senders/${id}`, { companyId, method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.blockedSenders(companyId) }),
  });
}
