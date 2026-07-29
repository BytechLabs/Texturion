import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { Page } from "./types";

/**
 * #236 — signed-in devices.
 *
 * The self routes are company-exempt on purpose (a session belongs to the
 * person, not to one of their workspaces), so they carry no company id and
 * their query keys sit outside the per-company namespace.
 */

export type SessionClient = "web" | "android" | "ios" | "unknown";

export interface DeviceSession {
  id: string;
  client: SessionClient;
  user_agent: string | null;
  /** "Toronto, Ontario, CA" — approximate, and absent rather than partial. */
  location: string | null;
  signed_in_at: string;
  last_active_at: string;
  /** The device making this very request. */
  current: boolean;
}

/** The workspace view is narrower: no user agent, and a member instead of you. */
export interface WorkspaceSession {
  id: string;
  member_id: string | null;
  client: SessionClient;
  location: string | null;
  signed_in_at: string;
  last_active_at: string;
}

export interface RevokeResult {
  sessions: number;
  devices: number;
}

/** GET /v1/sessions — your own devices. */
export function useMySessions() {
  return useQuery({
    queryKey: keys.mySessions,
    queryFn: () => apiFetch<Page<DeviceSession>>("/v1/sessions"),
    // A security screen that shows a five-minute-old answer is worse than no
    // screen: somebody checking whether a phone is still signed in is asking
    // about right now.
    staleTime: 0,
  });
}

/**
 * POST /v1/sessions/revoke — sign out one device, or everywhere else.
 *
 * Both invalidate the workspace list too: an owner clearing their own devices
 * from the crew screen must not have to reload to see it happen.
 */
export function useRevokeMySession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sessionId: string } | { others: true }) =>
      apiFetch<RevokeResult>("/v1/sessions/revoke", {
        method: "POST",
        body:
          "sessionId" in input
            ? { session_id: input.sessionId }
            : { others: true },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.mySessions });
      void queryClient.invalidateQueries({ queryKey: ["workspace-sessions"] });
    },
  });
}

/** GET /v1/members/sessions — the whole crew's devices (admin and owner). */
export function useWorkspaceSessions(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.workspaceSessions(companyId),
    enabled,
    staleTime: 0,
    queryFn: () =>
      apiFetch<Page<WorkspaceSession>>("/v1/members/sessions", { companyId }),
  });
}

/** POST /v1/members/:id/sessions/revoke — sign a member out everywhere. */
export function useRevokeMemberSessions() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      apiFetch<RevokeResult>(`/v1/members/${memberId}/sessions/revoke`, {
        method: "POST",
        companyId,
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.workspaceSessions(companyId),
      });
      void queryClient.invalidateQueries({ queryKey: keys.mySessions });
    },
  });
}
