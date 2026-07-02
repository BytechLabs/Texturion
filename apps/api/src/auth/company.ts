import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { MEMBER_ROLES, type AppEnv, type MemberRole } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";

const companyIdSchema = z.uuid();

const memberRowSchema = z.object({
  id: z.uuid(),
  role: z.enum(MEMBER_ROLES),
});

/**
 * The only /v1 routes that carry a JWT but no company scope (SPEC §7):
 * every other /v1 route requires `X-Company-Id`.
 */
const COMPANY_EXEMPT_ROUTES = new Set([
  "GET /v1/me",
  "POST /v1/companies",
  "POST /v1/invites/accept",
]);

/**
 * Company-context middleware (SPEC §10): the caller's company is derived
 * server-side from the `X-Company-Id` header validated against
 * `company_members` for the verified `sub` — never trusted from the body.
 * Attaches `{ companyId, role, memberId }`; a missing/inactive membership is
 * 403 `forbidden`; a missing/non-UUID header is 422 `validation_failed`.
 */
export function companyContext() {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (COMPANY_EXEMPT_ROUTES.has(`${c.req.method} ${c.req.path}`)) {
      return next();
    }

    const header = c.req.header("X-Company-Id");
    const parsedId = companyIdSchema.safeParse(header);
    if (!parsedId.success) {
      return errorResponse(
        c,
        "validation_failed",
        "X-Company-Id header must be a UUID.",
      );
    }
    const companyId = parsedId.data;

    const db = getDb(getEnv(c.env));
    const { data, error } = await db
      .from("company_members")
      .select("id,role")
      .eq("company_id", companyId)
      .eq("user_id", c.get("userId"))
      .is("deactivated_at", null)
      .limit(1);
    if (error) {
      // Infrastructure failure, not an authorization outcome — 500, never 403.
      throw new Error(`company_members lookup failed: ${error.message}`);
    }

    const parsedRow = memberRowSchema.safeParse(data?.[0]);
    if (!parsedRow.success) {
      return errorResponse(c, "forbidden", "Not an active member of this company.");
    }

    c.set("companyId", companyId);
    c.set("role", parsedRow.data.role);
    c.set("memberId", parsedRow.data.id);
    await next();
  });
}

const ROLE_RANK: Record<MemberRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

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
    if (role === undefined || ROLE_RANK[role] < ROLE_RANK[minimum]) {
      return errorResponse(c, "forbidden", "Insufficient role for this action.");
    }
    await next();
  });
}
