import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import {
  roleHasCapability,
  roleSatisfiesRank,
  type Capability,
} from "@loonext/shared";

import {
  MEMBER_ROLES,
  type AppEnv,
  type AssuranceLevel,
  type MemberRole,
} from "../context";
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
 * #581: `company_mfa_posture` read on its own, by {@link resolveMfaStepUp}, for
 * a route the RPC above never computed one for. Only the field that gates is
 * named — see {@link MfaPosture} for why the other two exist. Same tolerance as
 * the object above, and for the same reason.
 */
const posturePayloadSchema = z
  .object({ enforcing: z.boolean() })
  .nullable()
  .catch(null);

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

    // #314 the workspace's demand, #496 the person's own. Both readings live in
    // {@link mfaStepUpRequired} below, because GET /v1/me has to make the same
    // decision about the same payload from outside this middleware.
    //
    // Placed AFTER membership so the answer cannot be mined by a non-member,
    // and after the company-exempt early return so every route that could get
    // somebody OUT of this state (enrolment lives against GoTrue directly;
    // recovery, the factor list and signing a lost device out are bearer-only)
    // stays reachable at aal1. An enforcement gate with no exit is not a
    // security feature, it is an outage with a good reason attached.
    const stepUp = mfaStepUpRequired(authorized.mfa, c.get("aal"));
    if (stepUp) return errorResponse(c, stepUp.code, stepUp.message);

    c.set("companyId", companyId);
    c.set("role", parsedRow.data.role);
    c.set("memberId", parsedRow.data.id);
    await next();
  });
}

/**
 * The two MFA facts a (user, workspace) pair produces: #314's workspace policy
 * once its grace window has run out, and #496's "this person holds a verified
 * factor". `required` and `grace_until` travel beside them on the wire for the
 * clients to render, and gate nothing.
 */
export interface MfaPosture {
  enforcing: boolean;
  enrolled: boolean;
}

/** What a session that has not presented its second factor is owed. */
export interface MfaStepUp {
  code: "mfa_required" | "mfa_challenge_required";
  message: string;
}

/**
 * Must this session present a second factor before it is shown a workspace?
 *
 * #314: the workspace requires one, the grace window the crew was given has
 * passed, and this token does not have one. It is expressed as its own code
 * rather than a 403 with prose because all three clients route on it — to the
 * enrolment screen, not to an error toast.
 *
 * #496 — "I am able to login without any 2fa codes even though 2fa is enabled."
 * Correct, and the gap was this: enrolment happens against GoTrue, which signs a
 * password login in at aal1 and leaves demanding the second factor to the
 * application. #314 only demanded it when a WORKSPACE policy said so, so a
 * person who turned 2FA on for themselves got a factor and no consequence — the
 * control was real and the switch that armed it belonged to somebody else.
 * Enrolling IS the demand: no policy, no grace window, no owner involved.
 *
 * The two codes are not interchangeable and neither is its wording.
 * `mfa_required` means "you have no factor, go and enrol"; the other means "you
 * have one, enter a code" — sending somebody already enrolled to the enrolment
 * screen is a dead end that invites them to add a SECOND factor to fix being
 * asked for the first. So the copy is returned from here rather than written at
 * each gate: a fork in the message is a fork in which of the two states a
 * person is told they are in.
 *
 * #581 — EXPORTED, and that is the point of the shape. The company-exempt
 * routes run before the middleware above reaches either gate, and one of them,
 * GET /v1/me, hydrates the identical workspace payload that GET /v1/company
 * serves from behind it. That route already re-implemented the membership half
 * of what it was exempted from; a second copy of THIS half is how the two would
 * drift again.
 *
 * A null posture is "no workspace was named, or a Worker is running ahead of the
 * migration that reports the field" — no demand either way, per the
 * expand/contract reasoning on `authorizeSchema` above.
 */
