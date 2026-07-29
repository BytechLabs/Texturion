import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

/**
 * #332 — handing the workspace over.
 *
 * Everything about who-may-do-what is decided server-side and arrives as
 * booleans. That is deliberate: three clients each re-deriving `can_claim`
 * from a pile of ids is three chances to show somebody a button that takes a
 * business.
 */

export interface PendingHandover {
  kind: "offer" | "claim";
  to_member_id: string | null;
  ripens_at: string;
  expires_at: string;
  created_at: string;
  /** The caller is the person it is addressed to. */
  mine: boolean;
  /** The waiting period is over (an offer is ready immediately). */
  ready: boolean;
}

export interface Ownership {
  owner_member_id: string | null;
  backup_member_id: string | null;
  i_am_backup: boolean;
  i_am_owner: boolean;
  pending: PendingHandover | null;
  can_offer: boolean;
  can_claim: boolean;
  can_cancel: boolean;
}

export function useOwnership() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.ownership(companyId),
    queryFn: () => apiFetch<Ownership>("/v1/company/ownership", { companyId }),
  });
}

type OwnershipAction =
  | { action: "backup"; memberId: string | null }
  | { action: "offer"; memberId: string }
  | { action: "claim" }
  | { action: "accept" }
  | { action: "cancel" };

/**
 * One mutation for all five, because every one of them returns the same
 * refreshed state and every one of them changes the same card. Splitting them
 * would mean five near-identical hooks and five chances to forget an
 * invalidation.
 */
export function useOwnershipAction() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OwnershipAction) => {
      const path =
        input.action === "backup"
          ? "/v1/company/ownership/backup"
          : `/v1/company/ownership/${input.action}`;
      const body =
        input.action === "backup"
          ? { member_id: input.memberId }
          : input.action === "offer"
            ? { member_id: input.memberId }
            : {};
      return apiFetch<Ownership>(path, { method: "POST", companyId, body });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(keys.ownership(companyId), next);
      // A completed handover changes the caller's own role, which the shell
      // reads from /me and every screen gates on.
      void queryClient.invalidateQueries({ queryKey: keys.me });
      void queryClient.invalidateQueries({ queryKey: keys.members(companyId) });
    },
  });
}
