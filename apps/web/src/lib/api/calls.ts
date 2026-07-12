/**
 * #129 Calls feature — the /calls data hook. GET /v1/calls is
 * cursor-paginated on (started_at, id); the server applies the #106
 * number-access deny list, so this hook never filters client-side. Pure
 * display helpers live in lib/format/call.ts (no client import chain).
 *
 * D43: the cell bridge + verification hooks are DELETED — the browser is
 * the phone (softphone provider); these hooks are the data plane only.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
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

/** D43 (#135): what the softphone needs to place a browser call — the number
 *  to present, the number to dial, and the leg tag Telnyx echoes on webhooks. */
export interface BrowserCallAuth {
  from: string;
  to: string;
  client_state: string;
}

/**
 * D43: authorize a browser-placed call. The server runs the outbound gates +
 * line-busy guard and returns the origination parameters; the softphone then
 * dials via the WebRTC SDK. Never dials server-side.
 */
export function useAuthorizeBrowserCall() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<BrowserCallAuth>("/v1/calls/browser", {
        companyId,
        method: "POST",
        body: { conversation_id: conversationId },
      }),
  });
}

/** D43: mint a short-lived WebRTC login token for this member's softphone. */
export function useWebrtcToken() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ token: string; sip_username: string; expires_in_hours: number }>(
        "/v1/webrtc/token",
        { companyId, method: "POST", body: {} },
      ),
  });
}

/**
 * D43: fetch a voicemail's signed playback URL on demand (the player mounts
 * it into an <audio>). Signed for an hour; the query cache mirrors that.
 */
export function useVoicemailUrl(callSessionId: string, enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "calls", "voicemail", callSessionId] as const,
    queryFn: () =>
      apiFetch<{ url: string; seconds: number }>(
        `/v1/calls/${encodeURIComponent(callSessionId)}/voicemail`,
        { companyId },
      ),
    enabled,
    staleTime: 50 * 60_000, // just under the URL's 60-min signature
    retry: false,
  });
}
