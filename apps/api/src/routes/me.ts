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

import { requireCapability } from "../auth/company";
import type { AppEnv, MemberRole } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { clientFlags } from "../flags/client";
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

/**
 * GET /v1/me/firsts — #405. Has THIS member replied, written a note, and
 * marked something done.
 *
 * Its own route rather than a field on GET /v1/me, deliberately. /v1/me is the
 * hottest route in the product and already fans out four parallel queries on
 * every app load; this answers a question that only matters for a few days of
 * one person's life, and paying for it forever on the app's critical path
 * would be a poor trade for a card that disappears.
 *
 * NOT company-exempt (unlike /v1/me itself), so the company middleware
 * resolves membership before this runs and the answer is scoped to the
 * workspace the caller is actually in.
 */
meRoutes.get("/me/firsts", requireCapability("workspace.access"), async (c) => {
  const db = getDb(getEnv(c.env));
  const { data, error } = await db.rpc("api_member_firsts", {
    p_company_id: c.get("companyId"),
    p_user_id: c.get("userId"),
  });
  if (error) throw new Error(`member firsts lookup failed: ${error.message}`);
  return c.json(data);
});

/**
 * GET /v1/me/joining-note — #521. What this member was told about why they were
 * added, in the words of whoever added them.
 *
 * Its own route for the same reason `/me/firsts` has one: `/v1/me` is the
 * hottest route in the product, and this answers a question that matters on
 * exactly one screen, once, for a few minutes of one person's life.
 *
 * Returns `{ note: null, from: null }` for the ordinary case - an owner who
 * made their own workspace, a membership predating this, or an invite sent
 * without a note. The orientation shows the screen only when there is something
 * to show, so "nothing to say" has to be an ordinary answer rather than a 404.
 *
 * The note is read off the MEMBERSHIP rather than the invite: see the migration
 * for why the copy is deliberate. `from` is resolved separately because a
 * display name can change after the invite was written, and the name a new
 * member should see is the one their colleague goes by now.
 */
meRoutes.get(
  "/me/joining-note",
  requireCapability("workspace.access"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const rows = unwrap<{ joining_note: string | null }[]>(
      await db
        .from("company_members")
        .select("joining_note")
        .eq("company_id", c.get("companyId"))
        .eq("user_id", c.get("userId"))
        .limit(1),
      "joining note lookup",
    );
    const note = rows[0]?.joining_note ?? null;
    if (!note) return c.json({ note: null, from: null });

    // Who to attribute it to: the workspace owner, because that is who the
    // invite came from in every case this feature covers. Best-effort - an
    // unattributed note still reads as a person's words, and failing the whole
    // orientation screen over a missing name would be the wrong trade.
    const owners = unwrap<{ profiles: { display_name: string | null } | null }[]>(
      await db
        .from("company_members")
        .select("profiles!inner(display_name)")
        .eq("company_id", c.get("companyId"))
        .eq("role", "owner")
        .limit(1),
      "inviter name lookup",
    );
    const from = owners[0]?.profiles?.display_name?.trim() || null;
    return c.json({ note, from });
  },
);

/**
 * POST /v1/me/oriented — #286. The member finished, or skipped, the joining
 * orientation.
 *
 * ONE ROUTE FOR BOTH OUTCOMES. Skipping is not a lesser result to be re-asked
 * tomorrow; #286 promises a skippable flow, and a skip that comes back is not
 * one. Splitting them would also invite a client to record only completions,
 * which is the bug where the person least interested in the flow is the one
 * who keeps seeing it.
 *
 * Idempotent, and answers 200 to a repeat: the SQL leaves the original
 * timestamp alone (it is also the record of when this person joined the
 * product properly) and reports whether it changed anything. A client retrying
 * after a dropped response must not be handed an error for succeeding twice.
 *
 * Same capability as the read it pairs with. There is nothing to protect here
 * beyond membership — the caller can only ever mark THEMSELVES, because the
 * user id comes from the verified session and never from the body.
 */
meRoutes.post(
  "/me/oriented",
  requireCapability("workspace.access"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const { data, error } = await db.rpc("api_mark_oriented", {
      p_company_id: c.get("companyId"),
      p_user_id: c.get("userId"),
    });
    if (error) throw new Error(`mark oriented failed: ${error.message}`);
    return c.json(data);
  },
);

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
    // #283: the flags this workspace should honour CLIENT-side.
    //
    // Only the client-relevant ones travel — `kill:realtime` is the whole
    // reason this exists, because clients connect to Supabase Realtime
    // directly and there is no server choke point to refuse. A killed realtime
    // means the client stops subscribing and falls back to polling: slower,
    // never wrong.
    //
    // Best-effort, like everything else about flags. A failure here resolves
    // to the code default (realtime on), never to a /me that 500s.
    body.flags = await clientFlags(env, parsed.data, db);
  }

  return c.json(body);
});
