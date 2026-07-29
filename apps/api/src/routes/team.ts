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

import { recordAuditFromRequest } from "../audit/log";
import { billingRecipients } from "../billing/recipients";
import { renderEmailHtml } from "../email/html";
import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import { getEnv, type Env } from "../env";
import { revokeMemberTelephonyCredential } from "./webrtc";
import { ApiError, errorResponse } from "../http/errors";
import {
  expectOk,
  isUniqueViolation,
  parseJsonBody,
  parseWith,
  pathUuid,
  unwrap,
} from "./core/http";
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
  // #231: who can do what is the first thing anyone reconstructs after an
  // incident.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "member.role_changed",
    targetType: "member",
    targetId: id,
    before: { role: target.role },
    after: { role: body.role },
  });
  return c.json(updated[0]);
});

/**
 * #276: what a member is holding, so the offboarding flow can ask where it
 * should go instead of silently orphaning it. Also takes any member — including
 * one deactivated long ago — which is how an owner finds work already left
 * behind by people who have gone.
 */
teamRoutes.get("/members/:id/holdings", requireRole("admin"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const rows = unwrap<{ user_id: string }[]>(
    await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("id", id)
      .limit(1),
    "member lookup",
  );
  if (!rows[0]) return errorResponse(c, "not_found", "No such member.");

  const { data, error } = await db.rpc("api_member_holdings", {
    p_company_id: companyId,
    p_user_id: rows[0].user_id,
  });
  if (error) throw new Error(`api_member_holdings failed: ${error.message}`);
  const holdings = data as { conversations: number; tasks: number };
  return c.json({
    conversations: Number(holdings.conversations ?? 0),
    tasks: Number(holdings.tasks ?? 0),
  });
});

/** Where a leaver's open work goes. Omitted = released to the whole crew. */
const offboardSchema = z.object({
  reassign_to: z.uuid().nullable().optional(),
});

/**
 * DELETE /v1/members/me (#406) — leave this workspace yourself.
 *
 * Every membership action was something done TO a member and never BY one, so
 * a tech who quit on Friday still had the customer list on Monday: the app kept
 * working until an owner — running a business, not administering software —
 * remembered to open settings. **The person with the strongest reason to sever
 * the connection was the only one who could not.**
 *
 * D48 gave the BUSINESS a way out. This is the one for the PERSON.
 *
 * Reuses `offboard_member` rather than adding a second path, so the soft-mark,
 * the reassignment, the session clearing and the attribution-preservation are
 * identical to an owner removing someone. Two ways to leave that behaved
 * slightly differently is how #383 happened.
 *
 * The work is RELEASED to unassigned rather than handed to a named person: the
 * one leaving should not be choosing who inherits, and unassigned is visible in
 * triage rather than pointing at somebody who is gone.
 *
 * The owner cannot use this. Their row is immutable and untransferable, which
 * is #332's problem — a self-leave that stranded a workspace with no owner
 * would be worse than the gap it closed.
 */
