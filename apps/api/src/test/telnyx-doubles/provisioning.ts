/**
 * TEST-ONLY stand-in for the telnyx track's `src/telnyx/provisioning.ts`
 * (cross-track contract). vitest.config.ts aliases `../telnyx/provisioning`
 * here so suites in other tracks exercise their OWN logic against recording
 * doubles instead of driving real Telnyx provisioning; tests assert the
 * contract functions were invoked with the right arguments. Signatures match
 * the contract exactly, and every name the real module exposes to OTHER
 * tracks (including index.ts's cron imports) must exist here — vitest fails
 * loudly on a missing export. Product code always imports the real contract
 * path; the alias only exists inside the "cross-track-doubles" vitest
 * project (see vitest.config.ts for the integration rationale).
 */
import { vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../../env";

/** Shape mirror for the port saga's reuse of the provisioning company row. */
export interface ProvisioningCompany {
  id: string;
  name: string;
  country: string;
  requested_area_code: string;
  telnyx_messaging_profile_id: string | null;
  subscription_status: string;
}

export const ensureMessagingProfile = vi.fn<
  (env: Env, db: SupabaseClient, company: ProvisioningCompany) => Promise<string>
>(async () => "profile-double");

export const lookupOwnedNumber = vi.fn<
  (
    env: Env,
    e164: string,
  ) => Promise<{ id: string; phone_number: string } | null>
>(async (_env, e164) => ({ id: `pn-${e164}`, phone_number: e164 }));

export const fetchProvisioningCompany = vi.fn<
  (db: SupabaseClient, companyId: string) => Promise<ProvisioningCompany>
>(async (_db, companyId) => ({
  id: companyId,
  name: "Double Co",
  country: "US",
  requested_area_code: "212",
  telnyx_messaging_profile_id: "profile-double",
  subscription_status: "active",
}));

export const provisionCompanyNumber = vi.fn<
  (
    env: Env,
    input: { companyId: string; checkoutSessionId: string },
  ) => Promise<void>
>(async () => {});

export const suspendCompanyNumbers = vi.fn<
  (env: Env, companyId: string) => Promise<void>
>(async () => {});

export const releaseCompanyNumbers = vi.fn<
  (env: Env, companyId: string) => Promise<void>
>(async () => {});

export const reconcileNumbers = vi.fn<
  (env: Env, now?: Date) => Promise<void>
>(async () => {});
