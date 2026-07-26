import { useInfiniteQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { nextCursorParam } from "./pagination";
import type { AuditEntry, Page } from "./types";

export interface AuditLogFilters {
  /** A member's user id, or undefined for everyone. */
  actor?: string;
  /** One action key, or undefined for all of them. */
  action?: string;
  /** ISO instants bounding the window. */
  since?: string;
  until?: string;
}

/**
 * GET /v1/audit-log (#231) — the workspace's history of privileged changes.
 * Owner/admin only; the server enforces that, and a member's request 403s.
 */
export function useAuditLog(filters: AuditLogFilters = {}) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: [companyId, "audit-log", filters] as const,
    queryFn: ({ pageParam }) =>
      apiFetch<Page<AuditEntry>>("/v1/audit-log", {
        companyId,
        searchParams: { cursor: pageParam, ...filters },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
  });
}
