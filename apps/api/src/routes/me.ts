/**
 * GET /v1/me (SPEC §7) — profile + memberships. One of the company-exempt
 * routes: it carries a JWT but no required X-Company-Id. When the client DOES
 * send X-Company-Id (the dashboard shell does, to hydrate the active
 * workspace in one round trip), the response additionally embeds that
 * company's subscription status, plan, registration snapshot, and number
 * list — after validating the caller's active membership AND its MFA posture
 * (#581), which is everything the company-context middleware would have
 * checked. Half of that pair was missing, and the missing half was the one an
 * exemption cannot excuse: the embedded object is byte-for-byte what
 * GET /v1/company refuses to an aal1 session.
 *
 * PATCH /v1/me { display_name } (#112) — set the caller's own display name.
 * Also company-exempt: the invite-accept flow needs it BEFORE the caller is a
 * member anywhere (an invited existing/new account arrives with an empty
 * profile name — the signup form is the only other place that sets one, and
 * invitees never pass through it).
 */
import { DASHBOARD_PANEL_IDS, LOCALES, normaliseHiddenPanels } from "@loonext/shared";
import { Hono } from "hono";
import { z } from "zod";

import { requireCapability, resolveMfaStepUp } from "../auth/company";
import type { AppEnv, MemberRole } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { clientFlags } from "../flags/client";
import { loadCompanyView } from "./core/company-view";
import { parseJsonBody, unwrap } from "./core/http";

const companyIdSchema = z.uuid();

const updateMeSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80).optional(),
    /**
     * #228: the language THIS MEMBER reads the app in.
     *
     * Nullable, and null is a real value a client sends on purpose — it means
     * "go back to asking my device, then the workspace", which is a different
     * answer from either language and the only way to undo a choice. A schema
     * that treated null as absent would make the setting one-way.
     */
    locale: z.enum(LOCALES).nullable().optional(),
  })
  .refine(
    (value) => value.display_name !== undefined || value.locale !== undefined,
    { message: "Provide a display_name, a locale, or both." },
  );

interface MembershipRow {
  company_id: string;
  role: string;
  dashboard_hidden: string[] | null;
  companies: { name: string; subscription_status: string; locale: string | null };
}

/**
 * #540 — PUT /v1/me/dashboard body. The panels this member has put away.
 *
 * A closed enum, not free text: the stored set is read back on every app load,
 * and an open column would let a client write ids nobody can render and grow
 * forever. Length is capped at the number of panels that exist, which after
 * normalisation is unreachable — it is the belt on a route that writes to the
 * table holding roles.
 */
const dashboardHiddenSchema = z.object({
  hidden: z.array(z.enum(DASHBOARD_PANEL_IDS)).max(DASHBOARD_PANEL_IDS.length),
});

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

/**
 * PUT /v1/me/dashboard — #540. Which measures this member has taken off their
 * own landing screen.
 *
 * PUT rather than PATCH because the body IS the whole set. A member unticking two
 * boxes is describing the screen they want, not applying a delta to a screen they
 * cannot see the current state of — and two clients toggling from stale state
 * would otherwise merge into a layout neither of them asked for.
 *
 * Read back on GET /v1/me rather than here: the dashboard needs the set before it
 * paints, so it rides on the call it was already making.
 *
 * Scoped to the member by the verified session. The user id comes from `sub` and
 * the company from the context middleware, so there is no body a caller can send
 * that saves a preference onto somebody else's screen.
 */
meRoutes.put(
  "/me/dashboard",
  requireCapability("workspace.access"),
  async (c) => {
    const body = await parseJsonBody(c, dashboardHiddenSchema);
    const db = getDb(getEnv(c.env));
    // Normalised before storage as well as after reading it: the stored order is
    // then the declared order whatever order the boxes were clicked in, and a
    // double-send cannot store the same id twice.
    const hidden = normaliseHiddenPanels(body.hidden);
    const { data, error } = await db.rpc("api_set_dashboard_hidden", {
      p_company_id: c.get("companyId"),
      p_user_id: c.get("userId"),
      p_hidden: hidden,
    });
    if (error) {
      // The membership went away between the context check and this write —
      // deactivated mid-session. Report it as what it is rather than as a
      // failure to save, which would invite a retry that can never work.
      if (error.code === "P0002" || /no active membership/i.test(error.message)) {
        return errorResponse(
          c,
          "forbidden",
          "Not an active member of this company.",
        );
      }
      throw new Error(`dashboard preference save failed: ${error.message}`);
    }
    return c.json({ hidden: normaliseHiddenPanels(data ?? hidden) });
  },
);

