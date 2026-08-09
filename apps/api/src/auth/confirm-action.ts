/**
 * #537 — proof of identity in front of the things that cannot be undone.
 *
 * ## The rule
 *
 * A capability check answers "is this person allowed to do this". It does not answer
 * "is this person who they say they are", and for an action that ends or hands over a
 * business those are different questions. A stolen session satisfies the first one
 * perfectly.
 *
 * `DELETE /v1/account` has asked the second question since #496. This module is that
 * rule applied to the rest of the list the #537 audit turned up: handing the
 * workspace over, closing it, releasing a number, and lowering the crew's two-factor
 * requirement.
 *
 * ## Two mechanisms, and why the weaker one cannot be chosen
 *
 * Most owners have no authenticator. A gate that only knew how to challenge a factor
 * would therefore ask nothing of most of the people it exists to protect — so there
 * is a second path: a six-digit code emailed to the address on the account.
 *
 * The order is not negotiable. Somebody who HOLDS a factor is asked for it and is
 * never offered the email, because a fallback available to everybody makes the weaker
 * mechanism the effective one for everybody — including whoever stole the session.
 *
 * ## What it deliberately does not distinguish
 *
 * A refused code says one thing for wrong, expired, already spent, and out of
 * attempts. Naming which would tell somebody whether they had the right digits.
 */
import type { Context } from "hono";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { hasVerifiedFactor } from "./step-up";

/**
 * The actions a code can be minted for, and which it is then locked to.
 *
 * Named for what a person is about to do rather than for the route that does it,
 * because the name reaches the audit log — and because the database enforces the same
 * list, so a code minted to hand the business over cannot close it instead.
 */
export const CONFIRMABLE_ACTIONS = [
  "offer",
  "claim",
  "accept",
  "close_workspace",
  "release_number",
  "relax_mfa",
] as const;

export type ConfirmableAction = (typeof CONFIRMABLE_ACTIONS)[number];

/**
 * How recently a second factor must have been proved to stand in for an emailed
 * code, in seconds.
 *
 * Five minutes is the trade: long enough that clearing the MFA wall on sign-in
 * and then immediately transferring ownership is one challenge rather than two,
 * short enough that a session stolen hours ago is no longer holding a valid
 * proof. Not configurable — a per-workspace window would be a setting whose only
 * effect is to make this weaker.
 */
const REPROVE_WINDOW_SECONDS = 5 * 60;

/**
 * Ask for proof, or return null when there is nothing left to ask.
 *
 * `before` completes the sentence "…before {before}", so it reads as the thing the
 * person is actually doing: "before handing the workspace over", "before closing this
 * workspace". Generic copy here would be the difference between a prompt somebody
 * trusts and one they think is a phishing page.
 */
export async function requireActionConfirmation(
  c: Context<AppEnv>,
  action: ConfirmableAction,
  before: string,
  code: string | undefined,
): Promise<Response | null> {
  if (await hasVerifiedFactor(c)) {
    /**
     * #581/#7 — this used to hand off to `requireStepUpForEnrolled`, and that was
     * a PROVABLE NO-OP for exactly the callers it was meant to challenge.
     *
     * That helper's first statement is `if (c.get("aal") === "aal2") return null`,
     * and `companyContext` has already forced aal2 for anybody enrolled by the
     * time a company-scoped route runs — the enrolment check and the aal demand
     * are computed by the same function. So every act below asked an enrolled
     * owner for NOTHING, while an owner with no factor had to go and fetch an
     * emailed code. The control inverted: the better-protected account was asked
     * for less. D127 says "prove it at the moment of the act", and nothing was
     * being proved at the moment of anything.
     *
     * What is asked now is FRESHNESS, which is the question a confirmation was
     * always trying to put. `aal2` says a factor was verified for this session at
     * some point, possibly on Monday. `factorProvedAt` — the `amr` claim, read
     * nowhere in this codebase before this — says when.
     *
     * Five minutes. Long enough that somebody who has just cleared the MFA wall
     * on sign-in is not asked twice in a row for the same thing; short enough
     * that a session stolen this morning cannot hand the business away this
     * afternoon.
     */
    const provedAt = c.get("factorProvedAt");
    const freshEnough =
      provedAt !== null &&
      Date.now() / 1000 - provedAt <= REPROVE_WINDOW_SECONDS;
    if (freshEnough) return null;

    /**
     * A stale factor REFUSES, and does not fall back to the emailed code.
     *
     * I built the fallback first, reasoning that refusing an ownership transfer is
     * worse than not challenging one, and `ownership.test.ts` rejected it by
     * name — "never lets a code stand in for an authenticator somebody HAS". Its
     * comment states the property better than I can: if a factor-holder can fall
     * back to email, the weaker mechanism quietly becomes the effective one for
     * everybody, and an attacker holding the password plus a mailbox is past a
     * second factor that was never asked for.
     *
     * That is a decision this codebase already made, with a test behind it, and
     * it is right. The emailed code exists for people who have no authenticator
     * to be challenged on; it is not a second way past one.
     *
     * KNOWN LIMITATION, recorded rather than papered over: if a token ever
     * carried no usable `amr` — the string form of the claim, or the claim
     * missing — freshness cannot be established and this refuses every time,
     * because re-verifying would not produce a timestamp either. That would need
     * support to unpick, and it is the right side to err on: the alternative is
     * an escape hatch that weakens the property above for everybody, all the
     * time, to cover a platform state that GoTrue does not currently produce.
     */
    return errorResponse(
      c,
      "mfa_reprove_required",
      `Confirm with your authenticator app before ${before}.`,
    );
  }

  if (!code) {
    return errorResponse(
      c,
      "confirmation_code_required",
      `Enter the code we emailed you before ${before}.`,
    );
  }

  const db = getDb(getEnv(c.env));
  const { data, error } = await db.rpc("api_use_ownership_code", {
    p_company_id: c.get("companyId"),
    p_user_id: c.get("userId"),
    p_action: action,
    p_code: code,
  });
  if (error) throw new Error(`api_use_ownership_code failed: ${error.message}`);
  if (data !== true) {
    // One message for wrong, expired, already used and out of attempts. See above.
    return errorResponse(
      c,
      "confirmation_code_required",
      "That code did not work. Ask for a new one and try again.",
    );
  }
  return null;
}
