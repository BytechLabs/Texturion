import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "./client";
import { ApiError } from "./error";
import { keys } from "./keys";
import type { Me } from "./types";

/** GET /v1/me — profile + memberships. Company-exempt (no X-Company-Id). */
export function fetchMe(): Promise<Me> {
  return apiFetch<Me>("/v1/me");
}

/**
 * PATCH /v1/me — set your own display name (#112). Company-exempt: the invite
 * flow collects the name BEFORE the caller belongs to any workspace.
 */
export function useUpdateDisplayName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (display_name: string) =>
      apiFetch<{ display_name: string }>("/v1/me", {
        method: "PATCH",
        body: { display_name },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.me });
    },
  });
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
    // The first /me after a brand-new signup can hit a cold api Worker isolate
    // that briefly returns a CORS-less runtime error (a raw fetch TypeError,
    // not an ApiError) or a transient 5xx; the isolate warms server-side over
    // ~60-90s, which a manual refresh can't hurry. Ride through it with backoff
    // instead of dead-ending after the global 2 retries and forcing the user to
    // refresh by hand. Auth/permission failures (non-retryable ApiError) still
    // fail fast — a second attempt can't succeed.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && !error.retryable) return false;
      return failureCount < 8;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
  });
}
