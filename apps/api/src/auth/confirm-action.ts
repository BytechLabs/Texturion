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
import { hasVerifiedFactor, requireStepUpForEnrolled } from "./step-up";

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
    // The session check. `requireStepUpForEnrolled` re-reads the factor, which is one
    // extra round trip on a rare, deliberate act and keeps that helper usable on its
    // own from `DELETE /v1/account`.
    return requireStepUpForEnrolled(c, before);
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
