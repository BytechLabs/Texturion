import { useQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { SearchResult } from "./types";

export function fetchSearch(
  companyId: string,
  q: string,
  cursor?: string,
): Promise<SearchResult> {
  return apiFetch<SearchResult>("/v1/search", {
    companyId,
    searchParams: { q, cursor },
  });
}

/**
 * GET /v1/search — messages FTS grouped by conversation + trgm contacts
 * (SPEC §6/§7). Fires at ≥2 characters (G4); callers debounce the input
 * (250 ms) before the query key changes.
 */
export function useSearch(q: string) {
  const companyId = useCompanyId();
  const trimmed = q.trim();
  return useQuery({
    queryKey: keys.search(companyId, trimmed),
    queryFn: () => fetchSearch(companyId, trimmed),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
    placeholderData: (previous) => previous, // keep results while typing
  });
}
