/**
 * Team routes (SPEC §7, §10):
 *
 *   GET    /v1/members         M   — members + roles + profile display names.
 *   PATCH  /v1/members/:id     O/A — { role: 'admin'|'member' }; the owner
 *          role is never assignable and the owner row is immutable.
 *   DELETE /v1/members/:id     O/A — deactivate (sets deactivated_at, frees
 *          the seat) — never a row delete.
 *   GET    /v1/invites         O/A — list.
 *   POST   /v1/invites         O/A — { email, role }; SEAT FORMULA enforced
 *          here AND at acceptance: active members (deactivated_at IS NULL) +
 *          pending unexpired invites ≤ plan seats, else 409. New addresses get
 *          the Supabase Auth admin invite email (Resend SMTP) with the invite
 *          id in the redirect; an address that ALREADY has an account gets a
 *          direct Resend email carrying the in-app accept link instead (#109 —
 *          Supabase emails nothing for existing users, and asking the inviter
 *          to hand-deliver a link was awful). `email_sent` is false only when
 *          the fallback send itself failed — the UI then offers Copy link.
 *   DELETE /v1/invites/:id     O/A — revoke.
 *   GET    /v1/invites/mine    any (company-exempt) — the caller's own PENDING
 *          invites matched on their CONFIRMED email (citext, case-insensitive),
 *          each carrying the inviting company's name (#109) — powers the
 *          in-app "you've been invited — Join" banner. An unconfirmed email
 *          matches nothing (never act on an unverified address).
 *   POST   /v1/invites/accept  any (company-exempt) — { invite_id }; the
 *          JWT's verified email must equal invites.email; seat re-check with
 *          the same formula; creates the membership AND a notification_prefs
 *          row (defaults true/true).
 */
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import { getEnv, type Env } from "../env";
import { revokeMemberTelephonyCredential } from "./webrtc";
import { ApiError, errorResponse } from "../http/errors";
import { expectOk, parseJsonBody, pathUuid, unwrap } from "./core/http";
import { seatLimit } from "./core/plans";

const MEMBER_COLUMNS = "id,user_id,role,deactivated_at,created_at";
const INVITE_COLUMNS =
  "id,company_id,email,role,invited_by,expires_at,accepted_at,revoked_at,created_at";

const inviteSchema = z.object({
  email: z.email(),
  // Owner is never assignable via invite (SPEC §6 CHECK, §10).
  role: z.enum(["admin", "member"]),
});

const acceptSchema = z.object({
  invite_id: z.uuid(),
});

const roleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

type Db = ReturnType<typeof getDb>;

/**
 * The SPEC §7 seat count: active members + pending unexpired invites.
 * Both creation and acceptance compare this same number to the plan's seats.
 */
async function seatUsage(
  db: Db,
  companyId: string,
): Promise<{ active: number; pending: number }> {
  const members = await db
    .from("company_members")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .is("deactivated_at", null);
  if (members.error) {
    throw new Error(`member count failed: ${members.error.message}`);
  }
  const invites = await db
    .from("invites")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (invites.error) {
    throw new Error(`invite count failed: ${invites.error.message}`);
  }
  return { active: members.count ?? 0, pending: invites.count ?? 0 };
}

async function companyPlan(db: Db, companyId: string): Promise<string | null> {
  const rows = unwrap<{ plan: string | null }[]>(
    await db
      .from("companies")
      .select("plan")
      .eq("id", companyId)
      .is("deleted_at", null)
      .limit(1),
    "company lookup",
  );
  if (!rows[0]) {
    throw new ApiError("not_found", "No such company.");
  }
  return rows[0].plan;
}

export const teamRoutes = new Hono<AppEnv>();

