import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type {
  BusinessHours,
  CompanyView,
  Country,
  WorkspaceClosure,
} from "./types";

/** GET /v1/company — company + plan/subscription/period/cap + numbers + registration. */
export function useCompany() {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.company(companyId),
    queryFn: () => apiFetch<CompanyView>("/v1/company", { companyId }),
  });
}

export interface CreateCompanyInput {
  name: string;
  country: Country;
  requested_area_code: string;
  /** Choose-your-number: the specific number picked in onboarding (E.164); omitted = auto-assign. */
  chosen_number_e164?: string;
  /** CA only — US companies always have US texting enabled. */
  us_texting_enabled?: boolean;
  /** D15: the creating browser's IANA zone, captured silently at onboarding. */
  timezone?: string;
}

/**
 * POST /v1/companies — company-exempt (the creator has no company yet).
 * Creates company + owner membership + pre-seeded tags + prefs atomically.
 * Onboarding activates the new company via the provider after `me` refetch.
 */
export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCompanyInput) =>
      apiFetch<CompanyView>("/v1/companies", { method: "POST", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export interface CompanyPatch {
  name?: string;
  /** D15: workspace IANA timezone (O/A, validated server-side). */
  timezone?: string;
  /** Owner-only: number, or null to remove the cap (SPEC §2). */
  overage_cap_multiplier?: number | null;
  /** FEATURE-GAPS Step 1 — after-hours away reply (O/A). */
  business_hours?: BusinessHours;
  away_enabled?: boolean;
  away_message?: string | null;
  /** #414: whether a reply of URGENT wakes the whole crew. */
  emergency_keyword_enabled?: boolean;
  /** #388: chase a lead nobody has answered, and whether that chase ends up
   *  waking the whole crew (O/A). */
  lead_chase_enabled?: boolean;
  lead_chase_crew_enabled?: boolean;
  /** FEATURE-GAPS voice wave — missed-call text-back (O/A). */
  mctb_enabled?: boolean;
  mctb_message?: string | null;
  /** D43 Calls v2 (O/A): voicemail greeting (null = spoken default),
   *  screening routing, CNAM display name (<=15 alnum+space; #193: null =
   *  default to the company name, never "no listing"), inbound caller-name
   *  lookup. */
  voicemail_greeting?: string | null;
  call_screening?: "off" | "flag" | "divert";
  cnam_display_name?: string | null;
  caller_id_lookup?: boolean;
}

/** PATCH /v1/company — workspace name (O/A) + overage cap (owner). */
export function useUpdateCompany() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: CompanyPatch) =>
      apiFetch<Omit<CompanyView, "numbers" | "registration">>("/v1/company", {
        method: "PATCH",
        companyId,
        body: patch,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<CompanyView>(
        keys.company(companyId),
        (company) => (company ? { ...company, ...updated } : company),
      );
      if (updated.name !== undefined) {
        // The sidebar company block reads /v1/me.
        queryClient.invalidateQueries({ queryKey: keys.me });
      }
      if ("overage_cap_multiplier" in updated) {
        queryClient.invalidateQueries({
          queryKey: keys.usage(companyId),
          refetchType: "active",
        });
      }
    },
  });
}

/**
 * DELETE /v1/company (#341 / D48) — close the workspace.
 *
 * Owner only. Access ends immediately; the erasure runs after the window in
 * the response's `purge_after`. The result is deliberately specific — how many
 * sessions ended, whether the number was released — because "we've closed it"
 * without saying what actually happened is the kind of reassurance that turns
 * out to be wrong.
 */
export function useCloseWorkspace() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: () =>
      apiFetch<WorkspaceClosure>("/v1/company", {
        method: "DELETE",
        companyId,
      }),
  });
}
