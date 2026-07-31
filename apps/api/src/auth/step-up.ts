import type { Context } from "hono";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";

/**
 * #496 — step-up for the irreversible things that run OUTSIDE the company gate.
 *
 * `companyContext` demands `aal2` from anybody holding a factor, which covers
 * every company-scoped route in the API — including all of the destructive
 * ones, because they each sit behind a capability gate that runs after it.
 *
 * The company-EXEMPT routes are the gap, and they are exempt for a good reason:
 * they are the ones that get somebody OUT of an MFA state, so gating them on
 * MFA would be a lock with the key inside. That reasoning holds for all of them
 * except one. `DELETE /v1/account` is exempt because it is about the person
 * rather than a workspace — and it is also the single most destructive thing
 * the API can do, permanent, and reachable with a stolen password alone.
 *
 * So this is asked THERE and nowhere else: a person who has said "require a
 * second factor to be me" must present it before their account is destroyed.
 *
 * It is not a lockout. Somebody who genuinely lost their authenticator burns a
 * recovery code first — that removes the factor, which is the loud, auditable
 * path — and then deletes. The exit exists; it just is not silent.
 */
export async function requireStepUpForEnrolled(
  c: Context<AppEnv>,
): Promise<Response | null> {
  if (c.get("aal") === "aal2") return null;

  const db = getDb(getEnv(c.env));
  const { data, error } = await db.rpc("user_has_verified_mfa", {
    p_user_id: c.get("userId"),
  });
  if (error) {
    // An infrastructure failure is not an authorization outcome. Refusing here
    // would let a database blip destroy somebody's ability to leave; the
    // alternative — proceeding — is bounded by the fact that this same person
    // already proved a password on a session this build issued.
    throw new Error(`step-up check failed: ${error.message}`);
  }
  if (data !== true) return null;

  return errorResponse(
    c,
    "mfa_challenge_required",
    "Enter the code from your authenticator app before deleting your account.",
  );
}
