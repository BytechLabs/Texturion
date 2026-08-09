/**
 * #236 — Signed-in devices.
 *
 * Two audiences, because two different people need this and they need
 * different things:
 *
 *   GET  /v1/sessions              your own devices. Bearer-only (a person's
 *   POST /v1/sessions/revoke       sessions belong to the PERSON, not to one
 *                                  of their workspaces — and somebody who has
 *                                  just been removed from their only workspace
 *                                  still has to be able to sign their old
 *                                  phone out).
 *
 *   GET  /v1/members/sessions            the workspace's devices, admin+. The
 *   POST /v1/members/:id/sessions/revoke  owner is the one who knows the tech
 *                                         quit; self-service alone would leave
 *                                         the only person who can act relying
 *                                         on the person who left.
 *
 * The workspace view deliberately shows LESS than the self view: which app,
 * roughly where, when last active. Never a user agent string, never a device
 * name — an owner needs to recognise "a phone that has not been near this
 * business in three weeks", not to read their crew's browsing setup.
 *
 * Revoking takes effect on the target's NEXT request (auth/company.ts reads
 * `user_sessions` on every call) and takes the device's push registrations
 * with it, so a signed-out phone stops showing customer message text on its
 * lock screen. What it deliberately does not do is hang up a call in
 * progress: the customer on the other end did nothing wrong, and the session
 * cannot start another one.
 */
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { telnyxRequest } from "../telnyx/client";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

export const sessionsRoutes = new Hono<AppEnv>();

/** One row as the DB hands it over. */
interface SessionRow {
  session_id: string;
  user_id: string;
  client: string;
  user_agent: string | null;
  ip_country: string | null;
  ip_region: string | null;
  ip_city: string | null;
  first_seen_at: string;
  last_seen_at: string;
  signed_in_at: string;
}

/**
 * Exactly one of the two, and the schema says so rather than the handler:
 * `{ session_id }` signs out one device, `{ others: true }` signs out
 * everything except the one asking. There is no "sign out of everything
 * including this browser" — that is the sign-out button, and offering it here
 * would mean the confirmation screen logs you out before you can read it.
 */
const revokeSchema = z.union([
  z.object({ session_id: z.uuid() }),
  z.object({ others: z.literal(true) }),
]);

