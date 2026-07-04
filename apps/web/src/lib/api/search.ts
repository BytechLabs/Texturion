import { useQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import { normalizeSearch } from "./search-normalize";
import type { SearchResult } from "./types";

export function fetchSearch(
  companyId: string,
  q: string,
  cursor?: string,
): Promise<SearchResult> {
  return apiFetch<SearchResult>("/v1/search", {
    companyId,
    searchParams: { q, cursor },
  }).then(normalizeSearch);
}

/**
 * GET /v1/search — the full D29 palette: messages FTS grouped by conversation
 * (note hits carry `direction` so they're labelable), trgm contacts, tasks,
 * note-borne attachments, and templates (SPEC §6/§7). Fires at ≥2 characters
 * (G4); callers debounce the input (250 ms) before the query key changes.
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
