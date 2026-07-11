/**
 * #129 Calls feature — the /calls data hook. GET /v1/calls is
 * cursor-paginated on (started_at, id); the server applies the #106
 * number-access deny list, so this hook never filters client-side. Pure
 * display helpers live in lib/format/call.ts (no client import chain).
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

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

/** D38: the member's OWN cell the outbound bridge rings first. */
export function useCallCell() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "calls", "cell"] as const,
    queryFn: () =>
      apiFetch<{ call_cell_e164: string | null }>("/v1/calls/cell", {
        companyId,
      }),
  });
}

export function useSetCallCell() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (call_cell_e164: string | null) =>
      apiFetch<{ call_cell_e164: string | null }>("/v1/calls/cell", {
        companyId,
        method: "PUT",
        body: { call_cell_e164 },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([companyId, "calls", "cell"], data);
    },
  });
}

/** D38 click-to-call: dial ME first, then bridge to the customer. */
export function useStartCall() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<{ status: string; call_session_id: string | null }>(
        "/v1/calls",
        {
          companyId,
          method: "POST",
          body: { conversation_id: conversationId },
        },
      ),
  });
}
