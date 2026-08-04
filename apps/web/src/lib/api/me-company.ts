import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { fetchMeWithCompany } from "./me";

/**
 * GET /v1/me WITH the X-Company-Id hydration (routes/me.ts): the response
 * embeds the active company view — subscription, numbers, registration — in
 * one round trip. The G4 activation empty state reads the company number from
 * here; realtime `number.updated` invalidates `["me"]`-prefixed keys, so the
 * number appears the moment provisioning completes.
 */
export function useMeCompany() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: ["me", "company", companyId] as const,
    queryFn: () => fetchMeWithCompany(companyId),
    staleTime: 60_000,
  });
}

/**
 * GET /v1/me/firsts — #405. The three things THIS member has already done.
 *
 * Its own query rather than a field on `useMeCompany`, matching the server
 * split: /v1/me is on every app load and this answers a question that stops
 * mattering after a few days. `enabled` keeps it from firing at all for the
 * owners and admins who see the other card.
 */
export interface MemberFirsts {
  replied: boolean;
  noted: boolean;
  marked_done: boolean;
  /**
   * #286: has this member been through the joining orientation — the one piece
   * of their first-run state that cannot be derived from rows they wrote,
   * because it is a thing we did to them rather than a thing they did.
   */
  oriented: boolean;
}

export function useMemberFirsts(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: ["me", "firsts", companyId] as const,
    queryFn: () =>
      apiFetch<MemberFirsts>("/v1/me/firsts", { companyId }),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * POST /v1/me/oriented — #286. Finished, or skipped; the same call either way.
 *
 * Optimistic in effect without being optimistic in code: the orientation
 * unmounts on the click and the flag it read is invalidated behind it, so a
 * failed write costs somebody a repeat on their next sign-in rather than a
 * dialog about a screen they just closed.
 */
export function useMarkOriented() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ oriented: boolean; marked: boolean }>("/v1/me/oriented", {
        method: "POST",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me", "firsts"] });
    },
  });
}
