import { ASSIGNABLE_ROLES } from "@loonext/shared";
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
 *          a Resend email with a Supabase verification link. Existing users
 *          receive the in-app accept link. If that send fails, `email_sent`
 *          is false and the UI offers Copy link.
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
import { isDowngrade, roleHasCapability, SELF_DOWNGRADE_ACK, SELF_DOWNGRADE_REQUIRED_MESSAGE_KEY, shouldShowOrientation, stateMachines } from '@loonext/shared';
import type { MemberRole } from '@loonext/shared';
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { billingRecipients } from "../billing/recipients";
import { emailLayout,escapeHtml,renderEmailHtml } from "../email/html";
import { capture } from "../analytics/posthog";
import { requireCapability } from "../auth/company";
import { revokeSessions } from "../auth/revoke-sessions";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import { getEnv } from '../env';
import type { Env } from '../env';
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

const SELF_DOWNGRADE_REQUIRED_MESSAGE =
  "Confirm that you understand what you're giving up before changing your own role.";

const MEMBER_COLUMNS = "id,user_id,role,deactivated_at,created_at";
const INVITE_COLUMNS =
  "id,company_id,email,role,invited_by,expires_at,accepted_at,revoked_at,created_at," +
  // #521: the inviter's own words. Read by the team list so an owner can see
  // what they said, and by the accept path so it can reach the new member.
  "note";

const inviteSchema = z.object({
  email: z.email(),
  role: z.enum(ASSIGNABLE_ROLES),
  /**
   * #521: why this person is being added, in the inviter's own words.
   *
   * Trimmed to null rather than kept as an empty string, so "left blank" and
   * "typed spaces" are the same thing to everything downstream - the email
   * decides whether to render a paragraph by asking whether there is a note,
   * and `''` would answer yes.
   *
   * 500 matches the column's check constraint. Enforced here too so an
   * over-long note is a 422 naming the field rather than a constraint
   * violation arriving as a 500.
   */
  note: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((value) => (value || null)),
});

const acceptSchema = z.object({
  invite_id: z.uuid(),
});

const roleSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
  /**
   * #538: the caller has seen what they are giving up.
   *
   * Only required when the target is the CALLER and the change takes something
   * away — see the route. Optional here so promoting somebody else, which is the
   * overwhelming majority of calls, needs no new field.
   */
  [SELF_DOWNGRADE_ACK]: z.boolean().optional(),
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