teamRoutes.delete("/members/me", requireRole("member"), async (c) => {
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const env = getEnv(c.env);
  const db = getDb(env);

  const rows = unwrap<{ id: string; role: string }[]>(
    await db
      .from("company_members")
      .select("id,role")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .limit(1),
    "own membership lookup",
  );
  const membership = rows[0];
  if (!membership) {
    return errorResponse(c, "not_found", "You are not on this workspace.");
  }
  if (membership.role === "owner") {
    return errorResponse(
      c,
      "conflict",
      "An owner can't leave their own workspace. Close it in settings, or contact us to move it to someone else.",
    );
  }

  const { data, error } = await db.rpc("offboard_member", {
    p_company_id: companyId,
    p_member_id: membership.id,
    p_reassign_to: null,
  });
  if (error) throw new Error(`offboard_member failed: ${error.message}`);
  const result = data as {
    outcome: "deactivated" | "already" | "not_found" | "owner" | "bad_destination";
    conversations?: number;
    tasks?: number;
  };
  if (result.outcome === "not_found" || result.outcome === "owner") {
    return errorResponse(c, "conflict", "You can't leave this workspace.");
  }

  const moved = {
    conversations: Number(result.conversations ?? 0),
    tasks: Number(result.tasks ?? 0),
  };

  // Same best-effort tail as an owner-initiated removal, and for the same
  // reason: leaving has to mean the access is over, not that the name is
  // hidden from a list (#236).
  try {
    await revokeMemberTelephonyCredential(env, companyId, userId);
  } catch (cause) {
    console.error(
      `softphone revoke on self-leave failed for user ${userId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  const ended = await endMemberAccess(db, userId);

  await recordAuditFromRequest(db, c, {
    companyId,
    action: "member.left",
    targetType: "member",
    targetId: membership.id,
    before: { active: true },
    after: {
      active: false,
      self: true,
      conversations_released: moved.conversations,
      tasks_released: moved.tasks,
      sessions_ended: ended.sessions,
      push_devices_removed: ended.devices,
    },
  });

  // #406 ask 3: a seat just freed and work just landed in triage. The owner
  // should not learn that by noticing threads going unanswered.
  await notifyOwnerOfDeparture(env, db, companyId, userId, moved);

  return c.json({
    conversations_released: moved.conversations,
    tasks_released: moved.tasks,
    sessions_ended: ended.sessions,
    push_devices_removed: ended.devices,
  });
});

/**
 * Tell the owner and admins somebody left. Best-effort: the person IS out by
 * the time this runs, and failing the request would say otherwise.
 */
async function notifyOwnerOfDeparture(
  env: Env,
  db: Db,
  companyId: string,
  userId: string,
  moved: { conversations: number; tasks: number },
): Promise<void> {
  try {
    const [{ data: user }, companies, to] = await Promise.all([
      db.auth.admin.getUserById(userId),
      db.from("companies").select("name").eq("id", companyId).limit(1),
      billingRecipients(env, companyId, db),
    ]);
    if (to.length === 0) return;
    const who = user?.user?.email ?? "A member";
    const name = (companies.data?.[0] as { name?: string } | undefined)?.name ?? "your workspace";
    const text =
      `Hi,

${who} has left ${name}. Their access ended immediately and ` +
      `their seat is free.

` +
      (moved.conversations > 0 || moved.tasks > 0
        ? `${moved.conversations} open conversation(s) and ${moved.tasks} task(s) ` +
          `they were working are now unassigned, so they show up for the team ` +
          `to pick up rather than sitting with somebody who has gone.

`
        : `Nothing they were working was still open.

`) +
      `Everything they sent stays on the record under their name.

Loonext`;
    await sendEmail(env, {
      to,
      subject: `${who} has left ${name}`,
      text,
      html: renderEmailHtml(text),
    });
  } catch (cause) {
    console.error(
      `owner notification on self-leave failed for company ${companyId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

teamRoutes.delete("/members/:id", requireRole("admin"), async (c) => {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const env = getEnv(c.env);
  const db = getDb(env);

  // #276: the destination rides as a query param so DELETE keeps its shape for
  // every existing client. Omitting it RELEASES the work to unassigned, which
  // is a real choice a person can make — what is not on the table any more is
  // leaving it pointing at someone who is gone.
  const query = parseWith(offboardSchema, c.req.query());

  const { data, error } = await db.rpc("offboard_member", {
    p_company_id: companyId,
    p_member_id: id,
    p_reassign_to: query.reassign_to ?? null,
  });
  if (error) throw new Error(`offboard_member failed: ${error.message}`);
  const result = data as {
    outcome: "deactivated" | "already" | "not_found" | "owner" | "bad_destination";
    user_id?: string;
    conversations?: number;
    tasks?: number;
  };

  if (result.outcome === "not_found") {
    return errorResponse(c, "not_found", "No such member.");
  }
  if (result.outcome === "owner") {
    // The owner membership cannot be deactivated (SPEC §10).
    return errorResponse(c, "conflict", "The owner cannot be deactivated.");
  }
  if (result.outcome === "bad_destination") {
    return errorResponse(
      c,
      "validation_failed",
      "Hand the work to someone who is still on the team, or leave it unassigned.",
    );
  }

  const userId = result.user_id as string;
  const moved = {
    conversations: Number(result.conversations ?? 0),
    tasks: Number(result.tasks ?? 0),
  };

  // Removing someone has to mean their access is over, not that they are
  // hidden from lists (#236). All three are best-effort AFTER the atomic
  // deactivate+reassign above: a Telnyx or GoTrue blip must not leave the
  // member half-removed, and every one of these is safely repeatable.
  try {
    // D43 (#135): the softphone dies with the seat.
    await revokeMemberTelephonyCredential(env, companyId, userId);
  } catch (cause) {
    console.error(
      `softphone revoke on deactivation failed for member ${id}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  const ended = await endMemberAccess(db, userId);

  // #231/#276: the offboarding and everything it moved, on the record.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "member.deactivated",
    targetType: "member",
    targetId: id,
    before: { active: result.outcome === "deactivated" },
    after: {
      active: false,
      reassigned_to: query.reassign_to ?? null,
      conversations_moved: moved.conversations,
      tasks_moved: moved.tasks,
      sessions_ended: ended.sessions,
      push_devices_removed: ended.devices,
    },
  });

  return c.json({
    conversations_moved: moved.conversations,
    tasks_moved: moved.tasks,
    sessions_ended: ended.sessions,
    push_devices_removed: ended.devices,
  });
});

/**
 * #236/#276: end the person's sessions and stop push reaching their devices.
 *
 * Best-effort and never throws — the member IS deactivated by the time this
 * runs, and failing the request would tell the owner the removal did not
 * happen when it did. Each step is safely repeatable, so a retry (or the next
 * removal attempt) finishes the job.
 */
async function endMemberAccess(
  db: Db,
  userId: string,
): Promise<{ sessions: number; devices: number }> {
  let sessions = 0;
  let devices = 0;
  try {
    const { data, error } = await db.rpc("api_revoke_user_sessions", {
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
    sessions = Number(data ?? 0);
  } catch (cause) {
    console.error(
      `session revoke on deactivation failed for user ${userId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  // Push rows are per person, not per company: a token left behind keeps
  // delivering another workspace's customer messages to a phone we have just
  // said goodbye to (the same leak #264 fixed on the web).
  for (const table of ["push_subscriptions", "device_push_tokens"] as const) {
    const { data, error } = await db
      .from(table)
      .delete()
      .eq("user_id", userId)
      .select("id");
    if (error) {
      console.error(`${table} cleanup on deactivation failed:`, error.message);
      continue;
    }
    devices += (data ?? []).length;
  }
  return { sessions, devices };
}

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

  // #231: an invite is the front door — who opened it, for whom, at what role.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "member.invited",
    targetType: "invite",
    targetId: invite.id as string,
    after: { email: body.email, role: body.role, email_sent: emailSent },
  });

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
          `<p><a href="${link}" style="color:#66801F;text-decoration:underline;">Accept the invite</a></p>` +
          `<p style="font-size:14px;color:#6E7163;">This invite expires in 7 days.</p>`,
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
  await recordAuditFromRequest(db, c, {
    companyId: c.get("companyId"),
    action: "member.invite_revoked",
    targetType: "invite",
    targetId: id,
  });
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
  const env = getEnv(c.env);
  const db = getDb(env);

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

  const insertResult = await db
    .from("company_members")
    .insert({
      company_id: invite.company_id,
      user_id: userId,
      role: invite.role,
    })
    .select(MEMBER_COLUMNS);

  let memberRows: Record<string, unknown>[];
  if (isUniqueViolation(insertResult.error)) {
    // A membership row already exists — but "exists" is two different states.
    //
    // #383: offboarding (#276) does NOT delete this row. It stamps
    // `deactivated_at`, deliberately, because message attribution and audit
    // history point at it. Re-inviting someone who left is the supported way
    // back in, so refusing on the mere existence of the row locked them out
    // of a workspace they had been invited to rejoin, with "already a member"
    // and no access — the two features were correct alone and disagreed here.
    const existing = unwrap<
      { id: string; deactivated_at: string | null }[]
    >(
      await db
        .from("company_members")
        .select(MEMBER_COLUMNS)
        .eq("company_id", invite.company_id)
        .eq("user_id", userId)
        .limit(1),
      "membership lookup",
    );
    const priorMembership = existing[0];

    if (!priorMembership || priorMembership.deactivated_at === null) {
      // Genuinely an active member: a duplicate or stale invite. Consume the
      // invite so it stops counting toward the seat cap — otherwise it lingers
      // as a phantom pending seat that can block a real invite — then 409.
      await db
        .from("invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
      return errorResponse(c, "conflict", "Already a member of this company.");
    }

    // They left and were invited back. Clear the mark and take the role from
    // THIS invite, not the one they held before — whoever re-invited them
    // chose it, and a returning admin should not silently regain admin.
    memberRows = unwrap<Record<string, unknown>[]>(
      await db
        .from("company_members")
        .update({ deactivated_at: null, role: invite.role })
        .eq("id", priorMembership.id)
        .select(MEMBER_COLUMNS),
      "membership reactivate",
    );
  } else {
    memberRows = unwrap<Record<string, unknown>[]>(
      insertResult,
      "membership create",
    );
  }

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

  // #231: the moment someone gains access. The actor is the joiner, which is
  // the truth of it — the inviter's row was written when they opened the door.
  await recordAuditFromRequest(db, c, {
    companyId: invite.company_id,
    action: "member.joined",
    targetType: "member",
    targetId: memberRows[0].id as string,
    after: { role: invite.role, invite_id: invite.id },
  });

  // #332: the workspace just stopped being a one-person operation, so there
  // is now somebody to name. Asking once, here, is far cheaper than the
  // human-in-the-loop recovery procedure an unreachable owner would otherwise
  // need — and this is the only moment where the ask is both warranted and
  // unmissable. The SQL claims it, so two invites accepted in the same second
  // cannot produce two emails.
  await promptForBackupOwner(env, db, invite.company_id);

  return c.json(
    { ...memberRows[0], company_id: invite.company_id },
    201,
  );
});

/**
 * Best-effort and never throws: somebody has just joined a workspace, and a
 * Resend outage must not turn that into a failed invite acceptance.
 */
async function promptForBackupOwner(
  env: Env,
  db: Db,
  companyId: string,
): Promise<void> {
  try {
    const { data, error } = await db.rpc("api_claim_backup_owner_prompt", {
      p_company_id: companyId,
    });
    if (error) throw new Error(error.message);
    const ownerUserId = typeof data === "string" ? data : null;
    if (!ownerUserId) return; // already asked, already named, or still solo

    const { data: userData } = await db.auth.admin.getUserById(ownerUserId);
    const to = userData?.user?.email;
    if (!to) return;

    const rows = unwrap<{ name: string }[]>(
      await db.from("companies").select("name").eq("id", companyId).limit(1),
      "company name lookup",
    );
    const name = rows[0]?.name ?? "your workspace";
    const text =
      `${name} has more than one person on it now, which is a good moment to ` +
      "name a backup owner.\n\n" +
      "You are the only person who can change billing, lift the spending cap, " +
      "or manage your numbers. If you ever cannot get in — you lose access to " +
      "your email, or worse — nobody else can do any of it, and sorting that " +
      "out takes us weeks of verification.\n\n" +
      "Naming a backup takes ten seconds and changes nothing today. If you " +
      "are ever unreachable, that one person can ask to take over; you get a " +
      "week to say no, and everybody on the team is told.\n\n" +
      `${env.APP_ORIGIN}/settings/team`;

    await sendEmail(env, {
      to,
      subject: `Name a backup owner for ${name}`,
      text,
      html: renderEmailHtml(text),
    });
  } catch (cause) {
    console.error(
      `backup-owner prompt failed for company ${companyId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
