import { useQuery } from "@tanstack/react-query";

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
export function useMemberFirsts(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: ["me", "firsts", companyId] as const,
    queryFn: () =>
      apiFetch<{ replied: boolean; noted: boolean; marked_done: boolean }>(
        "/v1/me/firsts",
        { companyId },
      ),
    enabled,
    staleTime: 60_000,
  });
}