teamRoutes.get("/members", requireCapability("workspace.access"), async (c) => {
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

teamRoutes.patch("/members/:id", requireCapability("team.manage"), async (c) => {
  const id = pathUuid(c, "id");
  const body = await parseJsonBody(c, roleSchema);
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  const rows = unwrap<{ id: string; role: string; user_id: string }[]>(
    await db
      .from("company_members")
      // #538: `user_id` so the route can tell "changing somebody" from "changing
      // myself", which are the same request with very different consequences.
      .select("id,role,user_id")
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

  // #538 — TAKING POWERS OFF YOURSELF HAS TO BE DELIBERATE.
  //
  // An admin setting their own role to member loses `team.manage` in the same
  // stroke, which is the capability that would let them change it back. The way
  // out is to find an owner. Nothing asked and nothing warned, so a dropdown
  // could cost an afternoon.
  //
  // Enforced HERE rather than only in a dialog, because a warning that lives in
  // one client is a warning the other two skip. The acknowledgement is the
  // server's evidence that somebody was actually told.
  //
  // Only for the caller's OWN row: an owner demoting an admin is a decision about
  // somebody else, they can undo it, and asking them to tick a box about access
  // they are not losing would be a lie.
  const isSelf = target.user_id === c.get("userId");
  const downgrade = isDowngrade(
    target.role as MemberRole,
    body.role,
  );
  if (isSelf && downgrade && body[SELF_DOWNGRADE_ACK] !== true) {
    return errorResponse(
      c,
      "validation_failed",
      SELF_DOWNGRADE_REQUIRED_MESSAGE,
      { key: SELF_DOWNGRADE_REQUIRED_MESSAGE_KEY },
    );
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
  /**
   * #581 — a role change that takes away the phone has to take the phone away.
   *
   * The softphone credential is minted once and lives at Telnyx; the token cut
   * from it is good for up to 24 hours and neither is re-checked against the
   * member's role. So demoting somebody to `read_only` or `bookkeeper` removed
   * their inbox access immediately and left them able to place and answer calls
   * as the business until that token expired — which is the whole of the next
   * working day, and precisely the window a demotion exists to close.
   *
   * Only when the new role actually loses the capability, so an owner→admin
   * change (both of which keep it) does not sign a working colleague out of
   * their softphone mid-call for no reason.
   *
   * Best-effort by the same reasoning the deactivation path already uses: a
   * Telnyx outage must not make a role change fail. The ring audience above now
   * filters on the same capability, so even an orphaned credential stops being
   * offered a call.
   */
  if (
    roleHasCapability(target.role as MemberRole, "conversations.send") &&
    !roleHasCapability(body.role, "conversations.send")
  ) {
    await revokeMemberTelephonyCredential(
      getEnv(c.env),
      companyId,
      target.user_id,
    );
  }

  // #231: who can do what is the first thing anyone reconstructs after an
  // incident.
  await recordAuditFromRequest(db, c, {
    companyId,
    // #538: a distinct action for the self-downgrade. "Who took this admin's
    // access away" is the first question after an incident, and an entry that
    // reads the same whether somebody was demoted or demoted themselves cannot
    // answer it.
    action:
      isSelf && downgrade ? "member.self_downgraded" : "member.role_changed",
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
teamRoutes.get("/members/:id/holdings", requireCapability("team.manage"), async (c) => {
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
    conversations: (holdings.conversations ?? 0),
    tasks: (holdings.tasks ?? 0),
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
teamRoutes.delete("/members/me", requireCapability("workspace.access"), async (c) => {
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
    conversations: (result.conversations ?? 0),
    tasks: (result.tasks ?? 0),
  };

  // Same best-effort tail as an owner-initiated removal, and for the same
  // reason: leaving has to mean the access is over, not that the name is
  // hidden from a list (#236).
  try {
    await revokeMemberTelephonyCredential(env, companyId, userId);
  } catch (error_) {
    console.error(
      `softphone revoke on self-leave failed for user ${userId}:`,
      error_ instanceof Error ? error_.message : String(error_),
    );
  }
  const ended = await endMemberAccess(db, env, userId);

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
      // A softphone that kept ringing after somebody was removed is exactly the
      // kind of thing asked about weeks later, so the number is on the record.
      voice_credentials_revoked: ended.voice,
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
      billingRecipients(env, companyId, db, "team.manage"),
    ]);
    if (to.length === 0) return;
    const who = user?.user?.email ?? "A member";
    const name = (companies.data?.[0] as { name?: string } | undefined)?.name ?? "your workspace";
    const text =
      `Hi,

${who} has left ${name}. Their access ended immediately and ` +
      `their seat is free.

${ 
      moved.conversations > 0 || moved.tasks > 0
        ? `${moved.conversations} open conversation(s) and ${moved.tasks} task(s) ` +
          `they were working are now unassigned, so they show up for the team ` +
          `to pick up rather than sitting with somebody who has gone.

`
        : `Nothing they were working was still open.

` 
      }Everything they sent stays on the record under their name.

Loonext`;
    await sendEmail(env, {
      to,
      subject: `${who} has left ${name}`,
      text,
      html: renderEmailHtml(text),
    });
  } catch (error) {
    console.error(
      `owner notification on self-leave failed for company ${companyId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

teamRoutes.delete("/members/:id", requireCapability("team.manage"), async (c) => {
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

  const userId = result.user_id!;
  const moved = {
    conversations: (result.conversations ?? 0),
    tasks: (result.tasks ?? 0),
  };

  // Removing someone has to mean their access is over, not that they are
  // hidden from lists (#236). All three are best-effort AFTER the atomic
  // deactivate+reassign above: a Telnyx or GoTrue blip must not leave the
  // member half-removed, and every one of these is safely repeatable.
  try {
    // D43 (#135): the softphone dies with the seat.
    await revokeMemberTelephonyCredential(env, companyId, userId);
  } catch (error_) {
    console.error(
      `softphone revoke on deactivation failed for member ${id}:`,
      error_ instanceof Error ? error_.message : String(error_),
    );
  }
  const ended = await endMemberAccess(db, env, userId);

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
      // A softphone that kept ringing after somebody was removed is exactly the
      // kind of thing asked about weeks later, so the number is on the record.
      voice_credentials_revoked: ended.voice,
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
  env: Env,
  userId: string,
): Promise<{ sessions: number; devices: number; voice: number }> {
  let sessions = 0;
  let devices = 0;
  let voice = 0;
  try {
    // Through the shared path, which also deletes softphone credentials at Telnyx.
    //
    // The caller has already deleted the credential for THIS workspace
    // (`revokeMemberTelephonyCredential`, which is company-scoped). Revoking
    // sessions is not company-scoped — a session belongs to the person, not to one
    // workspace — so the sweep behind this call deletes the rows for every OTHER
    // workspace they belong to as well. Those ids used to be thrown away by
    // `api_revoke_user_sessions`, a wrapper that returns a bare count, and the
    // credentials stayed alive at Telnyx: a phone that had already registered went
    // on ringing for those workspaces and could answer a customer as the business.
    const result = await revokeSessions(db, env, {
      userId,
      sessionIds: null,
      except: null,
      actor: null,
      reason: "member_removed",
    });
    sessions = result.sessions;
    devices += result.devices;
    voice = result.voice;
  } catch (error) {
    console.error(
      `session revoke on deactivation failed for user ${userId}:`,
      error instanceof Error ? error.message : String(error),
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
  return { sessions, devices, voice };
}

type InviteRow = {
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
};

/** The derived invite state; the same rule as SQL invite_state(). */
function inviteState(row: InviteRow, now: Date): stateMachines.InviteState {
  if (row.accepted_at !== null) return "accepted";
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at !== null && new Date(row.expires_at).getTime() <= now.getTime()) {
    return "expired";
  }
  return "pending";
}

teamRoutes.get("/invites", requireCapability("team.manage"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<InviteRow[]>(
    await db
      .from("invites")
      .select(INVITE_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("created_at", { ascending: false }),
    "invites list",
  );
  const role = c.get("role") as MemberRole;
  const now = new Date();
  return c.json({
    data: rows.map((row) => ({
      ...row,
      // #722: what this member may do to the invite now, from the shared machine.
      allowed_actions: stateMachines.allowedActions(
        stateMachines.inviteMachine,
        inviteState(row, now),
        role,
      ),
    })),
    next_cursor: null,
  });
});

teamRoutes.post("/invites", requireCapability("team.manage"), async (c) => {
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
        note: body.note ?? null,
        invited_by: c.get("userId"),
      })
      .select(INVITE_COLUMNS),
    "invite create",
    "A pending invite for this email already exists.",
  );
  const invite = inserted[0];

  const inviteId = invite.id as string;
  const { data: linkData, error } = await db.auth.admin.generateLink({
    type: "invite",
    email: body.email,
  });
  const alreadyRegistered = error?.code === "email_exists" || error?.status === 422;
  const tokenHash = linkData.properties?.hashed_token;
  let emailSent = false;
  if (alreadyRegistered || tokenHash) {
    const acceptPath = `/invite/${inviteId}`;
    const link = new URL(alreadyRegistered ? acceptPath : "/auth/confirm", env.APP_ORIGIN);
    if (!alreadyRegistered && tokenHash) {
      link.searchParams.set("token_hash", tokenHash);
      link.searchParams.set("type", "invite");
      link.searchParams.set("next", acceptPath);
    }
    emailSent = await sendWorkspaceInvite(db, env, {
      email: body.email,
      inviteId,
      companyId,
      link: link.href,
      note: body.note ?? null,
      invitedBy: c.get("userId"),
    });
  }
  if (!alreadyRegistered && !emailSent) {
    expectOk(
      await db.from("invites").delete().eq("company_id", companyId).eq("id", inviteId),
      "invite rollback",
    );
    throw new Error("Invite email could not be sent.");
  }

  // #231: an invite is the front door — who opened it, for whom, at what role.
  await recordAuditFromRequest(db, c, {
    companyId,
    action: "member.invited",
    targetType: "invite",
    targetId: inviteId,
    after: { email: body.email, role: body.role, email_sent: emailSent },
  });

  // #281 item 3: the approved-to-first-send span was one opaque window, and
  // inviting the crew is one of the two things a workspace actually does inside
  // it. Emitted per invite rather than once per workspace: a workspace sends a
  // handful ever, PostHog funnels read the first occurrence, and two more
  // stamped columns to save a few events would be the wrong trade. The ROLE is
  // the interesting property — inviting an admin is a different act from
  // inviting a tech.
  await capture(env, "team_invited", companyId, { role: body.role });

  return c.json({ ...invite, email_sent: emailSent }, 201);
});

async function sendWorkspaceInvite(
  db: Db,
  env: Env,
  args: {
    email: string;
    inviteId: string;
    companyId: string;
    link: string;
    note: string | null;
    invitedBy: string;
  },
): Promise<boolean> {
  try {
    const [companies, profiles] = await Promise.all([
      db
        .from("companies")
        .select("name,locale")
        .eq("id", args.companyId)
        .limit(1),
      db
        .from("profiles")
        .select("display_name")
        .eq("user_id", args.invitedBy)
        .limit(1),
    ]);
    const company = unwrap<{ name: string | null; locale: string }[]>(
      companies,
      "invite workspace lookup",
    )[0];
    const profile = unwrap<{ display_name: string | null }[]>(
      profiles,
      "inviter name lookup",
    )[0];
    const locale = company?.locale === "fr-CA" ? "fr-CA" : "en";
    const french = locale === "fr-CA";
    const companyName = company?.name?.trim().replace(/\s+/g, " ") ||
      (french ? "un espace de travail" : "a Loonext workspace");
    const inviter = profile?.display_name?.trim().replace(/\s+/g, " ");
    const subject = french
      ? `${inviter ? `${inviter} vous invite` : "Vous êtes invité"} à rejoindre ${companyName} sur Loonext`
      : `${inviter ? `${inviter} invited you` : "You've been invited"} to join ${companyName} on Loonext`;
    const action = french ? "Accepter l'invitation" : "Accept the invite";
    const expiry = french ? "Cette invitation expire après 7 jours." : "This invite expires in 7 days.";
    const noteHtml = args.note ? `<blockquote>${escapeHtml(args.note)}</blockquote>` : "";
    const sent = await sendEmail(env, {
      to: [args.email],
      subject,
      locale,
      text: [subject, args.note, `${action}\n${args.link}`, expiry].filter(Boolean).join("\n\n"),
      html: emailLayout(
        `<p>${escapeHtml(subject)}.</p>${noteHtml}` +
          `<p><a href="${escapeHtml(args.link)}" style="color:#66801F;text-decoration:underline;">${escapeHtml(action)}</a></p>` +
          `<p>${escapeHtml(expiry)}</p>`,
        locale,
      ),
    });
    return sent.id !== null;
  } catch {
    console.error(`Team invite email failed (${args.inviteId}).`);
    return false;
  }
}

teamRoutes.delete("/invites/:id", requireCapability("team.manage"), async (c) => {
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
  // #722: revoke is allowed from pending and expired, which is exactly what the
  // conditional update above matches (not accepted, not revoked). The database
  // filter is the atomic check, so no extra read: a miss is a wrong state.
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
  const {user} = userData;
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
    /** #521: why the owner said they were adding this person, or null. */
    note: string | null;
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
  const {user} = userData;
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
      // #521: carried onto the membership rather than read back off the invite
      // later. The invite records a message that was sent; this records what
      // THIS member was told, and that has to stay true after the invite is
      // revoked, re-sent to the same address, or tidied away.
      joining_note: invite.note ?? null,
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

  // #521: the note, to the people the joining orientation will never show it
  // to. See the function for why this is narrow rather than "email everybody".
  await emailNoteIfOrientationWillNotShowIt(env, db, {
    companyId: invite.company_id,
    role: invite.role,
    note: invite.note,
    to: user.email,
  });

  return c.json(
    { ...memberRows[0], company_id: invite.company_id },
    201,
  );
});

/**
 * #521 — deliver the inviter's note to somebody the orientation will not show
 * it to.
 *
 * The note reaches a new member on the joining orientation's first screen. That
 * orientation is deliberately NOT shown to anybody holding `settings.manage`:
 * `shouldShowOrientation` in `packages/shared` argues that its four screens are
 * about answering customers, and that somebody who runs the workspace was not
 * "told to use it" the way a tech was. That reasoning is sound and this does
 * not weaken it.
 *
 * But the invite form offers Admin, and an owner adding an admin has exactly as
 * much reason to say "you are covering the north side while Priya is away".
 * Without this, the note on an Admin invite was written to the membership row
 * and read by nobody: not in the app, because the orientation never opens, and
 * not in the invite mail either, because a brand-new address is emailed by
 * Supabase Auth from a template this repo does not control.
 *
 * So the fix is neither to widen the orientation nor to take the field away
 * from the owner. It is to use the one surface we fully control for exactly the
 * people the in-app path misses.
 *
 * NARROW ON PURPOSE. It sends only when there IS a note and only when the role
 * would not have been shown one, so nobody who is about to read it on screen
 * one gets a duplicate in their inbox.
 *
 * Best-effort and never throws, like the backup-owner prompt beside it: a
 * Resend outage must not turn a successful join into a failed one.
 */
async function emailNoteIfOrientationWillNotShowIt(
  env: Env,
  db: Db,
  args: {
    companyId: string;
    role: string;
    note: string | null;
    to: string | undefined;
  },
): Promise<void> {
  if (!args.note || !args.to) return;
  // `false` here means the orientation WOULD show it, so we must not.
  // `oriented: false` is the joiner's state at this exact moment.
  if (shouldShowOrientation(args.role as MemberRole, false)) return;

  try {
    const rows = unwrap<{ name: string | null }[]>(
      await db.from("companies").select("name").eq("id", args.companyId).limit(1),
      "company name lookup",
    );
    const company = rows[0]?.name?.trim() || "your new workspace";
    await sendEmail(env, {
      to: [args.to],
      subject: `You've joined ${company}`,
      text:
        `You've joined ${company} on Loonext.

` +
        `They said: "${args.note}"
`,
      html: emailLayout(
        `<p>You've joined <strong>${escapeHtml(company)}</strong> on Loonext.</p>` +
          `<p style="border-left:3px solid #66801F;padding-left:12px;margin:16px 0;">` +
          `They said: ${escapeHtml(args.note)}</p>`,
      ),
    });
  } catch (error) {
    // Never-silent (D3), non-fatal: the membership stands either way.
    console.error(
      `joining-note email failed (${args.companyId}): ${String(error)}`,
    );
  }
}

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
  } catch (error) {
    console.error(
      `backup-owner prompt failed for company ${companyId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
