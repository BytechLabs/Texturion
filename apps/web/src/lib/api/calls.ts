/**
 * #129 Calls feature — the /calls data hook. GET /v1/calls is
 * cursor-paginated on (started_at, id); the server applies the #106
 * number-access deny list, so this hook never filters client-side. Pure
 * display helpers live in lib/format/call.ts (no client import chain).
 */
import { useInfiniteQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import { nextCursorParam } from "./pagination";
import type { Call, Page } from "./types";

export type CallOutcomeFilter = "missed" | "answered" | "voicemail";

export function useCalls(outcome?: CallOutcomeFilter) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: keys.calls(companyId, outcome ?? "all"),
    queryFn: ({ pageParam }) =>
      apiFetch<Page<Call>>("/v1/calls", {
        companyId,
        searchParams: { cursor: pageParam, outcome },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursorParam,
  });
}
