"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { CompanyAiSettings } from "./types";

/** GET /v1/company/ai-settings — per-company enrichment opt-in (#214). */
export function useAiSettings() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.aiSettings(companyId),
    queryFn: () =>
      apiFetch<CompanyAiSettings>("/v1/company/ai-settings", { companyId }),
  });
}

/** PATCH /v1/company/ai-settings — admin-only; optimistic toggle flip. */
export function useUpdateAiSettings() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: CompanyAiSettings) =>
      apiFetch<CompanyAiSettings>("/v1/company/ai-settings", {
        method: "PATCH",
        companyId,
        body: settings,
      }),
    onMutate: async (settings) => {
      const key = keys.aiSettings(companyId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CompanyAiSettings>(key);
      queryClient.setQueryData(key, settings);
      return { previous };
    },
    onError: (_error, _settings, context) => {
      if (context?.previous) {
        queryClient.setQueryData(keys.aiSettings(companyId), context.previous);
      }
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(keys.aiSettings(companyId), settings);
    },
  });
}

// The enrichment call + its session cache live in ./task-enrichment (a leaf
// module with no provider imports) so they stay unit-testable in isolation.
export { enrichTaskFromMessage } from "./task-enrichment";
