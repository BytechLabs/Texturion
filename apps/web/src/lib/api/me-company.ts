import { useQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

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
