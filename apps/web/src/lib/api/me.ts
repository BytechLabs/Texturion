import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { Me } from "./types";

/** GET /v1/me — profile + memberships. Company-exempt (no X-Company-Id). */
export function fetchMe(): Promise<Me> {
  return apiFetch<Me>("/v1/me");
}

/**
 * GET /v1/me with the optional X-Company-Id hydration: the response embeds
 * the active company view (subscription, numbers, registration) so the shell
 * hydrates in one round trip (routes/me.ts).
 */
export function fetchMeWithCompany(companyId: string): Promise<Me> {
  return apiFetch<Me>("/v1/me", { companyId });
}

/**
 * GET /v1/me. `enabled` gates the fetch on the Supabase session being resolved
 * (default true for callers inside the shell, where it always is): right after
 * an OAuth redirect the browser client hydrates the session a beat after mount,
 * so firing before then sends a tokenless request that 401s (the CompanyProvider
 * "couldn't load your workspace" flash). CompanyProvider passes its session-ready
 * flag so the first call always carries a token.
 */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: keys.me,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    enabled,
  });
}
