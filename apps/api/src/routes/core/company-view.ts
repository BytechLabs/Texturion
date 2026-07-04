/**
 * Company hydration shared by GET /v1/me and GET /v1/company (SPEC §7):
 * safe company columns (never Stripe/Telnyx internals) + numbers summary +
 * registration snapshot (brand and campaign rows).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrap } from "./http";

/** Customer-visible company columns (SPEC §10: internals stay server-side). */
export const COMPANY_COLUMNS =
  "id,name,country,us_texting_enabled,requested_area_code,timezone,plan," +
  "subscription_status,current_period_start,current_period_end," +
  "overage_cap_multiplier,registration_fee_paid_at,canceled_at," +
  "cancel_at_period_end," +
  // FEATURE-GAPS Step 1 & 2: after-hours away settings + review link.
  "business_hours,away_enabled,away_message,google_review_link," +
  "created_at,updated_at";

const NUMBER_COLUMNS =
  "id,status,country,number_e164,requested_area_code,created_at";

const REGISTRATION_COLUMNS =
  "kind,status,sole_proprietor,rejection_reason,submission_count," +
  "submitted_at,approved_at,rejected_at,deactivated_at";

interface RegistrationRow {
  kind: "brand" | "campaign";
  [key: string]: unknown;
}

export interface CompanyView {
  [key: string]: unknown;
  numbers: unknown[];
  registration: {
    brand: RegistrationRow | null;
    campaign: RegistrationRow | null;
  };
}

/**
 * Fetch the company (soft-deleted companies read as absent), its number list,
 * and its registration snapshot. Returns null when no live company exists.
 */
export async function loadCompanyView(
  db: SupabaseClient,
  companyId: string,
): Promise<CompanyView | null> {
  const companies = unwrap<Record<string, unknown>[]>(
    await db
      .from("companies")
      .select(COMPANY_COLUMNS)
      .eq("id", companyId)
      .is("deleted_at", null)
      .limit(1),
    "company lookup",
  );
  const company = companies[0];
  if (!company) return null;

  const numbers = unwrap<unknown[]>(
    await db
      .from("phone_numbers")
      .select(NUMBER_COLUMNS)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true }),
    "phone_numbers lookup",
  );

  const registrations = unwrap<RegistrationRow[]>(
    await db
      .from("messaging_registrations")
      .select(REGISTRATION_COLUMNS)
      .eq("company_id", companyId),
    "messaging_registrations lookup",
  );

  return {
    ...company,
    numbers,
    registration: {
      brand: registrations.find((row) => row.kind === "brand") ?? null,
      campaign: registrations.find((row) => row.kind === "campaign") ?? null,
    },
  };
}
