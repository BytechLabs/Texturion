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

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
  });
}
