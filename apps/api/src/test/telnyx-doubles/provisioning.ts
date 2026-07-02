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

import type { Env } from "../../env";

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
