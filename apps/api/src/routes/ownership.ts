/**
 * #332 — ownership can move.
 *
 * The owner role controls spending, numbers, and US texting, and until now it
 * could not be handed to anybody. That made a good safety property (an admin
 * cannot lock out the person who pays) into a single point of failure: a
 * founder who retires, sells, dies, or simply loses their email left a
 * workspace nobody could fully run, and the only fix was a hand-written SQL
 * statement against production.
 *
 *   GET  /v1/company/ownership          M   who owns it, who is named as
 *                                           backup, what is in flight
 *   POST /v1/company/ownership/backup   O   name (or clear) the backup owner
 *   POST /v1/company/ownership/offer    O   offer ownership to a member
 *   POST /v1/company/ownership/claim    —   the NAMED BACKUP starts a claim
 *   POST /v1/company/ownership/accept   —   the recipient takes it
 *   POST /v1/company/ownership/cancel   —   the owner vetoes, or the
 *                                           recipient declines
 *
 * The three unmarked routes are mounted at `member` and gated inside the SQL,
 * because the person entitled to act is not a ROLE — it is one specific user
 * (the named backup; the named recipient), and a role gate would either be
 * too loose or would lock out a backup who is a plain member.
 *
 * #515: that reasoning was right and the UI ignored it. Every control these
 * routes serve lived on the Team settings card, behind `team.manage`, so the
 * backup who is a plain member could reach the API and not the button. The
 * clients now host the same booleans on a surface any member can open (web
 * /ownership; the settings index on both phones), and the emails below point
 * there — see `handoverLink`.
 *
 * Every one of them tells the whole crew afterwards. That is not politeness:
 * a handover nobody was told about is indistinguishable from a takeover, and
 * the people best placed to notice a wrong one are the people who work there.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import {
  CONFIRMABLE_ACTIONS,
  requireActionConfirmation,
} from "../auth/confirm-action";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import { renderEmailHtml } from "../email/html";
import { getEnv, type Env } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody, unwrap } from "./core/http";

export const ownershipRoutes = new Hono<AppEnv>();

const backupSchema = z.object({
  /** Null clears the nomination — "nobody" is a valid answer. */
  member_id: z.uuid().nullable(),
});

const offerSchema = z.object({
  member_id: z.uuid(),
  /** #537: present when the caller is confirming by emailed code. */
  confirmation_code: z.string().trim().regex(/^\d{6}$/).optional(),
});

/** #537: claim and accept carry no other input, only the code. */
const confirmOnlySchema = z.object({
  confirmation_code: z.string().trim().regex(/^\d{6}$/).optional(),
});

/**
 * #537 — which handover step a requested code is for.
 *
 * Scoped, because a code issued to hand the business over must not accept it
 * instead: those are opposite decisions made by different people.
 */
const codeRequestSchema = z.object({
  action: z.enum(CONFIRMABLE_ACTIONS),
});

interface OwnershipState {
  owner_user_id: string;
  owner_member_id: string | null;
  backup_owner_user_id: string | null;
  backup_member_id: string | null;
  pending: {
    id: string;
    kind: "offer" | "claim";
    from_user_id: string;
    to_user_id: string;
    to_member_id: string | null;
    ripens_at: string;
    expires_at: string;
    created_at: string;
  } | null;
}

async function loadState(db: SupabaseClient, companyId: string): Promise<OwnershipState> {
  const { data, error } = await db.rpc("api_ownership_state", {
    p_company_id: companyId,
  });
  if (error) throw new Error(`ownership state failed: ${error.message}`);
  return data as OwnershipState;
}

/**
 * What the caller may do, decided server-side rather than by three clients
 * each re-deriving it from ids. `can_claim` in particular is the one a client
 * would get subtly wrong, and getting it wrong means showing somebody a
 * button that takes a business.
 */
