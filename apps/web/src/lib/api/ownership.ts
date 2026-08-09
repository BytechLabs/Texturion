import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import type { ConfirmableAction } from "@/lib/hooks/use-action-confirmation";

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

/**
 * The three the server demands proof for (#537), and the only three that carry a code.
 *
 * Split out as its own union because THREE places need to agree on it: the strip in
 * the mutation below, and the `onError` on each of the two screens that run these
 * actions. Written out three times it is three chances to disagree — and the surface
 * that got it wrong would send a proof demand down the toast path, which is the
 * action becoming impossible from that screen. So the rule is the type, and
 * `isGatedOwnershipAction` is the one way to ask it.
 */
export type GatedOwnershipAction =
  | { action: "offer"; memberId: string; code?: string }
  | { action: "claim"; code?: string }
  | { action: "accept"; code?: string };

export type OwnershipAction =
  | GatedOwnershipAction
  | { action: "backup"; memberId: string | null }
  | { action: "cancel" };

/**
 * Does this action take a confirmation code?
 *
 * `backup` and `cancel` do not. Cancel especially: vetoing a handover is the safe
 * direction, so an owner who has lost their authenticator must still be able to stop
 * one, and standing a code in front of "no" would be a trap.
 */
export function isGatedOwnershipAction(
  input: OwnershipAction,
): input is GatedOwnershipAction {
  return (
    input.action === "offer" ||
    input.action === "claim" ||
    input.action === "accept"
  );
}

/**
 * One mutation for all five, because every one of them returns the same
 * refreshed state and every one of them changes the same card. Splitting them
 * would mean five near-identical hooks and five chances to forget an
 * invalidation.
 */
/**
 * #537 — POST /v1/company/ownership/confirm-code. "Email me a code."
 *
 * Its own hook rather than a sixth branch of the action above: it changes no
 * ownership state, invalidates nothing, and is the only one a client calls twice in
 * a row on purpose.
 */
export function useRequestHandoverCode() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: (action: ConfirmableAction) =>
      apiFetch<{ sent: boolean }>("/v1/company/ownership/confirm-code", {
        method: "POST",
        companyId,
        body: { action },
      }),
  });
}

export function useOwnershipAction() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OwnershipAction) => {
      const path =
        input.action === "backup"
          ? "/v1/company/ownership/backup"
          : `/v1/company/ownership/${input.action}`;
      // #537: the confirmation travels with the action it authorises. Asked through
      // the same predicate the screens use, so the strip and the prompt cannot come
      // to different conclusions about which actions need one.
      const code = isGatedOwnershipAction(input) ? input.code : undefined;
      const body = {
        ...(input.action === "backup" || input.action === "offer"
          ? { member_id: input.memberId }
          : {}),
        ...(code ? { confirmation_code: code } : {}),
      };
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
