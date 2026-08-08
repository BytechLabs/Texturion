import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  AvailableNumbersResult,
  MemberNumberAccess,
  NumberAccess,
  NumberIdentity,
  NumberIdentityPatch,
  Page,
  PhoneNumberSummary,
} from "./types";

/** GET /v1/numbers — number cards with status (G8 Numbers). */
export function useNumbers() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.numbers(companyId),
    queryFn: () =>
      apiFetch<Page<PhoneNumberSummary> & { hidden_count?: number }>(
        "/v1/numbers",
        { companyId },
      ),
  });
}

/**
 * GET /v1/available-numbers — the number-picker feed (choose-your-number).
 * Company-EXEMPT (no X-Company-Id): the US onboarding number step runs before
 * the company exists. Fires immediately with a broad country-wide search; an
 * area code, when set, is just an optional narrowing filter (#86), not a
 * precondition. `staleTime: 0` and the returned `refetch` back the picker's
 * Refresh button (Telnyx inventory rotates). `bestEffort` is the user's "show
 * nearby numbers" toggle.
 */
export function useAvailableNumbers(params: {
  country: "US" | "CA";
  areaCode: string | null;
  bestEffort: boolean;
  /** #513: digits the number must contain, honoured by the SEARCH. */
  contains?: string;
}) {
  return useQuery({
    queryKey: keys.availableNumbers(
      params.country,
      params.areaCode,
      params.bestEffort,
      params.contains,
    ),
    queryFn: () =>
      apiFetch<AvailableNumbersResult>("/v1/available-numbers", {
        searchParams: {
          country: params.country,
          area_code: params.areaCode ?? undefined,
          best_effort: params.bestEffort ? "true" : undefined,
          // #513: the digits go to Telnyx. The old comment here said its digit
          // filters were "silently ignored on this endpoint" — checked against
          // the live API on 2026-08-02 and that is false. It works, and the
          // picker was throwing away most of every batch because of a belief
          // nobody had rechecked.
          contains: params.contains,
          // A fuller batch still helps: the visible list filters instantly on
          // every keystroke, before any round trip.
          limit: 50,
        },
      }),
    staleTime: 0,
  });
}

/**
 * POST /v1/numbers/provision — Pro's 2nd number (owner/admin). Requires a
 * client-UUID Idempotency-Key (SPEC §7); the same key replays the same row.
 * The user picks a specific number first (issue #75): a full E.164 is ordered
 * exactly; a bare area code (masked/CA) assigns a number in that code.
 */
export function useProvisionNumber() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      chosen_number_e164?: string;
      requested_area_code?: string;
    }) =>
      apiFetch<PhoneNumberSummary>("/v1/numbers/provision", {
        method: "POST",
        companyId,
        idempotencyKey: crypto.randomUUID(),
        body,
      }),
    onSuccess: (number) => {
      queryClient.setQueryData<Page<PhoneNumberSummary>>(
        keys.numbers(companyId),
        (page) =>
          page && !page.data.some((n) => n.id === number.id)
            ? { ...page, data: [...page.data, number] }
            : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/**
 * POST /v1/numbers/:id/remediate — owner/admin: finish a provision_failed number
 * on the EXISTING paid row (choose a number and/or a new area code, or just
 * retry). No Idempotency-Key / slot claim — it never re-charges. Patches the
 * numbers cache + refreshes the company view.
 */
export function useRemediateNumber(numberId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      requested_area_code?: string;
      chosen_number_e164?: string;
    }) =>
      apiFetch<PhoneNumberSummary>(`/v1/numbers/${numberId}/remediate`, {
        method: "POST",
        companyId,
        body,
      }),
    onSuccess: (number) => {
      queryClient.setQueryData<Page<PhoneNumberSummary>>(
        keys.numbers(companyId),
        (page) =>
          page
            ? {
                ...page,
                data: page.data.map((n) => (n.id === number.id ? number : n)),
              }
            : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/**
 * DELETE /v1/numbers/:id — owner only, type-to-confirm in the UI (G8);
 * needed pre-downgrade, never automatic (SPEC §7).
 */
export function useReleaseNumber() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    // #537 audit: `code` is the confirmation the server asks for before a number
    // is given up for good. Sent only on a retry — the first attempt is what tells
    // us which of the two proofs it wants.
    mutationFn: ({ numberId, code }: { numberId: string; code?: string }) =>
      apiFetch<PhoneNumberSummary>(`/v1/numbers/${numberId}`, {
        method: "DELETE",
        companyId,
        body: code === undefined ? undefined : { confirmation_code: code },
      }),
    onSuccess: (released) => {
      queryClient.setQueryData<Page<PhoneNumberSummary>>(
        keys.numbers(companyId),
        (page) =>
          page
            ? {
                ...page,
                data: page.data.map((n) =>
                  n.id === released.id ? released : n,
                ),
              }
            : page,
      );
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
    },
  });
}

/** #106: the number's access shape (GET /v1/numbers/:id/access, O/A). */
export function useNumberAccess(numberId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.numberAccess(companyId, numberId),
    queryFn: () =>
      apiFetch<NumberAccess>(`/v1/numbers/${numberId}/access`, { companyId }),
    enabled,
  });
}

/**
 * #348: what one member actually reaches, and WHY.
 *
 * Owner/admin only, and fetched on demand rather than with the team list — the
 * team screen is a list of people, and this is one question about one of them.
 */
export function useMemberNumberAccess(userId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [...keys.numberAccess(companyId, "explain"), userId],
    queryFn: () =>
      apiFetch<MemberNumberAccess>(`/v1/numbers/access/explain/${userId}`, {
        companyId,
      }),
    enabled,
  });
}

/** #106: replace the number's access rules (PUT, O/A). */
export function useSetNumberAccess(numberId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (access: NumberAccess) =>
      apiFetch<NumberAccess>(`/v1/numbers/${numberId}/access`, {
        method: "PUT",
        companyId,
        body: access,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.numberAccess(companyId, numberId), saved);
      // A tightened rule changes what the inbox may list for teammates; the
      // caller's own view refreshes lazily (owners/admins are unrestricted).
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
    },
  });
}

/**
 * #307 — one line's identity, RESOLVED, with what each field inherits.
 *
 * The `inherited` flags are the reason this is its own endpoint rather than a
 * slice of the numbers list: a screen showing resolved text in a box cannot
 * otherwise tell an owner whether editing it changes one line or all of them.
 */
export function useNumberIdentity(numberId: string, enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.numberIdentity(companyId, numberId),
    queryFn: () =>
      apiFetch<NumberIdentity>(`/v1/numbers/${numberId}/identity`, { companyId }),
    enabled,
  });
}

/** #307: set or CLEAR this line's overrides. Null on a field means inherit. */
export function useSetNumberIdentity(numberId: string) {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: NumberIdentityPatch) =>
      apiFetch<NumberIdentity>(`/v1/numbers/${numberId}/identity`, {
        method: "PATCH",
        companyId,
        body: patch,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.numberIdentity(companyId, numberId), saved);
      // The numbers list shows the line's name, so it is now stale.
      void queryClient.invalidateQueries({ queryKey: keys.numbers(companyId) });
    },
  });
}
