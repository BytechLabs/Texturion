/**
 * GET /v1/me (SPEC §7) — profile + memberships. One of the company-exempt
 * routes: it carries a JWT but no required X-Company-Id. When the client DOES
 * send X-Company-Id (the dashboard shell does, to hydrate the active
 * workspace in one round trip), the response additionally embeds that
 * company's subscription status, plan, registration snapshot, and number
 * list — after validating the caller's active membership, exactly as the
 * company-context middleware would.
 *
 * PATCH /v1/me { display_name } (#112) — set the caller's own display name.
 * Also company-exempt: the invite-accept flow needs it BEFORE the caller is a
 * member anywhere (an invited existing/new account arrives with an empty
 * profile name — the signup form is the only other place that sets one, and
 * invitees never pass through it).
 */
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv, MemberRole } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { loadCompanyView } from "./core/company-view";
import { parseJsonBody, unwrap } from "./core/http";

const companyIdSchema = z.uuid();

const updateMeSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
});

interface MembershipRow {
  company_id: string;
  role: string;
  companies: { name: string; subscription_status: string };
}

export const meRoutes = new Hono<AppEnv>();

// #112: the caller sets their OWN display name (the team sees it everywhere —
// members list, avatars, notes). Company-exempt: the invite flow collects the
// name BEFORE the first membership exists. Upsert mirrors the signup trigger
// (a profiles row may not exist yet for edge-created users).
meRoutes.patch("/me", async (c) => {
  const body = await parseJsonBody(c, updateMeSchema);
  const db = getDb(getEnv(c.env));
  const rows = unwrap<{ display_name: string }[]>(
    await db
      .from("profiles")
      .upsert(
        { user_id: c.get("userId"), display_name: body.display_name },
        { onConflict: "user_id" },
      )
      .select("display_name"),
    "profile update",
  );
  return c.json({ display_name: rows[0]?.display_name ?? body.display_name });
});

/**
 * #386: the member re-opens their own address after fixing it.
 *
 * Only a HARD BOUNCE can be cleared, and only by the person whose address it
 * is — enforced in SQL from the verified `sub`, never from the request body,
 * so nobody can un-suppress somebody else. A COMPLAINT is permanent: pressing
 * a button in our app is not consent to resume mailing somebody who reported
 * us as spam, and continuing to is the fastest route to a blocklist.
 *
 * Company-exempt for the same reason the rest of this file is: an address
 * belongs to a person, not to a workspace, and the same broken address is
 * broken in every workspace they belong to.
 */
meRoutes.post("/me/email/retry", async (c) => {
  const db = getDb(getEnv(c.env));
  const { data, error } = await db.rpc("api_clear_email_suppression", {
    p_user_id: c.get("userId"),
  });
  if (error) {
    throw new Error(`clear email suppression failed: ${error.message}`);
  }
  const result = (data ?? {}) as { cleared?: boolean; reason?: string };
  if (result.cleared !== true && result.reason === "complaint") {
    return errorResponse(
      c,
      "validation_failed",
      "This address reported our email as spam, so we can't start sending to it again. Use a different address.",
    );
  }
  return c.json({ cleared: result.cleared === true });
});

meRoutes.get("/me", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const userId = c.get("userId");

  // Both key only on userId — one parallel round-trip instead of two serial
  // (GET /v1/me is on every app load).
  const [profilesRes, membershipRes, hasPasswordRes, emailStateRes] = await Promise.all([
    db.from("profiles").select("display_name").eq("user_id", userId).limit(1),
    db
      .from("company_members")
      .select(
        "company_id,role,companies!inner(name,subscription_status,deleted_at)",
      )
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .is("companies.deleted_at", null),
    // Settings, Account cannot infer this from `user.identities`: setting a
    // password on an OAuth account creates no 'email' identity, so the array
    // says google-only forever. auth.users is the only source that knows.
    db.rpc("api_user_has_password", { p_user_id: userId }),
    // #386: is this person's own email address unreachable? A hard bounce is
    // otherwise completely invisible to them — their notifications just stop,
    // which looks exactly like a quiet week. Resolved in SQL rather than by
    // asking GoTrue for the address first, so it costs one more parallel query
    // instead of two serial round trips on the hottest route in the product.
    db.rpc("api_user_email_state", { p_user_id: userId }),
  ]);
  const profiles = unwrap<{ display_name: string }[]>(
    profilesRes,
    "profile lookup",
  );
  const membershipRows = unwrap<MembershipRow[]>(
    membershipRes,
    "memberships lookup",
  );

  const memberships = membershipRows.map((row) => ({
    company_id: row.company_id,
    name: row.companies.name,
    role: row.role,
    subscription_status: row.companies.subscription_status,
  }));

  const body: Record<string, unknown> = {
    user_id: userId,
    display_name: profiles[0]?.display_name ?? "",
    memberships,
    // A failed lookup reports false, which only ever offers "Set a password" —
    // harmless, and it never claims a password the account may not have.
    has_password: hasPasswordRes.data === true,
    // Null when the address is fine, so "no news" needs no interpretation on
    // three clients. A failed lookup also reports null: a false "we can't
    // reach you" banner is worse than none, because it sends somebody to fix
    // an address that was never broken.
    email_state: emailStateRes.error ? null : (emailStateRes.data ?? null),
  };

  // Optional hydration for the X-Company-Id workspace. The route is exempt
  // from the company-context middleware, so the membership check happens here
  // with the same rule: active membership for the verified sub, else 403.
  const header = c.req.header("X-Company-Id");
  if (header !== undefined) {
    const parsed = companyIdSchema.safeParse(header);
    if (!parsed.success) {
      return errorResponse(
        c,
        "validation_failed",
        "X-Company-Id header must be a UUID.",
      );
    }
    const membership = memberships.find((m) => m.company_id === parsed.data);
    if (!membership) {
      return errorResponse(
        c,
        "forbidden",
        "Not an active member of this company.",
      );
    }
    const company = await loadCompanyView(db, parsed.data, env, {
      userId,
      // company_members.role is DB-constrained to the MemberRole union.
      role: membership.role as MemberRole,
    });
    if (!company) {
      return errorResponse(c, "not_found", "No such company.");
    }
    body.company = company;
  }

  return c.json(body);
});
