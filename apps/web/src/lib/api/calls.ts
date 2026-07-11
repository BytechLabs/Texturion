/**
 * #129 Calls feature — the /calls data hook. GET /v1/calls is
 * cursor-paginated on (started_at, id); the server applies the #106
 * number-access deny list, so this hook never filters client-side. Pure
 * display helpers live in lib/format/call.ts (no client import chain).
 *
 * D40 (#133): the cell carries a VERIFIED flag — PUT texts a confirmation
 * code from the business number and only a verified cell can dial
 * (POST /v1/calls refuses otherwise), so the hooks expose the whole
 * save → code → verify flow.
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
import type { Call, CallCell, Page } from "./types";

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
    queryFn: () => apiFetch<CallCell>("/v1/calls/cell", { companyId }),
  });
}

/**
 * D40: saving a NEW (or still-unverified) cell also texts the confirmation
 * code — the response's `code_sent` tells the surface to open its code step.
 */
export function useSetCallCell() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (call_cell_e164: string | null) =>
      apiFetch<CallCell>("/v1/calls/cell", {
        companyId,
        method: "PUT",
        body: { call_cell_e164 },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([companyId, "calls", "cell"], {
        call_cell_e164: data.call_cell_e164,
        verified: data.verified,
      });
    },
  });
}

/** D40: check the texted code; success flips the cached cell to verified. */
export function useVerifyCallCell() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch<CallCell>("/v1/calls/cell/verify", {
        companyId,
        method: "POST",
        body: { code },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([companyId, "calls", "cell"], {
        call_cell_e164: data.call_cell_e164,
        verified: data.verified,
      });
    },
  });
}

/** D38 click-to-call: dial ME first, then bridge to the customer. */
export function useStartCall() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
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
    onSuccess: () => {
      // #133: the pre-created in-flight session should appear in /calls (and
      // the For You Recent-calls section) without a navigation. The broad
      // [companyId, 'calls'] prefix also touches the cell query — harmless.
      void queryClient.invalidateQueries({ queryKey: [companyId, "calls"] });
    },
  });
}