function viewFor(state: OwnershipState, userId: string) {
  const isOwner = state.owner_user_id === userId;
  const pending = state.pending;
  return {
    owner_member_id: state.owner_member_id,
    backup_member_id: state.backup_member_id,
    /** True only when the nomination is this caller's. */
    i_am_backup: state.backup_owner_user_id === userId,
    i_am_owner: isOwner,
    pending: pending
      ? {
          kind: pending.kind,
          to_member_id: pending.to_member_id,
          ripens_at: pending.ripens_at,
          expires_at: pending.expires_at,
          created_at: pending.created_at,
          /** The recipient's turn has come (an offer, or a ripe claim). */
          mine: pending.to_user_id === userId,
          ready: Date.parse(pending.ripens_at) <= Date.now(),
        }
      : null,
    can_offer: isOwner && pending === null,
    can_claim:
      !isOwner &&
      pending === null &&
      state.backup_owner_user_id === userId &&
      state.backup_member_id !== null,
    /** The owner's veto, and the recipient's decline, are the same button. */
    can_cancel:
      pending !== null && (isOwner || pending.to_user_id === userId),
  };
}

ownershipRoutes.get("/company/ownership", requireCapability("workspace.access"), async (c) => {
  const db = getDb(getEnv(c.env));
  const state = await loadState(db, c.get("companyId"));
  return c.json(viewFor(state, c.get("userId")));
});

ownershipRoutes.post(
  "/company/ownership/backup",
  requireCapability("workspace.own"),
  async (c) => {
    const body = await parseJsonBody(c, backupSchema);
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const { data, error } = await db.rpc("api_set_backup_owner", {
      p_company_id: companyId,
      p_actor: c.get("userId"),
      p_member_id: body.member_id,
    });
    if (error) throw new Error(`api_set_backup_owner failed: ${error.message}`);
    const result = data as { outcome: string };

    switch (result.outcome) {
      case "not_found":
        return errorResponse(c, "not_found", "No such workspace.");
      case "forbidden":
        return errorResponse(c, "forbidden", "Only the owner can name a backup.");
      case "no_member":
        return errorResponse(
          c,
          "validation_failed",
          "Name someone who is still on the team.",
        );
      case "self":
        return errorResponse(
          c,
          "validation_failed",
          "A backup who is you is not a backup. Name somebody else.",
        );
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "ownership.backup_named",
      targetType: "company",
      targetId: companyId,
      after: { backup_member_id: body.member_id },
    });

    // The person named is told, because a standing right to take over a
    // business is not something to discover on the day you need it.
    if (body.member_id) {
      await notify(c, async (env, database) => {
        const emails = await memberEmails(database, [
          (result as { user_id?: string }).user_id ?? "",
        ]);
        const name = await companyName(database, companyId);
        await mail(
          env,
          emails,
          `You are the backup owner for ${name}`,
          `${name}'s owner has named you as their backup.\n\n` +
            "That means one thing: if they ever cannot act — they leave, they " +
            "lose access to their email, or worse — you can ask to take over " +
            "the workspace. They get a week to say no, and everyone on the " +
            "team is told. Nothing changes today.\n\n" +
            handoverLink(env),
        );
      });
    }

    return c.json(viewFor(await loadState(db, companyId), c.get("userId")));
  },
);

/**
 * POST /v1/company/ownership/confirm-code — #537. Send me a code.
 *
 * ## Why this exists
 *
 * The step-up on the handover routes asks for a second factor from anybody who
 * holds one. Most owners hold none, so the protection the issue asked for would
 * have reached a minority of the people who need it most. This is the other half:
 * six digits to the address on the account.
 *
 * ## Why the path still says "ownership"
 *
 * The #537 audit widened this to every action that ends or hands over a business —
 * closing the workspace, releasing a number, lowering the crew's two-factor
 * requirement — so the name is now narrower than the job. It stays anyway: the
 * phones already shipped calling this path, app builds are not deployed with the
 * server, and a rename would break the confirmation on every installed copy for the
 * sake of a URL no customer reads.
 *
 * ## Why it is not gated on being the owner
 *
 * `workspace.access`, because the steps a code can satisfy are not all the owner's.
 * A named backup starting a claim is routinely a plain member, and a recipient
 * accepting is by definition not the owner yet. Asking for a code is harmless in
 * itself: it proves nothing and unlocks nothing until the code is presented
 * alongside an action the SQL already gates.
 *
 * ## It always answers the same way
 *
 * Nothing in the response says whether a code was sent, whether the caller could
 * have done the action anyway, or whether they hold a second factor. A request
 * that reported "you are not the owner" would be a way to enumerate who is.
 */
