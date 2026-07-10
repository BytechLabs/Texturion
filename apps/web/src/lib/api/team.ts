import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  AcceptedInvite,
  CreatedInvite,
  Invite,
  Member,
  MyInvite,
  Page,
} from "./types";

/** GET /v1/members — members + roles + profile display names. */
export function useMembers() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.members(companyId),
    queryFn: () => apiFetch<Page<Member>>("/v1/members", { companyId }),
  });
}

/** PATCH /v1/members/:id — { role: 'admin' | 'member' } (owner immutable). */
export function useUpdateMemberRole() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; role: "admin" | "member" }) =>
      apiFetch<Omit<Member, "display_name">>(`/v1/members/${input.memberId}`, {
        method: "PATCH",
        companyId,
        body: { role: input.role },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Page<Member>>(keys.members(companyId), (page) =>
        page
          ? {
              ...page,
              data: page.data.map((m) =>
                m.id === updated.id ? { ...m, role: updated.role } : m,
              ),
            }
          : page,
      );
    },
  });
}

/** DELETE /v1/members/:id — deactivate (frees the seat, never a row delete). */
export function useDeactivateMember() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      apiFetch<void>(`/v1/members/${memberId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: (_void, memberId) => {
      queryClient.setQueryData<Page<Member>>(keys.members(companyId), (page) =>
        page
          ? {
              ...page,
              data: page.data.map((m) =>
                m.id === memberId
                  ? { ...m, deactivated_at: new Date().toISOString() }
                  : m,
              ),
            }
          : page,
      );
    },
  });
}

/** GET /v1/invites — owner/admin. */
export function useInvites() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.invites(companyId),
    queryFn: () => apiFetch<Page<Invite>>("/v1/invites", { companyId }),
  });
}

/**
 * POST /v1/invites — { email, role }; seat limit enforced server-side (409).
 * The response carries `email_sent` (false when the address already has an
 * account) so the caller can prompt the inviter to share the accept link.
 */
export function useCreateInvite() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: "admin" | "member" }) =>
      apiFetch<CreatedInvite>("/v1/invites", {
        method: "POST",
        companyId,
        body: input,
      }),
    onSuccess: (invite) => {
      queryClient.setQueryData<Page<Invite>>(keys.invites(companyId), (page) =>
        page ? { ...page, data: [invite, ...page.data] } : page,
      );
    },
  });
}

/** DELETE /v1/invites/:id — revoke a pending invite. */
export function useRevokeInvite() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      apiFetch<void>(`/v1/invites/${inviteId}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: (_void, inviteId) => {
      queryClient.setQueryData<Page<Invite>>(keys.invites(companyId), (page) =>
        page
          ? {
              ...page,
              data: page.data.map((i) =>
                i.id === inviteId
                  ? { ...i, revoked_at: new Date().toISOString() }
                  : i,
              ),
            }
          : page,
      );
    },
  });
}

/**
 * GET /v1/invites/mine — company-exempt (#109): the caller's own PENDING
 * invites across all companies, matched server-side on their confirmed email.
 * Powers the in-app "you've been invited — Join" banner.
 */
export function useMyInvites() {
  return useQuery({
    queryKey: keys.myInvites,
    queryFn: () => apiFetch<{ data: MyInvite[] }>("/v1/invites/mine"),
    // The banner is ambient — a gentle refetch cadence, no realtime needed.
    staleTime: 60_000,
  });
}

/**
 * POST /v1/invites/accept — company-exempt (the caller is not a member yet).
 * Used by /invite/[token]; the caller refreshes /v1/me and activates the new
 * company on success.
 */
export function acceptInvite(inviteId: string): Promise<AcceptedInvite> {
  return apiFetch<AcceptedInvite>("/v1/invites/accept", {
    method: "POST",
    body: { invite_id: inviteId },
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.me });
      // #109: the banner's pending set changed too.
      queryClient.invalidateQueries({ queryKey: keys.myInvites });
    },
  });
}
