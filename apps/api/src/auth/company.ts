import { createMiddleware } from "hono/factory";
import { z } from "zod";

import {
  roleHasCapability,
  roleSatisfiesRank,
  type Capability,
} from "@loonext/shared";

import { MEMBER_ROLES, type AppEnv, type MemberRole } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { requestAppVersion, requestClient, requestGeo } from "./request-origin";
import { announceNewDevice } from "./new-device-notice";

const companyIdSchema = z.uuid();

const memberRowSchema = z.object({
  id: z.uuid(),
  role: z.enum(MEMBER_ROLES),
});

const authorizeSchema = z.object({
  session_revoked: z.boolean(),
  session_new: z.boolean(),
  member: z.unknown().nullable(),
  /**
   * #314: the workspace's MFA posture. Null on the company-exempt routes,
   * where there is no workspace policy to apply. `.catch(null)` so a Worker
   * that deploys before the migration reads "no policy" rather than 500ing
   * every request — the expand/contract deploy window, which for an auth
   * middleware is the whole product.
   */
  mfa: z
    .object({
      required: z.boolean(),
      grace_until: z.string().nullable(),
      enforcing: z.boolean(),
      /**
       * #496: whether THIS USER holds a verified factor. Defaulted rather than
       * required for the same expand/contract reason as the object around it —
       * a Worker that deploys ahead of the migration reads "not enrolled" and
       * behaves exactly as it did before, instead of 500ing authorization for
       * every request in the window.
       */
      enrolled: z.boolean().catch(false),
    })
    .nullable()
    .catch(null),
});

/**
 * The only /v1 routes that carry a JWT but no company scope (SPEC §7):
 * every other /v1 route requires `X-Company-Id`.
 *
 * Exported so #347's bypass suite can pin it. This is the list somebody would
 * append to in order to make a 422 go away, and every entry is a route that
 * runs with NO tenant scope at all — so growing it should be a decision
 * somebody made, not a line somebody added.
 *
 * Note these routes are exempt from the COMPANY half only. Since #236 the
 * session check runs on all of them too — a revoked device must not be able
 * to read /v1/me or keep a push token registered.
 */
export const COMPANY_EXEMPT_ROUTES = new Set([
  "GET /v1/me",
  // #112: setting your own display name — the invite flow needs it BEFORE the
  // caller is a member of any company.
  "PATCH /v1/me",
  // #386: re-opening your own bounced email address. An address belongs to a
  // person, not to a workspace — the same broken address is broken in every
  // workspace they belong to, and requiring one to be named would make the fix
  // arbitrarily unavailable depending on which one they had selected.
  "POST /v1/me/email/retry",
  "POST /v1/companies",
  "POST /v1/invites/accept",
  // #109: the caller's own pending invites, matched on their confirmed email —
  // by definition they may not be a member of the inviting company yet.
  "GET /v1/invites/mine",
  // The number picker feed: the US onboarding number step runs before the
  // company row exists, so it can't carry X-Company-Id. Read-only, public
  // Telnyx inventory only (routes/available-numbers.ts).
  "GET /v1/available-numbers",
  // #151: native apps register/remove their FCM device token right after
  // sign-in, before any company is selected. Tokens are per-USER, exactly
  // like push_subscriptions (§6) — the audience/prefs split happens at send
  // time (§8) — so no company scope exists to require.
  "POST /v1/device-push-tokens",
  "DELETE /v1/device-push-tokens",
  // #346: deleting your own account is about the PERSON, not one of their
  // workspaces — and somebody with no membership at all must still be able to
  // leave. Both act on the caller's own userId; there is no id to get wrong.
  "GET /v1/account/deletion-preview",
  "DELETE /v1/account",
  // #236: your own signed-in devices belong to YOU, not to a workspace. A
  // person in two workspaces has one set of sessions, and somebody who has
  // just been removed from their only workspace must still be able to sign
  // their old phone out.
  "GET /v1/sessions",
  "POST /v1/sessions/revoke",
  // #314: a member being TOLD to enrol must be able to reach the thing that
  // fixes it, and somebody locked out of every workspace still owns their
  // own account. An enforcement gate with no exit is an outage with a good
  // reason attached.
  "GET /v1/mfa",
  "POST /v1/mfa/recovery-codes",
  "POST /v1/mfa/recover",
]);

