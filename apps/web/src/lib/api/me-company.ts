import {
  type DashboardPanelId,
  normaliseHiddenPanels,
} from "@loonext/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { fetchMeWithCompany } from "./me";
import type { Me } from "./types";

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
 * GET /v1/me/joining-note (#521): why this member was added, in the words of
 * whoever added them.
 *
 * `{ note: null, from: null }` is the ordinary answer, not a miss: every
 * membership older than the field, every owner who made their own workspace,
 * and every invite sent without a note. `from` can be null on its own too, and
 * an unattributed note is still a person's words rather than a broken read.
 *
 * Its own query for the reason `/me/firsts` has one: this answers a question
 * that matters on one screen, once, and /v1/me is on every app load.
 */
export interface JoiningNote {
  note: string | null;
  from: string | null;
}

export function useJoiningNote(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: ["me", "joining-note", companyId] as const,
    queryFn: () => apiFetch<JoiningNote>("/v1/me/joining-note", { companyId }),
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

/**
 * #540 — which dashboard panels this member has put away here.
 *
 * Read off the membership in the /v1/me payload the shell has already loaded, so
 * the landing screen knows the layout BEFORE it paints. A separate query would
 * render the four measures and then take two of them away, which looks like a
 * bug in the page rather than like a preference being honoured.
 */
export function useHiddenPanels(): DashboardPanelId[] {
  const companyId = useCompanyId();
  const me = useMeCompany();
  const membership = me.data?.memberships?.find(
    (m) => m.company_id === companyId,
  );
  return useMemo(
    () => normaliseHiddenPanels(membership?.dashboard_hidden ?? []),
    [membership?.dashboard_hidden],
  );
}

/**
 * PUT /v1/me/dashboard — save the set.
 *
 * OPTIMISTIC, and this is the one place on the dashboard where that is not a
 * shortcut. A switch is a direct-manipulation control: the panel is right there
 * and the member is watching it. A spinner between the tap and the panel moving
 * makes a preference feel like a transaction, and worse, invites a second tap
 * that undoes the first.
 *
 * The whole set is sent, matching the route: the body describes the screen they
 * want rather than a delta against a state they cannot see.
 *
 * On failure the cache is rolled back to the exact snapshot taken before the
 * write, so a dropped connection leaves the screen agreeing with the server
 * rather than showing a preference that was never saved.
 */
export function useSetHiddenPanels() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hidden: DashboardPanelId[]) =>
      apiFetch<{ hidden: DashboardPanelId[] }>("/v1/me/dashboard", {
        method: "PUT",
        companyId,
        body: { hidden },
      }),
    onMutate: async (hidden) => {
      // Stop an in-flight /v1/me from landing after this and reinstating the
      // panel the member just put away.
      await queryClient.cancelQueries({ queryKey: ["me"] });
      const snapshot = queryClient.getQueriesData<Me>({ queryKey: ["me"] });
      for (const [key] of snapshot) {
        queryClient.setQueryData<Me>(key, (old) =>
          old
            ? {
                ...old,
                memberships: old.memberships.map((m) =>
                  m.company_id === companyId
                    ? { ...m, dashboard_hidden: hidden }
                    : m,
                ),
              }
            : old,
        );
      }
      return { snapshot };
    },
    onError: (_error, _hidden, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
