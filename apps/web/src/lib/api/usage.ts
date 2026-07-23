import { useQuery } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { Usage } from "./types";

/**
 * GET /v1/usage — current-period outbound segments from usage_events (the
 * app-side source of truth, never Stripe — SPEC §9). Feeds /settings/usage
 * (G8, rendered from the #178 `status` contract), the composer cap gate, and
 * the getting-started first-reply check.
 */
export function useUsage() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.usage(companyId),
    queryFn: () => apiFetch<Usage>("/v1/usage", { companyId }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // usage has no realtime event; drift gently
  });
}