ownershipRoutes.post(
  "/company/ownership/confirm-code",
  requireCapability("workspace.access"),
  async (c) => {
    const body = await parseJsonBody(c, codeRequestSchema);
    const companyId = c.get("companyId");
    const userId = c.get("userId");
    const env = getEnv(c.env);
    const db = getDb(env);

    const { data, error } = await db.rpc("api_issue_ownership_code", {
      p_company_id: companyId,
      p_user_id: userId,
      p_action: body.action,
    });
    if (error) {
      throw new Error(`api_issue_ownership_code failed: ${error.message}`);
    }
    const code = String(data ?? "");

    // To the CALLER's own address and nobody else's. `announce` mails the whole
    // crew, which is right for "a handover is happening" and catastrophic for a
    // code — it would hand every teammate the confirmation.
    await notify(c, async (innerEnv, innerDb) => {
      const [email] = await memberEmails(innerDb, [userId]);
      if (!email) return;
      const name = await companyName(innerDb, companyId);
      await mail(
        innerEnv,
        [email],
        `${name}: your confirmation code`,
        [
          `Your code is ${code}`,
          "It works once, for ten minutes, for this one action. If you did not " +
            "ask for it, somebody may have your password — change it now, and " +
            "tell the rest of the crew.",
          handoverLink(innerEnv),
        ].join("\n\n"),
      );
    });

    // #537: the request itself is worth recording. "A code was asked for at
    // 14:02 and the handover happened at 14:03" is the shape of an incident
    // review, and a code nobody remembers requesting is the first sign.
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "ownership.code_requested",
      targetType: "company",
      targetId: companyId,
      after: { for: body.action },
    });

    // Deliberately no detail. See the docblock.
    return c.json({ sent: true });
  },
);

ownershipRoutes.post(
  "/company/ownership/offer",
  requireCapability("workspace.own"),
  async (c) => {
    // #537 — PROVE IT IS YOU BEFORE ARMING A TRANSFER OF THE BUSINESS.
    //
    // The company gate already demands a second factor from anybody holding one,
    // but that is a SESSION check made once at sign-in. This is asked at the
    // moment of the act, because offering is the step a stolen session can use to
    // start an irreversible handover — and the owner's window to veto lasts only
    // as long as it takes the recipient to tap accept, which can be seconds.
    const body = await parseJsonBody(c, offerSchema);
    const refused = await requireActionConfirmation(
      c,
      "offer",
      "handing the workspace over",
      body.confirmation_code,
    );
    if (refused) return refused;

    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const { data, error } = await db.rpc("api_offer_ownership", {
      p_company_id: companyId,
      p_actor: c.get("userId"),
      p_member_id: body.member_id,
    });
    if (error) throw new Error(`api_offer_ownership failed: ${error.message}`);
    const result = data as { outcome: string; to_user_id?: string };

    switch (result.outcome) {
      case "not_found":
        return errorResponse(c, "not_found", "No such workspace.");
      case "forbidden":
        return errorResponse(c, "forbidden", "Only the owner can hand it over.");
      case "no_member":
        return errorResponse(
          c,
          "validation_failed",
          "Hand it to someone who is still on the team.",
        );
      case "self":
        return errorResponse(c, "validation_failed", "You already own it.");
      case "in_flight":
        return errorResponse(
          c,
          "conflict",
          "A handover is already in progress. Cancel that one first.",
        );
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "ownership.offered",
      targetType: "company",
      targetId: companyId,
      after: { to_member_id: body.member_id },
    });

    await announce(c, companyId, async (env, name) => ({
      subject: `${name}: ownership has been offered to a teammate`,
      body:
        `The owner of ${name} has offered ownership of the workspace to a ` +
        "teammate. Nothing has changed yet — it takes effect only if they " +
        "accept, and the owner can cancel until then.\n\n" +
        "If this is not something you expected, tell the owner now.\n\n" +
        handoverLink(env),
    }));

    return c.json(viewFor(await loadState(db, companyId), c.get("userId")));
  },
);

