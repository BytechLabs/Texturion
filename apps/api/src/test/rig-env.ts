/**
 * D142 test fixture: bindings shaped like the rig's `.dev.vars.rig`, so a suite
 * can drive rig mode through the real env schema. Numbers are in the fictional
 * 555-01xx range; hosts are the rig's private names, which resolve nowhere.
 */
import type { Bindings } from "../env";
import { completeEnv } from "./support";

/** Two numbers in the partition's allowlist. */
export const OWNED_A = "+14165550101";
export const OWNED_B = "+14165550102";
/** A number outside it: the stranger every rig gate must refuse. */
export const STRANGER = "+14165550199";

export const RIG_SUPABASE_URL = "https://db.rig.internal";
export const RIG_TELNYX_API_BASE = "https://edge.rig.internal/g/telnyx";
export const RIG_ROBOT_ORIGIN = "https://robot.rig.internal";
export const RIG_FCM_API_BASE = "https://edge.rig.internal/g/fcm";

export function rigEnv(overrides: Record<string, unknown> = {}): Bindings {
  return {
    ...completeEnv(),
    DEPLOY_ENV: "rig",
    SUPABASE_URL: RIG_SUPABASE_URL,
    SUPABASE_JWKS_URL: `${RIG_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    // A guard caller token, which is never shaped like a raw Telnyx key.
    TELNYX_API_KEY: "rig-caller-token-0123456789",
    TELNYX_API_BASE: RIG_TELNYX_API_BASE,
    TELNYX_BILLING_GROUP_ID: "bg-nonprod",
    RESEND_API_BASE: "https://edge.rig.internal/g/resend",
    FCM_API_BASE: RIG_FCM_API_BASE,
    FCM_OAUTH_TOKEN_URL: "https://edge.rig.internal/g/fcm-token",
    STRIPE_SECRET_KEY: "sk_test_rig_sandbox_0123456789",
    RIG_OWNED_E164: `${OWNED_A}, ${OWNED_B}`,
    RIG_ROBOT_WEBHOOK_ORIGIN: RIG_ROBOT_ORIGIN,
    ...overrides,
  };
}