/**
 * Company-context middleware (SPEC §10): the caller's company is derived
 * server-side from the `X-Company-Id` header validated against
 * `company_members` for the verified `sub` — never trusted from the body.
 * Attaches `{ companyId, role, memberId }`; a missing/inactive membership is
 * 403 `forbidden`; a missing/non-UUID header is 422 `validation_failed`.
 *
 * Since #236 the same round trip also settles the SESSION: `api_authorize_
 * request` reads the token's `session_id` against `user_sessions` and reports
 * a revoked one, which is how "sign out that phone" takes effect on the
 * phone's next call instead of whenever its access token happens to lapse.
 * Folding it into the membership lookup rather than adding a second
 * middleware is deliberate — it keeps authentication at exactly one database
 * round trip per request, which is what makes a per-request check affordable.
 */
export function companyContext() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const exempt = COMPANY_EXEMPT_ROUTES.has(`${c.req.method} ${c.req.path}`);

    let companyId: string | null = null;
    if (!exempt) {
      const parsedId = companyIdSchema.safeParse(c.req.header("X-Company-Id"));
      if (!parsedId.success) {
        return errorResponse(
          c,
          "validation_failed",
          "X-Company-Id header must be a UUID.",
        );
      }
      companyId = parsedId.data;
    }

    const env = getEnv(c.env);
    const db = getDb(env);
    const sessionId = c.get("sessionId") ?? null;
    const geo = requestGeo(c);
    const { data, error } = await db.rpc("api_authorize_request", {
      p_user_id: c.get("userId"),
      p_session_id: sessionId,
      p_company_id: companyId,
      p_client: requestClient(c),
      p_user_agent: c.req.header("User-Agent") ?? null,
      p_country: geo.country,
      p_region: geo.region,
      p_city: geo.city,
      // #339: rides the round trip that already runs, so knowing what
      // everyone is running costs nothing per request.
      p_app_version: requestAppVersion(c),
    });
    if (error) {
      // Infrastructure failure, not an authorization outcome — 500, never 403.
      throw new Error(`request authorization failed: ${error.message}`);
    }
    const authorized = authorizeSchema.parse(data);

    if (authorized.session_revoked) {
      // Same 401 shape as a bad token: the client's own recovery is identical
      // (sign in again), and the response says nothing a caller could mine.
      return errorResponse(
        c,
        "unauthorized",
        "This device has been signed out. Sign in again to continue.",
      );
    }

    if (authorized.session_new && sessionId) {
      // A sign-in from a device we have never seen. Told to the account
      // holder, never to the workspace: it is their account, and they are the
      // only one who knows whether it was them.
      announceNewDevice(c, env, db, c.get("userId"), sessionId);
    }

    if (companyId === null) {
      return next();
    }

    const parsedRow = memberRowSchema.safeParse(authorized.member);
    if (!parsedRow.success) {
      return errorResponse(c, "forbidden", "Not an active member of this company.");
    }

    // #314: the workspace requires a second factor, the grace window the crew
    // was given has passed, and this token does not have one.
    //
    // Placed AFTER membership so the answer cannot be mined by a non-member,
    // and expressed as its own code because all three clients route on it —
    // to the enrolment screen, not to an error toast.
    //
    // What makes this safe to switch on at all: every route that could get
    // somebody OUT of this state is company-exempt (enrolment lives against
    // GoTrue directly, recovery and the factor list are bearer-only), so a
    // member being told to enrol can always reach the place that fixes it.
    // An enforcement gate with no exit is not a security feature, it is an
    // outage with a good reason.
    if (authorized.mfa?.enforcing && c.get("aal") !== "aal2") {
      return errorResponse(
        c,
        "mfa_required",
        "This workspace requires two-factor authentication. Set it up to carry on.",
      );
    }

    // #496 — "I am able to login without any 2fa codes even though 2fa is
    // enabled." Correct, and the gap was this: enrolment happens against
    // GoTrue, which signs a password login in at aal1 and leaves demanding the
    // second factor to the application. #314 only demanded it when a WORKSPACE
    // policy said so, so a person who turned 2FA on for themselves got a factor
    // and no consequence — the control was real and the switch that armed it
    // belonged to somebody else.
    //
    // Enrolling IS the demand. No policy, no grace window, no owner involved:
    // that is what everyone means by "two-factor is on", and it is the only
    // reading under which the toggle is not decorative.
    //
    // Its own code because the remedy differs and all three clients route on
    // it. `mfa_required` means "you have no factor, go and enrol"; this means
    // "you have one, enter a code" — sending somebody already enrolled to the
    // enrolment screen is a dead end that invites them to add a SECOND factor
    // to fix being asked for the first.
    //
    // Same placement as the workspace gate, and for the same two reasons: after
    // membership, so a non-member cannot mine whether an account has MFA; and
    // after the company-exempt early return, so every route that gets somebody
    // OUT of this state (recovery, the factor list, signing a lost device out)
    // stays reachable at aal1.
    if (authorized.mfa?.enrolled && c.get("aal") !== "aal2") {
      return errorResponse(
        c,
        "mfa_challenge_required",
        "Enter the code from your authenticator app to continue.",
      );
    }

    c.set("companyId", companyId);
    c.set("role", parsedRow.data.role);
    c.set("memberId", parsedRow.data.id);
    await next();
  });
}

