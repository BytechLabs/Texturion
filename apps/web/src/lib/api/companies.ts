import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";
import { keys } from "./keys";
import type { BusinessHours, CompanyView, Country } from "./types";

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
  /** CA only — US companies always have US texting enabled. */
  us_texting_enabled?: boolean;
  /** D15: the creating browser's IANA zone, captured silently at onboarding. */
  timezone?: string;
  /** AUP gate (SPEC §4.1) — anything but literal true is 422. */
  aup_accepted: true;
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
  /** FEATURE-GAPS Step 2 — Google review deep-link (O/A). null clears it. */
  google_review_link?: string | null;
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
