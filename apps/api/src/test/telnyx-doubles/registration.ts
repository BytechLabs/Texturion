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

/**
 * #303: the enforcement ladder's steps, mirroring the real module's export.
 *
 * Present here because the double IS the contract under this project's alias —
 * a suite importing the type from the real module would get this file, and a
 * missing export fails the whole run rather than one test.
 */
export type AupEnforcement = "none" | "rate_limited" | "suspended";

/**
 * The double defaults to a workspace in good standing on EVERY gate, including
 * enforcement. Anything else would make every unrelated send suite depend on
 * an abuse state it never set, and "none" is what the overwhelming majority of
 * workspaces are.
 *
 * A suite exercising #303 overrides this with mockResolvedValue, the same way
 * the subscription and registration gates are exercised today.
 */
export const getSendGates = vi.fn<
  (
    env: Env,
    companyId: string,
  ) => Promise<{
    subscriptionActive: boolean;
    aupEnforcement: AupEnforcement;
    usApproved: boolean;
    caAllowed: boolean;
  }>
>(async () => ({
  subscriptionActive: true,
  aupEnforcement: "none",
  usApproved: true,
  caAllowed: true,
}));
