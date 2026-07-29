import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";

/**
 * #314 — the second factor.
 *
 * ENROLMENT IS NOT HERE. The browser talks to GoTrue directly
 * (`supabase.auth.mfa.enroll/challenge/verify`), exactly as it does for
 * sign-in — the D8 boundary. What the Worker owns, and what these hooks are,
 * is the part Supabase does not give us: recovery codes, the workspace
 * policy, and the honest answer to "what is actually enrolled".
 */

export interface MfaFactor {
  id: string;
  type: string;
  name: string | null;
  created_at: string | null;
}

export interface MfaState {
  factors: MfaFactor[];
  enrolled: boolean;
  recovery_codes_remaining: number;
  /** This token's assurance level — `aal2` once a factor has been verified. */
  aal: "aal1" | "aal2";
}

export function useMfa() {
  return useQuery({
    queryKey: keys.mfa,
    queryFn: () => apiFetch<MfaState>("/v1/mfa"),
    // A security screen showing a stale answer is worse than none: somebody
    // checking whether they are protected is asking about right now.
    staleTime: 0,
  });
}

/**
 * Issue a fresh set of recovery codes.
 *
 * The plaintext comes back exactly once and is never retrievable again — a
 * code we could re-display is a code an attacker with our database could
 * re-display too, which would make the whole factor decorative. The caller is
 * responsible for showing them before the dialog closes.
 */
export function useIssueRecoveryCodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ codes: string[] }>("/v1/mfa/recovery-codes", {
        method: "POST",
        body: {},
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.mfa }),
  });
}

/**
 * Burn a recovery code. This REMOVES the factor rather than elevating the
 * session — the loud path, deliberately. See the route for why.
 */
export function useRecoverWithCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiFetch<{ removed_factors: number; recovery_codes_remaining: number }>(
        "/v1/mfa/recover",
        { method: "POST", body: { code } },
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.mfa }),
  });
}

export interface WorkspaceMfa {
  required: boolean;
  grace_until: string | null;
}

/** PUT /v1/company/mfa — owner only. The grace deadline never moves once set. */
export function useSetWorkspaceMfa() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { required: boolean; graceDays?: number }) =>
      apiFetch<WorkspaceMfa>("/v1/company/mfa", {
        method: "PUT",
        companyId,
        body: {
          required: input.required,
          ...(input.graceDays === undefined ? {} : { grace_days: input.graceDays }),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.company(companyId) });
      void queryClient.invalidateQueries({ queryKey: keys.mfa });
    },
  });
}
