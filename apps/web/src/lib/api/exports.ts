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

/**
 * POST /v1/exports/history (#304) — one customer's messages, as a document.
 *
 * A different endpoint rather than a flag on the one above, because it is a
 * different act: the workspace dump answers a legal right and this answers an
 * adjuster. They share a queue and a bucket, which is where sharing belongs.
 *
 * Both dates are optional, and empty means the whole history — the API's own
 * contract, so a caller that wants everything sends nothing rather than
 * working out a range that covers it.
 */
export function useExportContactHistory(contactId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (range: { from?: string; to?: string }) =>
      apiFetch<{ export_id: string; already_building: boolean }>(
        "/v1/exports/history",
        {
          method: "POST",
          companyId,
          body: { contact_id: contactId, ...range },
        },
      ),
    onSuccess: () => {
      // It lands on the same list the workspace dump does, so the settings
      // screen shows it without knowing this endpoint exists.
      void queryClient.invalidateQueries({ queryKey: [companyId, "exports"] });
    },
  });
}

/**
 * #304 — the bookkeeper's usage export.
 *
 * `from` is required, unlike the history export where an absent range means
 * "everything". A period is what a bookkeeper works in, and a usage document
 * with no stated period is not one.
 */
export function useExportUsage() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (range: { from: string; to?: string }) =>
      apiFetch<{ export_id: string; already_building: boolean }>(
        "/v1/exports/usage",
        { method: "POST", companyId, body: range },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [companyId, "exports"] });
    },
  });
}