ownershipRoutes.post(
  "/company/ownership/claim",
  requireCapability("workspace.access"),
  async (c) => {
    // #537: the same reasoning as the offer. A claim starts the transfer of a
    // whole business to the person making it, so it is asked of them at the
    // moment they make it.
    const claimBody = await parseJsonBody(c, confirmOnlySchema);
    const refused = await requireActionConfirmation(
      c,
      "claim",
      "claiming the workspace",
      claimBody.confirmation_code,
    );
    if (refused) return refused;

    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const { data, error } = await db.rpc("api_claim_ownership", {
      p_company_id: companyId,
      p_actor: c.get("userId"),
    });
    if (error) throw new Error(`api_claim_ownership failed: ${error.message}`);
    const result = data as { outcome: string; ripens_at?: string };

    switch (result.outcome) {
      case "not_found":
        return errorResponse(c, "not_found", "No such workspace.");
      case "forbidden":
        // Says nothing about who the backup IS. Somebody probing this route
        // learns only that it is not them.
        return errorResponse(
          c,
          "forbidden",
          "Only the person the owner named as backup can do this.",
        );
      case "in_flight":
        return errorResponse(
          c,
          "conflict",
          "A handover is already in progress.",
        );
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "ownership.claim_started",
      targetType: "company",
      targetId: companyId,
      after: { ripens_at: result.ripens_at ?? null },
    });

    // The loudest message in this file, and the one the whole design rests
    // on: the owner has a week, and one click, to stop this.
    await announce(c, companyId, async (env, name) => ({
      subject: `Action needed: someone is asking to take over ${name}`,
      body:
        `The backup owner of ${name} has asked to take over the workspace. ` +
        "This happens when the owner cannot act — but if the owner is fine, " +
        "it should be stopped.\n\n" +
        "IF YOU ARE THE OWNER AND DID NOT EXPECT THIS: open the link below " +
        "and cancel it. That takes effect immediately.\n\n" +
        "If nobody cancels, the handover completes in 7 days.\n\n" +
        handoverLink(env),
    }));

    return c.json(viewFor(await loadState(db, companyId), c.get("userId")));
  },
);

ownershipRoutes.post(
  "/company/ownership/accept",
  requireCapability("workspace.access"),
  async (c) => {
    // #537: the moment the business actually moves. Whoever is about to own it
    // proves they are themselves first — the offer told the crew this was coming,
    // and this is the step that cannot be undone.
    const acceptBody = await parseJsonBody(c, confirmOnlySchema);
    const refused = await requireActionConfirmation(
      c,
      "accept",
      "taking ownership",
      acceptBody.confirmation_code,
    );
    if (refused) return refused;

    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const before = await loadState(db, companyId);

    const { data, error } = await db.rpc("api_accept_ownership", {
      p_company_id: companyId,
      p_actor: c.get("userId"),
    });
    if (error) throw new Error(`api_accept_ownership failed: ${error.message}`);
    const result = data as {
      outcome: string;
      kind?: string;
      ripens_at?: string;
    };

    switch (result.outcome) {
      case "none":
        return errorResponse(c, "not_found", "There is nothing to accept.");
      case "forbidden":
        return errorResponse(c, "forbidden", "This handover is not yours to take.");
      case "expired":
        return errorResponse(
          c,
          "conflict",
          "That offer has expired. Ask the owner to make it again.",
        );
      case "not_yet":
        return errorResponse(
          c,
          "conflict",
          "The waiting period has not finished yet.",
        );
      case "no_member":
        return errorResponse(
          c,
          "forbidden",
          "You are no longer on this team.",
        );
    }

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "ownership.transferred",
      targetType: "company",
      targetId: companyId,
      before: { owner_member_id: before.owner_member_id },
      after: {
        owner_member_id: before.pending?.to_member_id ?? null,
        kind: result.kind ?? null,
      },
    });

    await announce(c, companyId, async (env, name) => ({
      subject: `${name} has a new owner`,
      body:
        `Ownership of ${name} has changed hands. The previous owner is now an ` +
        "admin and keeps working here; the new owner controls billing, " +
        "numbers, and the spending cap.\n\n" +
        "If this is not what you understood to be happening, say so now — " +
        "this is on the workspace's history and can be traced.\n\n" +
        handoverLink(env),
    }));

    return c.json(viewFor(await loadState(db, companyId), c.get("userId")));
  },
);

