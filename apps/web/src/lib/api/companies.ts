import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import type {
  CrewSizeBucket,
  HoursException,
  Locale,
  SignupSource,
} from "@loonext/shared";

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
  /**
   * #370: how big the crew is, as answered on the name step. Omitted when the
   * question was skipped — "not asked" and "solo" are different answers and the
   * reporting depends on telling them apart.
   */
  crew_size?: CrewSizeBucket;
  /** #288: how they say they heard about us. Absent when they skipped it. */
  signup_source?: SignupSource;
  /**
   * #501: the code from the `?ref=` link this signup arrived through, if any.
   * Read from storage at the call site, never typed.
   */
  referral_code?: string;
  /**
   * #296: the marketing page this signup FIRST landed on, plus the referrer
   * host and any allow-listed campaign parameters. Read from storage at the
   * call site and re-sanitised server-side — never typed, never trusted.
   */
  first_touch?: {
    landing_path: string;
    referrer_host?: string;
    params: Record<string, string>;
  };
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
  /** #228 (O/A): the language automated texts go out in. Cannot be cleared:
   *  a workspace with no language is not a state a send path can resolve. */
  locale?: Locale;
  /** Owner-only: number, or null to remove the cap (SPEC §2). */
  overage_cap_multiplier?: number | null;
  /** FEATURE-GAPS Step 1 — after-hours away reply (O/A). */
  business_hours?: BusinessHours;
  away_enabled?: boolean;
  away_message?: string | null;
  /** #481: what a departing owner's customers are told, in their own words.
   *  `null` turns the off-ramp off. Owner-only, and writing it IS the opt-in. */
  offramp_message?: string | null;
  /** #414: whether a reply of URGENT wakes the whole crew. */
  emergency_keyword_enabled?: boolean;
  /** #553: whether we TEXT BACK, separately from whether we notice at all. */
  emergency_reply_enabled?: boolean;
  /** #460: the workspace's own emergency words. `null` restores the product
   *  list; omit the key entirely to leave it alone. */
  emergency_keywords?: string[] | null;
  /** #460: the workspace's own emergency reply. `null` restores the default. */
  emergency_message?: string | null;
  /** #388: chase a lead nobody has answered, and whether that chase ends up
   *  waking the whole crew (O/A). */
  lead_chase_enabled?: boolean;
  lead_chase_crew_enabled?: boolean;
  push_include_content?: boolean;
  /** #402: dates that override the weekly business-hours loop. */
  business_hours_exceptions?: HoursException[];
  /** FEATURE-GAPS voice wave — missed-call text-back (O/A). */
  mctb_enabled?: boolean;
  mctb_message?: string | null;
  /** #393 (O/A): sign the first outbound message to a contact with the business
   *  name. The suffix itself is server-derived and read-only. */
  first_message_identification?: boolean;
  /** #225: the quiet-hours confirmation prompt (admin-only). */
  quiet_hours_confirm_enabled?: boolean;
  /** #298 (O/A): restrict tag CREATION to the set that already exists. */
  tags_locked?: boolean;
  /** D43 Calls v2 (O/A): voicemail greeting (null = spoken default),
   *  screening routing, CNAM display name (<=15 alnum+space; #193: null =
   *  default to the company name, never "no listing"), inbound caller-name
   *  lookup. */
  voicemail_greeting?: string | null;
  voicemail_greeting_id?: string | null;
  /** #278 (O/A): what a call does outside hours, and which recording says so. */
  after_hours_calls?: "ring_everyone" | "on_call_only" | "voicemail";
  after_hours_greeting_id?: string | null;
  /** #278 (O/A): how the phones ring, and for how long. */
  ring_strategy?: "all" | "in_turn";
  ring_seconds?: number;
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
    // #537 audit: `code` is the confirmation the server asks for before a business
    // account ends. Sent only on a retry — the first attempt is what tells us which
    // of the two proofs it wants.
    mutationFn: (code?: string) =>
      apiFetch<WorkspaceClosure>("/v1/company", {
        method: "DELETE",
        companyId,
        body: code === undefined ? undefined : { confirmation_code: code },
      }),
  });
}

/**
 * #232 — the key the embed snippet carries.
 *
 * Its own query rather than a field on `useCompany`, mirroring the API: the
 * company view is fetched by every member at startup and this is only wanted by
 * the one person installing a widget.
 */
export function useWidgetKey(enabled: boolean) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: [...keys.company(companyId), "widget-key"],
    queryFn: () =>
      apiFetch<{ widget_key: string }>("/v1/company/widget-key", { companyId }),
    enabled,
  });
}

/**
 * Replace it, invalidating every embed of the old one.
 *
 * The response carries the new key and is written straight into the cache: the
 * one thing somebody must do immediately after rotating is paste the new
 * snippet, and a refetch could race the write and show them the old one.
 */
export function useRotateWidgetKey() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ widget_key: string }>("/v1/company/widget-key/rotate", {
        method: "POST",
        companyId,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData([...keys.company(companyId), "widget-key"], next);
    },
  });
}