teamRoutes.get("/members", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  interface MemberRow {
    id: string;
    user_id: string;
    role: string;
    deactivated_at: string | null;
    created_at: string;
  }
  const members = unwrap<MemberRow[]>(
    await db
      .from("company_members")
      .select(MEMBER_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("created_at", { ascending: true }),
    "members list",
  );

  // profiles has no FK to company_members, so PostgREST cannot embed it —
  // merge display names with a second query.
  const displayNames = new Map<string, string>();
  if (members.length > 0) {
    const profiles = unwrap<{ user_id: string; display_name: string }[]>(
      await db
        .from("profiles")
        .select("user_id,display_name")
        .in(
          "user_id",
          members.map((m) => m.user_id),
        ),
      "profiles lookup",
    );
    for (const profile of profiles) {
      displayNames.set(profile.user_id, profile.display_name);
    }
  }

  return c.json({
    data: members.map((member) => ({
      ...member,
      display_name: displayNames.get(member.user_id) ?? "",
    })),
    next_cursor: null,
  });
});

teamRoutes.patch("/members/:id", requireRole("admin"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, roleSchema);
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const rows = unwrap<{ id: string; role: string }[]>(
    await db
      .from("company_members")
      .select("id,role")
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "member lookup",
  );
  const target = rows[0];
  if (!target) {
    return errorResponse(c, "not_found", "No such member.");
  }
  if (target.role === "owner") {
    // The owner membership row is immutable (SPEC §10).
    return errorResponse(c, "conflict", "The owner role cannot be changed.");
  }

  const updated = unwrap<Record<string, unknown>[]>(
    await db
      .from("company_members")
      .update({ role: body.role })
      .eq("company_id", companyId)
      .eq("id", id)
      .select(MEMBER_COLUMNS),
    "member role update",
  );
  return c.json(updated[0]);
});

