/**
 * TEST-ONLY stand-in for the telnyx track's `src/telnyx/registration.ts`
 * (cross-track contract) — see ./provisioning.ts for why this exists.
 */
import { vi } from "vitest";

import type { Env } from "../../env";

export const handle10dlcEvent = vi.fn<
  (env: Env, event: unknown) => Promise<void>
>(async () => {});

/** Mirrors the real module's SubmitRegistrationResult shape. */
type SubmitRegistrationResult =
  | {
      action: "brand_submitted" | "campaign_submitted" | "campaign_reactivated";
      brand: unknown;
      campaign: unknown;
    }
  | { action: "noop"; reason: string };

export const submitRegistration = vi.fn<
  (env: Env, companyId: string) => Promise<SubmitRegistrationResult>
>(async () => ({ action: "noop", reason: "test double default" }));

export const pollRegistrations = vi.fn<(env: Env) => Promise<void>>(
  async () => {},
);

export const retryCampaignAssignments = vi.fn<
  (env: Env) => Promise<number>
>(async () => 0);

export const nudgeSoleProprietorOtp = vi.fn<
  (env: Env, now?: Date) => Promise<number>
>(async () => 0);

export const deactivateCampaign = vi.fn<
  (env: Env, companyId: string) => Promise<void>
>(async () => {});

export const getSendGates = vi.fn<
  (
    env: Env,
    companyId: string,
  ) => Promise<{
    subscriptionActive: boolean;
    usApproved: boolean;
    caAllowed: boolean;
  }>
>(async () => ({ subscriptionActive: true, usApproved: true, caAllowed: true }));