ownershipRoutes.post(
  "/company/ownership/cancel",
  requireCapability("workspace.access"),
  async (c) => {
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const { data, error } = await db.rpc("api_cancel_ownership_transfer", {
      p_company_id: companyId,
      p_actor: c.get("userId"),
    });
    if (error) {
      throw new Error(`api_cancel_ownership_transfer failed: ${error.message}`);
    }
    const result = data as { outcome: string; kind?: string };

    switch (result.outcome) {
      case "none":
        return errorResponse(c, "not_found", "There is nothing in progress.");
      case "forbidden":
        return errorResponse(
          c,
          "forbidden",
          "Only the owner or the person it involves can stop this.",
        );
    }

    const declined = result.outcome === "declined";
    await recordAuditFromRequest(db, c, {
      companyId,
      action: "ownership.canceled",
      targetType: "company",
      targetId: companyId,
      after: { kind: result.kind ?? null, declined },
    });

    await announce(c, companyId, async (env, name) => ({
      subject: `${name}: the ownership handover was stopped`,
      body:
        `The handover of ${name} has been ${declined ? "declined" : "cancelled"}. ` +
        "Nothing changed — the workspace has the same owner it had before.\n\n" +
        handoverLink(env),
    }));

    return c.json(viewFor(await loadState(db, companyId), c.get("userId")));
  },
);

// ---------------------------------------------------------------------------
// Telling people
// ---------------------------------------------------------------------------

/**
 * Every one of these events goes to the WHOLE crew, not just the two people
 * involved. The person best placed to notice a handover that should not be
 * happening is a colleague who knows the owner is on holiday, not a system.
 */
async function announce(
  c: Context<AppEnv>,
  companyId: string,
  compose: (env: Env, name: string) => Promise<{ subject: string; body: string }>,
): Promise<void> {
  await notify(c, async (env, db) => {
    const name = await companyName(db, companyId);
    const emails = await workspaceEmails(db, companyId);
    if (emails.length === 0) return;
    const { subject, body } = await compose(env, name);
    await mail(env, emails, subject, body);
  });
}

/**
 * Awaited inline, and never allowed to fail the request.
 *
 * Inline rather than deferred because on the claim path the email IS the
 * safety mechanism — the owner cannot exercise a veto they were never told
 * about — so it should be attempted before we report success, and its failure
 * should land in the same trace as the action that caused it. These are rare,
 * deliberate acts, not a hot path; the round trip costs nobody anything.
 *
 * Never allowed to fail because ownership has ALREADY moved by the time this
 * runs. A Resend outage must not turn a completed handover into a 500 that
 * invites somebody to press the button again.
 */
async function notify(
  c: Context<AppEnv>,
  work: (env: Env, db: SupabaseClient) => Promise<void>,
): Promise<void> {
  const env = getEnv(c.env);
  try {
    await work(env, getDb(env));
  } catch (cause) {
    console.error(
      "ownership notification failed:",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * Where every one of these emails points (#515).
 *
 * It used to be /settings/team, which is where the card lives — and where the
 * one person these emails exist for cannot go. The Team section is gated on
 * `team.manage`, and the named backup is routinely a plain member, because the
 * whole premise of #332 is that succession does not track rank. On the phones
 * there was no path at all. /ownership is mounted in the signed-in app outside
 * settings and needs only `workspace.access` — the same gate the routes in
 * this file already use — so an email can land a member, a read-only observer
 * or a bookkeeper directly on the button that is theirs.
 */
function handoverLink(env: Env): string {
  return `${env.APP_ORIGIN}/ownership`;
}

async function companyName(db: SupabaseClient, companyId: string): Promise<string> {
  const rows = unwrap<{ name: string }[]>(
    await db.from("companies").select("name").eq("id", companyId).limit(1),
    "company name lookup",
  );
  return rows[0]?.name ?? "your workspace";
}

async function workspaceEmails(db: SupabaseClient, companyId: string): Promise<string[]> {
  const rows = unwrap<{ user_id: string }[]>(
    await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .is("deactivated_at", null),
    "workspace members lookup",
  );
  return memberEmails(
    db,
    rows.map((row) => row.user_id),
  );
}

async function memberEmails(db: SupabaseClient, userIds: string[]): Promise<string[]> {
  const emails: string[] = [];
  for (const userId of userIds) {
    if (!userId) continue;
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) continue; // one unreadable account must not silence the rest
    const email = data.user?.email;
    if (email) emails.push(email);
  }
  return emails;
}

async function mail(
  env: Env,
  to: string[],
  subject: string,
  text: string,
): Promise<void> {
  await sendEmail(env, { to, subject, text, html: renderEmailHtml(text) });
}