// #112: the caller sets their OWN display name (the team sees it everywhere —
// members list, avatars, notes). Company-exempt: the invite flow collects the
// name BEFORE the first membership exists. Upsert mirrors the signup trigger
// (a profiles row may not exist yet for edge-created users).
meRoutes.patch("/me", async (c) => {
  const body = await parseJsonBody(c, updateMeSchema);
  const db = getDb(getEnv(c.env));
  /*
   * #228: only the fields that were SENT.
   *
   * The upsert is what makes this matter. Spreading an absent `display_name`
   * into the row would write the column's default over a name somebody already
   * chose — so a member switching to French would be renamed to nothing. The
   * `locale` half has the same shape and the opposite risk: `null` must reach
   * the database, because that is how a choice is undone.
   */
  const patch: Record<string, unknown> = { user_id: c.get("userId") };
  if (body.display_name !== undefined) patch.display_name = body.display_name;
  if (body.locale !== undefined) patch.locale = body.locale;

  const rows = unwrap<{ display_name: string; locale: string | null }[]>(
    await db
      .from("profiles")
      .upsert(patch, { onConflict: "user_id" })
      .select("display_name,locale"),
    "profile update",
  );
  return c.json({
    display_name: rows[0]?.display_name ?? body.display_name ?? "",
    locale: rows[0]?.locale ?? null,
  });
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
    db.from("profiles").select("display_name,locale").eq("user_id", userId).limit(1),
    db
      .from("company_members")
      .select(
        // #540: `dashboard_hidden` travels HERE rather than on its own route,
        // and that is the whole point. The landing screen has to know which
        // panels are put away before it paints, or it renders the four measures
        // and then removes them a moment later — which is worse than not
        // offering the preference at all. One more column on a select that was
        // already happening costs nothing; a second round trip would cost a
        // flash on every app load.
        // #228: `locale` rides here for the same reason `dashboard_hidden` does —
        // it is one more column on a join already happening, and the app has to
        // know which language to draw itself in BEFORE it paints. A second
        // round trip would cost an English flash on every load for a French
        // workspace, which is the one reader this is for.
        "company_id,role,dashboard_hidden,companies!inner(name,subscription_status,deleted_at,locale)",
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
  const profiles = unwrap<{ display_name: string; locale: string | null }[]>(
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
    // #228: the language the BUSINESS works in — the last step of the app's
    // own locale chain (user > device > company > English).
    locale: row.companies.locale ?? null,
    // #540: normalised on the way out, so an id this build no longer renders is
    // simply not hidden any more rather than a panel the client cannot account
    // for. Clients then need no defensive handling of their own.
    dashboard_hidden: normaliseHiddenPanels(row.dashboard_hidden ?? []),
  }));

  const body: Record<string, unknown> = {
    user_id: userId,
    display_name: profiles[0]?.display_name ?? "",
    /**
     * #228: null means "ask the device, then the workspace" — never English.
     * Sent as null rather than resolved here, because the DEVICE half of the
     * answer only exists on the client and resolving without it would override
     * a phone's own language with a workspace default.
     */
    locale: profiles[0]?.locale ?? null,
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
    // #581: the aal gate this route IS exempt from the middleware for, and is
    // not exempt from the consequences of. `loadCompanyView` returns the exact
    // object GET /v1/company serves from BEHIND that gate, so an aal1 session
    // refused there with `mfa_challenge_required` was reading the same workspace
    // — its name, plan, every number's E.164, the away and emergency copy —
    // one header later. The decision is imported rather than restated: this
    // route already re-implemented the membership half of the exemption, and a
    // hand-written second copy of the MFA half is how the two drift apart.
    //
    // Resolved in PARALLEL with the view rather than before it. A refusal is the
    // rare case and the view is the common one, so gating serially would put an
    // extra round trip on every app load to save work on almost none of them.
    const [stepUp, company] = await Promise.all([
      resolveMfaStepUp(c, parsed.data),
      loadCompanyView(db, parsed.data, env, {
        userId,
        // company_members.role is DB-constrained to the MemberRole union.
        role: membership.role as MemberRole,
      }),
    ]);
    if (!company) {
      return errorResponse(c, "not_found", "No such company.");
    }
    // OMITTED, never refused, and that distinction is the whole care here: the
    // workspace switcher and every MFA recovery path bootstrap from this
    // response, so 403ing it would lock somebody out of the very flow that
    // satisfies the challenge — a low-severity read turned into an outage.
    //
    // Nothing is invented to say so. All three shells learn which of the two
    // walls to draw from GET /v1/company, which answers the code (web:
    // components/shell/mfa-gate.tsx), and `company` is optional in every
    // client's model of this payload because a call without X-Company-Id has
    // always omitted it.
    if (stepUp) return c.json(body);

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