export function mfaStepUpRequired(
  posture: MfaPosture | null,
  aal: AssuranceLevel,
): MfaStepUp | null {
  if (aal === "aal2") return null;
  if (posture?.enforcing) {
    return {
      code: "mfa_required",
      message:
        "This workspace requires two-factor authentication. Set it up to carry on.",
    };
  }
  if (posture?.enrolled) {
    return {
      code: "mfa_challenge_required",
      message: "Enter the code from your authenticator app to continue.",
    };
  }
  return null;
}

/**
 * #581: the same question, asked by a company-EXEMPT route that resolves a
 * workspace of its own anyway.
 *
 * Those routes make the middleware pass `p_company_id => null`, so
 * `api_authorize_request` never computes a posture for them — the exemption
 * removes the answer as well as the gate. This asks for it directly.
 *
 * It reads the two SQL functions that RPC itself composes rather than deriving
 * either fact from columns the caller already has. `enforcing` is "required, AND
 * the grace deadline has passed", and a TypeScript copy of that comparison would
 * be a second opinion about a deadline — which is exactly the failure this
 * change exists to remove, one layer down.
 *
 * Nothing is asked at aal2, where no posture can produce a demand. The caller is
 * the hottest route in the product, and a session that has already presented its
 * factor should not pay two lookups to be told so.
 *
 * A lookup FAILURE throws: an infrastructure blip is not an authorization
 * outcome, which is how the middleware above answers too.
 */
export async function resolveMfaStepUp(
  c: Context<AppEnv>,
  companyId: string,
): Promise<MfaStepUp | null> {
  const aal = c.get("aal");
  if (aal === "aal2") return null;

  const db = getDb(getEnv(c.env));
  const [postureRes, enrolledRes] = await Promise.all([
    db.rpc("company_mfa_posture", { p_company_id: companyId }),
    db.rpc("user_has_verified_mfa", { p_user_id: c.get("userId") }),
  ]);
  if (postureRes.error) {
    throw new Error(`mfa posture lookup failed: ${postureRes.error.message}`);
  }
  if (enrolledRes.error) {
    throw new Error(`mfa enrolment lookup failed: ${enrolledRes.error.message}`);
  }

  return mfaStepUpRequired(
    {
      // Null for a workspace that does not exist, and `.catch(null)` for a shape
      // this build does not recognise — both resolve to "no policy", which is
      // the behaviour of every build before this one. Degrading to the old
      // answer beats 500ing the route the whole app boots on.
      enforcing: posturePayloadSchema.parse(postureRes.data)?.enforcing === true,
      enrolled: enrolledRes.data === true,
    },
    aal,
  );
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

/**
 * #224: a route two DIFFERENT people need for two different reasons.
 *
 * Deliberately rare, and it exists because the alternative was worse. The
 * payout-account read is opened by a bookkeeper doing the books
 * (`billing.manage`) and by a tech in a driveway whose composer has to know
 * whether an "Ask for payment" control may appear at all
 * (`conversations.send`) — two capabilities that intentionally do not overlap,
 * so no single one describes the route.
 *
 * The alternatives were a second near-identical endpoint (two routes to keep in
 * step about one fact) or widening the tech's role (handing the inbox to the
 * bookkeeper, which #315 exists to stop). Neither is better than saying "either
 * of these two" out loud.
 *
 * NOT a general-purpose loosener. It answers whether the caller may reach the
 * route; a route whose RESPONSE differs by capability — as this one's does,
 * redacting the operator fields from a caller without `billing.manage` — still
 * has to make that distinction itself, because a gate cannot.
 */
export function requireAnyCapability(...capabilities: Capability[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const role: MemberRole | undefined = c.get("role");
    const permitted =
      role !== undefined &&
      capabilities.some((capability) => roleHasCapability(role, capability));
    if (!permitted) {
      return errorResponse(c, "forbidden", "Insufficient role for this action.");
    }
    await next();
  });
}