teamRoutes.delete("/members/:id", requireRole("admin"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const rows = unwrap<
    {
      id: string;
      user_id: string;
      role: string;
      deactivated_at: string | null;
    }[]
  >(
    await db
      .from("company_members")
      .select("id,user_id,role,deactivated_at")
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "member lookup",
  );
  const target = rows[0];
  if (!target) {
    return errorResponse(c, "not_found", "No such member.");
  }
  if (target.role === "owner") {
    // The owner membership cannot be deactivated (SPEC §10).
    return errorResponse(c, "conflict", "The owner cannot be deactivated.");
  }

  if (target.deactivated_at === null) {
    expectOk(
      await db
        .from("company_members")
        .update({ deactivated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", id),
      "member deactivate",
    );
    // D43 (#135): a deactivated member's softphone dies with the seat —
    // best-effort (deactivation must never fail on Telnyx weather; the
    // orphaned credential costs nothing and can be re-deleted).
    try {
      await revokeMemberTelephonyCredential(
        getEnv(c.env),
        companyId,
        target.user_id,
      );
    } catch (cause) {
      console.error(
        `softphone revoke on deactivation failed for member ${id}:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  return c.body(null, 204);
});

teamRoutes.get("/invites", requireRole("admin"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<unknown[]>(
    await db
      .from("invites")
      .select(INVITE_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("created_at", { ascending: false }),
    "invites list",
  );
  return c.json({ data: rows, next_cursor: null });
});

teamRoutes.post("/invites", requireRole("admin"), async (c) => {
  const body = await parseJsonBody(c, inviteSchema);
  const companyId = c.get("companyId");
  const env = getEnv(c.env);
  const db = getDb(env);

  const plan = await companyPlan(db, companyId);
  const seats = seatLimit(plan);
  const { active, pending } = await seatUsage(db, companyId);
  if (active + pending + 1 > seats) {
    return errorResponse(
      c,
      "conflict",
      `Seat limit reached: ${seats} seats on the ${plan ?? "starter"} plan ` +
        `(${active} active members, ${pending} pending invites).`,
    );
  }

  const inserted = unwrap<Record<string, unknown>[]>(
    await db
      .from("invites")
      .insert({
        company_id: companyId,
        email: body.email,
        role: body.role,
        invited_by: c.get("userId"),
      })
      .select(INVITE_COLUMNS),
    "invite create",
    "A pending invite for this email already exists.",
  );
  const invite = inserted[0];

  // Supabase Auth admin invite (Resend custom SMTP, SPEC §10). The redirect
  // carries the invite id the accept screen posts back.
  let emailSent = true;
  const { error } = await db.auth.admin.inviteUserByEmail(body.email, {
    redirectTo: `${env.APP_ORIGIN}/invites/accept?invite_id=${invite.id as string}`,
  });
  if (error) {
    const alreadyRegistered =
      error.code === "email_exists" || error.status === 422;
    if (!alreadyRegistered) {
      // Roll the invite back so the seat is not held by an email that was
      // never notified, then surface the failure.
      expectOk(
        await db.from("invites").delete().eq("id", invite.id as string),
        "invite rollback",
      );
      throw new Error(`invite email failed: ${error.message}`);
    }
    // #109: the address already has a Loonext account — GoTrue's
    // inviteUserByEmail refuses those and emails NOTHING. Send the invite
    // ourselves over Resend with the in-app accept link (the same /invite/:id
    // page the Copy-link button shares), so the inviter never has to
    // hand-deliver it. Only a failure of THIS send degrades to
    // email_sent:false — the invite row stands either way, so Copy link
    // always remains the fallback.
    emailSent = await sendExistingAccountInvite(db, env, {
      email: body.email,
      inviteId: invite.id as string,
      companyId,
    });
  }

  return c.json({ ...invite, email_sent: emailSent }, 201);
});

/**
 * #109: the direct invite email for an address that already has a Loonext
 * account. Plain-language copy + the in-app accept link; returns whether it
 * landed. A failure is NOT fatal — the invite row stands and the UI offers
 * the Copy-link fallback, so the seat is never held silently.
 */
async function sendExistingAccountInvite(
  db: Db,
  env: Env,
  args: { email: string; inviteId: string; companyId: string },
): Promise<boolean> {
  try {
    const rows = unwrap<{ name: string | null }[]>(
      await db
        .from("companies")
        .select("name")
        .eq("id", args.companyId)
        .limit(1),
      "company name lookup",
    );
    const company = rows[0]?.name?.trim() || "a Loonext workspace";
    const link = `${env.APP_ORIGIN}/invite/${args.inviteId}`;
    const text =
      `You've been invited to join ${company} on Loonext.\n\n` +
      `You already have a Loonext account — log in and accept here:\n` +
      `${link}\n\n` +
      `This invite expires in 7 days.\n`;
    await sendEmail(env, {
      to: [args.email],
      subject: `You've been invited to join ${company} on Loonext`,
      text,
      html: emailLayout(
        `<p>You've been invited to join <strong>${escapeHtml(company)}</strong> on Loonext.</p>` +
          `<p>You already have a Loonext account — log in and accept here:</p>` +
          `<p><a href="${link}" style="color:#2740de;text-decoration:underline;">Accept the invite</a></p>` +
          `<p style="font-size:14px;color:#7a828c;">This invite expires in 7 days.</p>`,
      ),
    });
    return true;
  } catch (cause) {
    // Never-silent (D3), but non-fatal: the invite stands, Copy link covers it.
    console.error(
      `existing-account invite email failed (${args.inviteId}): ${String(cause)}`,
    );
    return false;
  }
}

teamRoutes.delete("/invites/:id", requireRole("admin"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const rows = unwrap<{ id: string }[]>(
    await db
      .from("invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id"),
    "invite revoke",
  );
  if (rows.length === 0) {
    return errorResponse(c, "not_found", "No pending invite to revoke.");
  }
  return c.body(null, 204);
});

// Company-exempt (SPEC §7): the invitee may not be a member of any company yet.
// #109: the caller's own PENDING invites, matched on their CONFIRMED email —
// the self-serve discovery path for existing accounts (the "you've been
// invited — Join" banner). Each row carries the inviting company's name so the
// banner can say who's asking.
teamRoutes.get("/invites/mine", async (c) => {
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  // The JWT carries only `sub`; the authoritative email + confirmation state
  // come from the Auth admin API (same rule as the accept route). An
  // unconfirmed email matches NOTHING — never surface invites for an address
  // the caller hasn't proven they own.
  const { data: userData, error: userError } =
    await db.auth.admin.getUserById(userId);
  if (userError || !userData?.user) {
    throw new Error(
      `auth user lookup failed: ${userError?.message ?? "no user"}`,
    );
  }
  const user = userData.user;
  if (!user.email || !user.email_confirmed_at) {
    return c.json({ data: [] });
  }

  interface MyInviteRow {
    companies: { name: string | null } | null;
    [key: string]: unknown;
  }
  // invites.email is citext → the eq match is case-insensitive at the DB.
  const rows = unwrap<MyInviteRow[]>(
    await db
      .from("invites")
      .select(`${INVITE_COLUMNS},companies(name)`)
      .eq("email", user.email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    "my invites",
  );
  const data = rows.map(({ companies, ...invite }) => ({
    ...invite,
    company_name: companies?.name ?? null,
  }));
  return c.json({ data });
});

// Company-exempt (SPEC §7): the caller is not yet a member.
teamRoutes.post("/invites/accept", async (c) => {
  const body = await parseJsonBody(c, acceptSchema);
  const userId = c.get("userId");
  const db = getDb(getEnv(c.env));

  interface InviteRow {
    id: string;
    company_id: string;
    email: string;
    role: string;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  }
  const invites = unwrap<InviteRow[]>(
    await db.from("invites").select(INVITE_COLUMNS).eq("id", body.invite_id).limit(1),
    "invite lookup",
  );
  const invite = invites[0];
  if (!invite) {
    return errorResponse(c, "not_found", "No such invite.");
  }
  if (
    invite.accepted_at !== null ||
    invite.revoked_at !== null ||
    new Date(invite.expires_at).getTime() <= Date.now()
  ) {
    return errorResponse(
      c,
      "conflict",
      "This invite is no longer valid (accepted, revoked, or expired).",
    );
  }

  // Email-match rule (SPEC §7): the JWT's VERIFIED email must equal the
  // invite's email. The token carries only `sub`; the authoritative email +
  // confirmation state come from the Auth admin API.
  const { data: userData, error: userError } =
    await db.auth.admin.getUserById(userId);
  if (userError || !userData?.user) {
    throw new Error(
      `auth user lookup failed: ${userError?.message ?? "no user"}`,
    );
  }
  const user = userData.user;
  if (
    !user.email ||
    !user.email_confirmed_at ||
    user.email.toLowerCase() !== invite.email.toLowerCase()
  ) {
    return errorResponse(
      c,
      "forbidden",
      "This invite was issued to a different email address.",
    );
  }

  // Seat re-check, same formula (this invite is itself one of the pending
  // rows, so the comparison is against the plan's seats directly).
  const plan = await companyPlan(db, invite.company_id);
  const seats = seatLimit(plan);
  const { active, pending } = await seatUsage(db, invite.company_id);
  if (active + pending > seats) {
    return errorResponse(
      c,
      "conflict",
      `Seat limit reached: ${seats} seats on the ${plan ?? "starter"} plan.`,
    );
  }

  const memberRows = unwrap<Record<string, unknown>[]>(
    await db
      .from("company_members")
      .insert({
        company_id: invite.company_id,
        user_id: userId,
        role: invite.role,
      })
      .select(MEMBER_COLUMNS),
    "membership create",
    "Already a member of this company.",
  );

  // notification_prefs row, defaults true/true (SPEC §7).
  expectOk(
    await db
      .from("notification_prefs")
      .upsert(
        {
          user_id: userId,
          company_id: invite.company_id,
          email_enabled: true,
          push_enabled: true,
        },
        { onConflict: "user_id,company_id", ignoreDuplicates: true },
      ),
    "notification_prefs create",
  );

  expectOk(
    await db
      .from("invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id),
    "invite accept stamp",
  );

  return c.json(
    { ...memberRows[0], company_id: invite.company_id },
    201,
  );
});