/**
 * Role gate per the SPEC §10 matrix. Roles are strictly hierarchical
 * (owner ⊃ admin ⊃ member): `requireRole('admin')` admits owner and admin
 * (billing, numbers, members, settings); `requireRole('owner')` admits the
 * owner only (overage cap, enable-us, number release); `requireRole('member')`
 * admits any active member. Must be mounted behind `companyContext()`.
 */
export function requireRole(minimum: MemberRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const role: MemberRole | undefined = c.get("role");
    // #315: the rank lives in @loonext/shared beside the capability table that
    // is replacing it, so the two cannot disagree while the gates are converted
    // one axis at a time. Behaviour here is unchanged.
    //
    // A role with no rank FAILS every rank gate. That is deliberate and it is
    // what makes the conversion safe to do incrementally: a preset that is not
    // on the owner ⊃ admin ⊃ member line (a bookkeeper, a read-only observer)
    // is refused by every gate that has not yet been moved to its axis, so an
    // unconverted route can never leak access to a role it was never written
    // for. Fail closed, then open each door on purpose.
    if (role === undefined || !roleSatisfiesRank(role, minimum)) {
      return errorResponse(c, "forbidden", "Insufficient role for this action.");
    }
    await next();
  });
}

/**
 * #315: gate on the CAPABILITY a route actually needs, rather than on a
 * position in a hierarchy that cannot describe a real crew.
 *
 * This is the replacement for {@link requireRole}, applied one axis at a time.
 * The two coexist on purpose: a converted route asks the honest question
 * ("may this person manage billing?"), an unconverted one keeps its rank check
 * and keeps refusing anyone off the line. The capability table in
 * @loonext/shared proves it answers exactly as the rank does for the three
 * roles that exist today, so a conversion is behaviour-preserving until a new
 * preset is introduced.
 */
export function requireCapability(capability: Capability) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const role: MemberRole | undefined = c.get("role");
    if (role === undefined || !roleHasCapability(role, capability)) {
      return errorResponse(c, "forbidden", "Insufficient role for this action.");
    }
    await next();
  });
}
