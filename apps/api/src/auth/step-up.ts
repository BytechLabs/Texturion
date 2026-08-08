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
 * So this was asked THERE first: a person who has said "require a second factor
 * to be me" must present it before their account is destroyed.
 *
 * ## #537 — and before they hand the business over
 *
 * The second caller is the ownership handover, and it needed a different argument
 * to arrive at the same place. Those routes are NOT company-exempt, so the
 * company gate already demands `aal2` from a factor-holder — but that is a
 * SESSION-level check made once at sign-in, and the transfer of a whole business
 * deserves to be asked at the moment it happens rather than inherited from
 * something that happened this morning.
 *
 * Offering is where a stolen session can arm an irreversible transfer, and the
 * veto window is only as long as it takes the recipient to tap accept — which can
 * be seconds. Accepting and claiming are the moments the business actually moves.
 * Cancelling is deliberately NOT gated: it is the safe direction, and asking an
 * owner for a code while they are racing to veto a takeover would be helping the
 * attacker.
 *
 * It is not a lockout. Somebody who genuinely lost their authenticator burns a
 * recovery code first — that removes the factor, which is the loud, auditable
 * path — and then deletes. The exit exists; it just is not silent.
 */
export async function requireStepUpForEnrolled(
  c: Context<AppEnv>,
  /**
   * What the person is about to do, in the second half of "Enter the code from
   * your authenticator app before ___".
   *
   * #537 added the second caller, and a shared message would have told an owner
   * handing over their business that they were deleting their account.
   */
  before = "deleting your account",
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
    `Enter the code from your authenticator app before ${before}.`,
  );
}