function locationOf(row: SessionRow): string | null {
  const parts = [row.ip_city, row.ip_region, row.ip_country].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function toSelfView(row: SessionRow, currentSessionId: string | null) {
  return {
    id: row.session_id,
    client: row.client,
    user_agent: row.user_agent,
    location: locationOf(row),
    signed_in_at: row.signed_in_at,
    last_active_at: row.last_seen_at,
    current: row.session_id === currentSessionId,
  };
}

async function listSessions(
  db: ReturnType<typeof getDb>,
  userIds: string[],
): Promise<SessionRow[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await db.rpc("api_list_user_sessions", {
    p_user_ids: userIds,
  });
  if (error) throw new Error(`session list failed: ${error.message}`);
  return (data ?? []) as SessionRow[];
}

// ---------------------------------------------------------------------------
// Self-service
// ---------------------------------------------------------------------------

sessionsRoutes.get("/sessions", async (c) => {
  const db = getDb(getEnv(c.env));
  const current = c.get("sessionId") ?? null;
  const rows = await listSessions(db, [c.get("userId")]);
  return c.json({
    data: rows.map((row) => toSelfView(row, current)),
    next_cursor: null,
  });
});

sessionsRoutes.post("/sessions/revoke", async (c) => {
  const body = await parseJsonBody(c, revokeSchema);
  const db = getDb(getEnv(c.env));
  const userId = c.get("userId");
  const current = c.get("sessionId") ?? null;

  if ("session_id" in body && body.session_id === current) {
    // Signing yourself out from inside the list would 401 the very response
    // that reports it. The sign-out button is the honest way to do this.
    return errorResponse(
      c,
      "conflict",
      "That is the device you are using. Sign out from the menu instead.",
    );
  }

  const result = await revoke(db, getEnv(c.env), {
    userId,
    sessionIds: "session_id" in body ? [body.session_id] : null,
    except: "session_id" in body ? null : current,
    actor: userId,
    reason: "session_id" in body ? "self" : "sign_out_all",
  });

  if ("session_id" in body && result.sessions === 0) {
    return errorResponse(c, "not_found", "No such signed-in device.");
  }
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Workspace view — admin and owner
// ---------------------------------------------------------------------------

sessionsRoutes.get("/members/sessions", requireCapability("team.manage"), async (c) => {
  const db = getDb(getEnv(c.env));
  const members = unwrap<{ id: string; user_id: string }[]>(
    await db
      .from("company_members")
      .select("id,user_id")
      .eq("company_id", c.get("companyId"))
      .is("deactivated_at", null),
    "workspace members lookup",
  );

  const memberIdByUser = new Map(members.map((m) => [m.user_id, m.id]));
  const rows = await listSessions(db, [...memberIdByUser.keys()]);

  return c.json({
    data: rows.map((row) => ({
      id: row.session_id,
      member_id: memberIdByUser.get(row.user_id) ?? null,
      client: row.client,
      location: locationOf(row),
      signed_in_at: row.signed_in_at,
      last_active_at: row.last_seen_at,
    })),
    next_cursor: null,
  });
});

sessionsRoutes.post(
  "/members/:id/sessions/revoke",
  requireCapability("team.manage"),
  async (c) => {
    const memberId = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    const rows = unwrap<{ user_id: string; role: string }[]>(
      await db
        .from("company_members")
        .select("user_id,role")
        .eq("id", memberId)
        .eq("company_id", companyId)
        .limit(1),
      "member lookup",
    );
    const member = rows[0];
    if (!member) return errorResponse(c, "not_found", "No such member.");

    // An admin signing the OWNER out of their own business is not a security
    // control, it is a hostage situation. Only the owner can end the owner's
    // sessions, from their own list.
    if (member.role === "owner" && c.get("role") !== "owner") {
      return errorResponse(
        c,
        "forbidden",
        "Only the owner can sign the owner's devices out.",
      );
    }

    const result = await revoke(db, getEnv(c.env), {
      userId: member.user_id,
      sessionIds: null,
      // An owner clearing their own devices from the workspace screen keeps
      // the browser they are doing it from; anyone else's is not spared,
      // because the point is that the person is gone.
      except: member.user_id === c.get("userId") ? (c.get("sessionId") ?? null) : null,
      actor: c.get("userId"),
      reason: "admin",
    });

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "member.sessions_revoked",
      targetType: "member",
      targetId: memberId,
      after: {
        sessions_ended: result.sessions,
        push_devices_removed: result.devices,
        // #573: recorded because a softphone that kept ringing after a sign-out
        // is the kind of thing somebody asks about afterwards.
        voice_credentials_revoked: result.voice,
      },
    });

    return c.json(result);
  },
);

interface RevokeInput {
  userId: string;
  sessionIds: string[] | null;
  except: string | null;
  actor: string;
  reason: "self" | "sign_out_all" | "admin";
}

async function revoke(
  db: ReturnType<typeof getDb>,
  env: ReturnType<typeof getEnv>,
  input: RevokeInput,
): Promise<{ sessions: number; devices: number; voice: number }> {
  const { data, error } = await db.rpc("api_revoke_sessions", {
    p_user_id: input.userId,
    p_session_ids: input.sessionIds,
    p_except: input.except,
    p_actor: input.actor,
    p_reason: input.reason,
  });
  if (error) throw new Error(`session revoke failed: ${error.message}`);
  const result = data as {
    sessions?: number;
    devices?: number;
    voice_credentials?: string[];
  };

  // #573: the softphone stops ringing.
  //
  // The row is already gone — that is what stops us handing the credential to a
  // new registration — but the credential still EXISTS at Telnyx, and the login
  // token minted from it stays valid until it does not. Deleting it there is what
  // actually kills a handset that had already registered, which is the whole
  // point: the control exists for a phone somebody else is holding.
  //
  // Best-effort per credential, and loud. A Telnyx outage must not make a sign-out
  // fail — the session, the push token and the refresh tokens are already gone, so
  // the account is far better off than before — but a credential we failed to
  // delete is a device still ringing, so it is logged with its id rather than
  // swallowed as a count.
  const credentials = result?.voice_credentials ?? [];
  let voice = 0;
  for (const credentialId of credentials) {
    try {
      await telnyxRequest(env, {
        method: "DELETE",
        path: `/v2/telephony_credentials/${credentialId}`,
      });
      voice += 1;
    } catch (cause) {
      console.error(
        `#573 telephony credential ${credentialId} survived a session revoke ` +
          `— that device can still ring:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  return {
    sessions: Number(result?.sessions ?? 0),
    devices: Number(result?.devices ?? 0),
    voice,
  };
}
