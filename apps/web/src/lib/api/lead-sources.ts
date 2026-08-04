/**
 * #301 — the workspace's own list of where customers come from.
 *
 * Owner-defined rather than a fixed taxonomy: "Neighbour" matters to a plumber
 * and "Trade counter" to an electrician, and a list we chose would be wrong for
 * both. Same argument #298 settled about tags — suggest, never impose — so a
 * workspace starts empty and nothing is seeded.
 *
 * Archived, never deleted. A source is the axis of a report about the past, and
 * removing one would erase where existing customers came from.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";

export interface LeadSource {
  id: string;
  name: string;
  /** Non-null once retired: gone from the pickers, kept in the record. */
  archived_at: string | null;
  created_at: string;
}

const keys = {
  all: (companyId: string) => ["lead-sources", companyId] as const,
};

/** GET /v1/lead-sources — everything, archived included. */
export function useLeadSources(enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.all(companyId),
    queryFn: () =>
      apiFetch<{ data: LeadSource[] }>("/v1/lead-sources", { companyId }),
    enabled,
  });
}

/** The ones a picker may offer. Archiving is how the list shrinks. */
export function activeSources(sources: LeadSource[] | undefined): LeadSource[] {
  return (sources ?? []).filter((source) => source.archived_at === null);
}

export function useCreateLeadSource() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<LeadSource>("/v1/lead-sources", {
        method: "POST",
        companyId,
        body: { name },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.all(companyId) });
    },
  });
}

export interface UpdateLeadSourceInput {
  id: string;
  name?: string;
  archived?: boolean;
}

export function useUpdateLeadSource() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateLeadSourceInput) =>
      apiFetch<LeadSource>(`/v1/lead-sources/${id}`, {
        method: "PATCH",
        companyId,
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.all(companyId) });
      // A rename changes what every report row is called, and a number's
      // picker shows the name too.
      void queryClient.invalidateQueries({ queryKey: ["number-identity"] });
    },
  });
}
