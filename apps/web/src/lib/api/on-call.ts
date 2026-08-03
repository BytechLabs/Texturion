"use client";

/**
 * #244 — the rota, and claiming an alert.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "./client";
import { keys } from "./keys";
import { useCompanyId } from "@/lib/company/provider";

export interface OnCallShift {
  id: string;
  user_id: string;
  /** Null = the whole workspace, which is what a one-number crew means. */
  phone_number_id: string | null;
  starts_at: string;
  ends_at: string;
  created_by: string | null;
}

export function useOnCallShifts() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.onCall(companyId),
    queryFn: () =>
      apiFetch<{ data: OnCallShift[] }>("/v1/on-call", { companyId }).then(
        (response: { data: OnCallShift[] }) => response.data,
      ),
  });
}

export function useCreateOnCallShift() {
  const companyId = useCompanyId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      user_id: string;
      starts_at: string;
      ends_at: string;
      phone_number_id?: string | null;
    }) =>
      apiFetch<{ data: OnCallShift }>("/v1/on-call", {
        companyId,
        method: "POST",
        body,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: keys.onCall(companyId) }),
  });
}

export function useEndOnCallShift() {
  const companyId = useCompanyId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`/v1/on-call/${id}`, { companyId, method: "DELETE" }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: keys.onCall(companyId) }),
  });
}
