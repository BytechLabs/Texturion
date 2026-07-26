import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import type { DataExport, Page } from "./types";

/**
 * GET /v1/exports (#227) — recent exports with fresh download links.
 *
 * Polled while one is building, because the work happens on a cron and there
 * is no push channel for it. Stops polling the moment nothing is in flight:
 * a settings page that keeps asking forever is a cost with no reader.
 */
export function useDataExports() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "exports"] as const,
    queryFn: () => apiFetch<Page<DataExport>>("/v1/exports", { companyId }),
    refetchInterval: (query) => {
      const building = query.state.data?.data.some(
        (row) => row.status === "pending" || row.status === "running",
      );
      return building ? 15_000 : false;
    },
  });
}

/** POST /v1/exports (#227) — enqueue one. Admin only; the server enforces it. */
export function useRequestDataExport() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ export_id: string; already_building: boolean }>("/v1/exports", {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [companyId, "exports"] });
    },
  });
}
