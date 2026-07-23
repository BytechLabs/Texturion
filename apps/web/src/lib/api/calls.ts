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

/**
 * #205: one contact's call history — GET /v1/calls?contact_id=<uuid>. The
 * server composes the contact filter with the #106 number-access deny list
 * and the same (started_at, id) keyset cursor, so this hook never filters
 * client-side either. Keyed under the [companyId, "calls"] prefix so the
 * realtime call-change invalidation refreshes it exactly like the /calls log.
 */
export function useContactCalls(contactId: string) {
  const companyId = useCompanyId();
  return useInfiniteQuery({
    queryKey: [companyId, "calls", "contact", contactId] as const,
    queryFn: ({ pageParam }) =>
      apiFetch<Page<Call>>("/v1/calls", {
        companyId,
        searchParams: { cursor: pageParam, contact_id: contactId },
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
/** A browser call can start from a thread, a contact (no thread yet), or a raw
 *  number (the dialer). Exactly one origin is set; phone_number_id optionally
 *  picks the caller-ID number when the company owns several. */
export interface BrowserCallRequest {
  conversation_id?: string;
  contact_id?: string;
  to?: string;
  phone_number_id?: string;
}

export function useAuthorizeBrowserCall() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (request: BrowserCallRequest) =>
      apiFetch<BrowserCallAuth>("/v1/calls/browser", {
        companyId,
        method: "POST",
        body: request,
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
 * D43: resolve a member RING leg's call_control_id to the CUSTOMER inbound
 * session id. An answered inbound call's SDK session is the ring leg's own
 * session (the engine Dials without link_to), not the customer session the
 * calls row + all live-call ops key on — the softphone resolves it here.
 */
export function useResolveLiveSession() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (legCcid: string) =>
      apiFetch<{ call_session_id: string }>(
        `/v1/calls/live/by-leg/${encodeURIComponent(legCcid)}`,
        { companyId },
      ),
  });
}

/**
 * D43 push-to-wake (#135): after opening the app from an incoming-call push,
 * ask the server to (re-)ring this member's now-awake browser for the still-live
 * call, so the ringing call surfaces and can be answered.
 *
 * #170 CALLS-V3 §8.5.2/§6: v3 clients ALWAYS send `no_local_leg: true` — the
 * §10.1.3 rule makes calling ring-me at all the attestation "no live leg is
 * presenting this session on this device", which is what licenses the server
 * to dial a fresh leg. The ONE call site (CallsView's push-tap effect) guards
 * that rule before firing. Response fields are additive (§8.3) and currently
 * unread; the old "not ringing anymore" 409 is now a 200 `{rang:false}`.
 */
export function useRingMe() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<{ ok: boolean; rang?: boolean; state?: string; reason?: string }>(
        `/v1/calls/live/${encodeURIComponent(sessionId)}/ring-me`,
        { companyId, method: "POST", body: { no_local_leg: true } },
      ),
  });
}

/** D43 phase 3: the live call's server-side facts (notes link). */
export function useLiveCall(sessionId: string | null) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "calls", "live", sessionId] as const,
    queryFn: () =>
      apiFetch<{ conversation_id: string | null; caller_e164: string | null }>(
        `/v1/calls/live/${encodeURIComponent(sessionId ?? "")}`,
        { companyId },
      ),
    enabled: sessionId !== null,
    // The conversation link appears once answer-time threading lands — a
    // couple of quick retries beat a dead "Open conversation" affordance.
    retry: 2,
    staleTime: 30_000,
  });
}

/** D43 phase 3: who can take this call (credentialed, #106-cleared, busy flag). */
export function useTransferTargets(sessionId: string | null, enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [companyId, "calls", "targets", sessionId] as const,
    queryFn: () =>
      apiFetch<{ targets: { user_id: string; busy: boolean }[] }>(
        `/v1/calls/live/${encodeURIComponent(sessionId ?? "")}/targets`,
        { companyId },
      ),
    enabled: enabled && sessionId !== null,
    staleTime: 10_000,
  });
}

/** D43 phase 3: blind transfer — the customer re-rings at the target. */
export function useTransferCall() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (input: { sessionId: string; targetUserId: string }) =>
      apiFetch<{ status: string }>(
        `/v1/calls/live/${encodeURIComponent(input.sessionId)}/transfer`,
        {
          companyId,
          method: "POST",
          body: { target_user_id: input.targetUserId },
        },
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
