/**
 * #135 (D43) phase 3 — live-call actions. Everything here acts on a LIVE
 * session (outcome null, answered, customer leg known) belonging to the
 * caller's company, behind #106 'text' access to the call's number (handling
 * a customer call IS outreach). Hold is client-side (SDK call.hold() — no
 * endpoint); the server owns transfers, because only it can command the
 * customer's PSTN leg:
 *
 *   GET  /v1/calls/live/:sessionId/targets   — who can take this call
 *   POST /v1/calls/live/:sessionId/transfer  — blind transfer (auto-recovery)
 *   POST /v1/calls/live/:sessionId/consult   — start the announce consult
 *   POST /v1/calls/live/:sessionId/consult/complete — hand the customer over
 *   POST /v1/calls/live/:sessionId/consult/cancel   — tear the consult down
 *
 * The line model (founder-binding) holds throughout: the customer call never
 * leaves its number, a consult is its own two-party call, and no Telnyx
 * conference is ever created.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import {
  assertNumberLevel,
  levelFromRules,
  resolveNumberAccess,
  type NumberAccessRule,
} from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import {
  buildConsultState,
  consultLegs,
  issueTransfer,
  liveCallBySession,
  TRANSFER_TIMEOUT_SECS,
  type LiveCallRow,
} from "../messaging/live-call";
import { insertJourneyEvent } from "../messaging/live-call";
import { ringMemberBrowser } from "../messaging/inbound-ring";
import { telnyxRequest } from "../telnyx/client";
import { parseJsonBody, unwrap } from "./core/http";

const targetBodySchema = z.object({
  target_user_id: z.uuid(),
});

export const liveCallsRoutes = new Hono<AppEnv>();

/** Load + authorize the live call, or short-circuit with a Response. */
async function requireLiveCall(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDb>,
  sessionId: string,
): Promise<{ call: LiveCallRow; businessNumber: string } | Response> {
  const call = await liveCallBySession(db, sessionId);
  if (!call || call.company_id !== c.get("companyId")) {
    return errorResponse(c, "not_found", "No such call.");
  }
  if (call.outcome !== null || !call.answered_at) {
    return errorResponse(c, "conflict", "This call isn't live.");
  }
  if (!call.customer_call_control_id || !call.phone_number_id) {
    return errorResponse(c, "conflict", "This call can't be controlled.");
  }
  await assertNumberLevel(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
    phoneNumberId: call.phone_number_id,
    need: "text",
  });
  const numbers = unwrap<{ number_e164: string }[]>(
    await db
      .from("phone_numbers")
      .select("number_e164")
      .eq("id", call.phone_number_id)
      .limit(1),
    "number lookup",
  );
  const businessNumber = numbers[0]?.number_e164;
  if (!businessNumber) {
    return errorResponse(c, "conflict", "This call can't be controlled.");
  }
  return { call, businessNumber };
}

/** A credentialed, active member with 'text' access to the number. */
async function eligibleTarget(
  db: ReturnType<typeof getDb>,
  companyId: string,
  phoneNumberId: string,
  targetUserId: string,
): Promise<{ sipUsername: string } | null> {
  const [cred, member, rules] = await Promise.all([
    db
      .from("member_telephony_credentials")
      .select("sip_username")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .limit(1),
    db
      .from("company_members")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .is("deactivated_at", null)
      .limit(1),
    db
      .from("number_access")
      .select("phone_number_id,principal_kind,principal,level")
      .eq("company_id", companyId)
      .eq("phone_number_id", phoneNumberId),
  ]);
  if (cred.error) throw new Error(`credential read failed: ${cred.error.message}`);
  if (member.error) throw new Error(`member read failed: ${member.error.message}`);
  if (rules.error) throw new Error(`rules read failed: ${rules.error.message}`);
  const sipUsername = cred.data?.[0]?.sip_username as string | undefined;
  const role = member.data?.[0]?.role as string | undefined;
  if (!sipUsername || !role) return null;
  const level =
    role === "owner" || role === "admin"
      ? "text"
      : levelFromRules(
          (rules.data ?? []) as NumberAccessRule[],
          targetUserId,
          role as "admin" | "member",
        );
  return level === "text" ? { sipUsername } : null;
}

/** How far back a live (outcome-null) call can plausibly reach — mirrors the
 *  webhook's LINE_BUSY_WINDOW: an older outcome-null row is a crashed
 *  session, not a live call, and must not resurface in recovery UI. */
const LIVE_CALL_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * GET /v1/calls/live/mine (#168 part D) — the caller's OWN currently-live
 * call sessions: answered by them (answered_by_user_id — inbound answers and
 * completed transfers both stamp it), not yet ended (outcome null), inside
 * the live window. This is the post-crash recovery listing: an app that died
 * mid-call relaunches, asks "was I on a call?", and gets the facts it needs
 * to surface the disconnection honestly (session id, peer, when it started).
 * Registered BEFORE the :sessionId routes so 'mine' never parses as a
 * session id. #106: a number hidden from the member never enumerates, even
 * for a call they answered before access changed.
 */
liveCallsRoutes.get("/calls/live/mine", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  const companyId = c.get("companyId");
  interface MineRow {
    call_session_id: string;
    caller_e164: string | null;
    caller_name: string | null;
    contact_id: string | null;
    conversation_id: string | null;
    phone_number_id: string | null;
    direction: string | null;
    started_at: string;
    answered_at: string | null;
  }
  const rows = unwrap<MineRow[]>(
    await db
      .from("calls")
      .select(
        "call_session_id,caller_e164,caller_name,contact_id,conversation_id,phone_number_id,direction,started_at,answered_at",
      )
      .eq("company_id", companyId)
      .eq("answered_by_user_id", c.get("userId"))
      .is("outcome", null)
      .not("answered_at", "is", null)
      .gte(
        "created_at",
        new Date(Date.now() - LIVE_CALL_WINDOW_MS).toISOString(),
      )
      .order("answered_at", { ascending: false })
      .limit(10),
    "live calls",
  );
  const access = await resolveNumberAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const hidden = new Set(access.hiddenNumberIds ?? []);
  return c.json({
    calls: rows.filter(
      (row) => row.phone_number_id === null || !hidden.has(row.phone_number_id),
    ),
  });
});

/**
 * D43 resolver: an INBOUND call is answered on a member RING leg whose Telnyx
 * session id differs from the customer inbound leg's session (the ring engine
 * Dials without link_to). The customer session — which every live-call op and
 * the calls row key on — is only known server-side, in call_member_legs. The
 * softphone calls this with its ring-leg call_control_id (telnyxIDs) once an
 * inbound call goes active, to learn the real session. Scoped to the caller's
 * company via the ledger row.
 */
liveCallsRoutes.get(
  "/calls/live/by-leg/:legCcid",
  requireRole("member"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const rows = unwrap<{ call_session_id: string }[]>(
      await db
        .from("call_member_legs")
        .select("call_session_id")
        .eq("company_id", c.get("companyId"))
        .eq("call_control_id", c.req.param("legCcid"))
        // A member's leg is a 'ring' leg (inbound answer) OR a 'transfer' leg
        // (blind-transfer target) — both resolve to the customer session.
        .in("kind", ["ring", "transfer"])
        .limit(1),
      "member leg lookup",
    );
    const sessionId = rows[0]?.call_session_id;
    if (!sessionId) return errorResponse(c, "not_found", "No such call leg.");
    return c.json({ call_session_id: sessionId });
  },
);

/** What the call bar needs about a live call (notes link, transfer state). */
liveCallsRoutes.get(
  "/calls/live/:sessionId",
  requireRole("member"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const gate = await requireLiveCall(c, db, c.req.param("sessionId"));
    if (gate instanceof Response) return gate;
    return c.json({
      conversation_id: gate.call.conversation_id,
      caller_e164: gate.call.caller_e164,
    });
  },
);

/**
 * Who can take this call: active credentialed members with 'text' access to
 * the call's number, minus the caller. `busy` = they hold a live answered
 * call right now (line-model presence — dialing them anyway is allowed, the
 * founder's crew decides; the flag keeps the picker honest).
 */
liveCallsRoutes.get(
  "/calls/live/:sessionId/targets",
  requireRole("member"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const gate = await requireLiveCall(c, db, c.req.param("sessionId"));
    if (gate instanceof Response) return gate;
    const companyId = c.get("companyId");

    const [credentials, members, rules, liveCalls] = await Promise.all([
      db
        .from("member_telephony_credentials")
        .select("user_id,sip_username")
        .eq("company_id", companyId),
      db
        .from("company_members")
        .select("user_id,role,display_name:user_id")
        .eq("company_id", companyId)
        .is("deactivated_at", null),
      db
        .from("number_access")
        .select("phone_number_id,principal_kind,principal,level")
        .eq("company_id", companyId)
        .eq("phone_number_id", gate.call.phone_number_id),
      db
        .from("calls")
        .select("answered_by_user_id")
        .eq("company_id", companyId)
        .is("outcome", null)
        .not("answered_by_user_id", "is", null)
        .gte(
          "created_at",
          new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        ),
    ]);
    if (credentials.error || members.error || rules.error || liveCalls.error) {
      throw new Error("transfer target reads failed");
    }
    const roleByUser = new Map(
      (members.data ?? []).map((m) => [m.user_id as string, m.role as string]),
    );
    const busy = new Set(
      (liveCalls.data ?? []).map((r) => r.answered_by_user_id as string),
    );
    const accessRules = (rules.data ?? []) as NumberAccessRule[];

    const targets = (credentials.data ?? [])
      .filter((cred) => (cred.user_id as string) !== c.get("userId"))
      .filter((cred) => {
        const role = roleByUser.get(cred.user_id as string);
        if (!role) return false;
        if (role === "owner" || role === "admin") return true;
        return (
          levelFromRules(
            accessRules,
            cred.user_id as string,
            role as "admin" | "member",
          ) === "text"
        );
      })
      .map((cred) => ({
        user_id: cred.user_id as string,
        busy: busy.has(cred.user_id as string),
      }));
    return c.json({ targets });
  },
);

/** Blind transfer: the customer leg re-rings at the target's browser. */
liveCallsRoutes.post(
  "/calls/live/:sessionId/transfer",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const sessionId = c.req.param("sessionId");
    const body = await parseJsonBody(c, targetBodySchema);
    const gate = await requireLiveCall(c, db, sessionId);
    if (gate instanceof Response) return gate;

    const target = await eligibleTarget(
      db,
      c.get("companyId"),
      gate.call.phone_number_id as string,
      body.target_user_id,
    );
    if (!target) {
      return errorResponse(
        c,
        "conflict",
        "That teammate can't take calls on this number.",
      );
    }

    const issued = await issueTransfer(env, db, {
      companyId: c.get("companyId"),
      customerCcid: gate.call.customer_call_control_id as string,
      targetSipUsername: target.sipUsername,
      // Present the customer to the target (who they're about to talk to),
      // falling back to the business number for an anonymous caller.
      callerNumberForTarget: gate.call.caller_e164 ?? gate.businessNumber,
      state: {
        sessionId,
        targetUserId: body.target_user_id,
        senderUserId: c.get("userId"),
        hops: 0,
        caller: gate.call.caller_e164,
      },
    });
    if (!issued) {
      return errorResponse(c, "conflict", "The call just ended.");
    }
    return c.json({ status: "transferring" }, 202);
  },
);

/**
 * Start an announce consult: dial BOTH members' browsers on the Call-Control
 * app (ledgered kind='consult'); the webhook bridges them when both answer.
 * The customer stays exactly where they are (the sender client-holds them).
 */
liveCallsRoutes.post(
  "/calls/live/:sessionId/consult",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const sessionId = c.req.param("sessionId");
    const body = await parseJsonBody(c, targetBodySchema);
    const gate = await requireLiveCall(c, db, sessionId);
    if (gate instanceof Response) return gate;
    const companyId = c.get("companyId");

    const existing = await consultLegs(db, sessionId);
    if (existing.some((leg) => leg.state !== "failed")) {
      return errorResponse(
        c,
        "conflict",
        "A consult for this call is already running.",
      );
    }

    const [target, sender] = await Promise.all([
      eligibleTarget(
        db,
        companyId,
        gate.call.phone_number_id as string,
        body.target_user_id,
      ),
      eligibleTarget(
        db,
        companyId,
        gate.call.phone_number_id as string,
        c.get("userId"),
      ),
    ]);
    if (!target) {
      return errorResponse(
        c,
        "conflict",
        "That teammate can't take calls on this number.",
      );
    }
    if (!sender) {
      return errorResponse(c, "conflict", "Your softphone isn't registered.");
    }

    // Dial both browsers; per-leg try/catch so a half-failed consult tears
    // down cleanly rather than ringing one side forever.
    const dialed: { ccid: string; userId: string }[] = [];
    const legsToDial = [
      { userId: c.get("userId"), sip: sender.sipUsername, role: "s" as const },
      { userId: body.target_user_id, sip: target.sipUsername, role: "t" as const },
    ];
    for (const leg of legsToDial) {
      try {
        const response = (await telnyxRequest(env, {
          method: "POST",
          path: "/v2/calls",
          body: {
            connection_id: env.TELNYX_VOICE_CONNECTION_ID,
            to: `sip:${leg.sip}@sip.telnyx.com`,
            from: gate.businessNumber,
            timeout_secs: TRANSFER_TIMEOUT_SECS,
            client_state: buildConsultState({
              sessionId,
              userId: leg.userId,
              role: leg.role,
            }),
          },
        })) as { data?: { call_control_id?: string } };
        const ccid = response.data?.call_control_id;
        if (ccid) dialed.push({ ccid, userId: leg.userId });
      } catch (cause) {
        console.error(
          `consult dial failed (user ${leg.userId}):`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    }
    if (dialed.length < 2) {
      for (const leg of dialed) {
        try {
          await telnyxRequest(env, {
            method: "POST",
            path: `/v2/calls/${leg.ccid}/actions/hangup`,
            body: {},
          });
        } catch {
          /* already gone */
        }
      }
      return errorResponse(c, "conflict", "Couldn't start the consult.");
    }

    const { error } = await db.from("call_member_legs").insert(
      dialed.map((leg) => ({
        call_session_id: sessionId,
        call_control_id: leg.ccid,
        company_id: companyId,
        user_id: leg.userId,
        kind: "consult",
      })),
    );
    if (error) throw new Error(`consult ledger insert failed: ${error.message}`);
    return c.json({ status: "consulting" }, 202);
  },
);

/**
 * Complete the announce transfer: bridge-STEAL the customer leg onto the
 * target's answered consult leg, hang up the sender's consult leg, stamp the
 * new owner, drop the journey line. The sender's client releases its held
 * customer call when its remote leg vanishes.
 */
liveCallsRoutes.post(
  "/calls/live/:sessionId/consult/complete",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const sessionId = c.req.param("sessionId");
    const gate = await requireLiveCall(c, db, sessionId);
    if (gate instanceof Response) return gate;

    const legs = await consultLegs(db, sessionId);
    const targetLeg = legs.find(
      (leg) => leg.state === "answered" && leg.user_id !== c.get("userId"),
    );
    const senderLeg = legs.find(
      (leg) => leg.state === "answered" && leg.user_id === c.get("userId"),
    );
    // Only the consult's SENDER (an answered consult leg is theirs) may
    // complete it — a non-participant with 'text' access must not bridge the
    // customer onto an arbitrary leg.
    if (!senderLeg) {
      return errorResponse(
        c,
        "conflict",
        "You're not on this consult.",
      );
    }
    if (!targetLeg) {
      return errorResponse(
        c,
        "conflict",
        "The consult isn't connected yet.",
      );
    }

    // #168 ORDERING: stamp the NEW owner BEFORE the bridge-steal. The steal
    // unbridges the sender's answered ring leg, whose hangup handler
    // (handleAnsweredMemberLegDeath) tears down "stranded" customers still
    // owned by the dying leg's user — stamping first makes that handler see
    // the hand-off and stand down, closing the race where a completed consult
    // transfer was killed as a stranded call. A failed bridge restores the
    // sender (best-effort) before rethrowing.
    const { error: ownerError } = await db
      .from("calls")
      .update({ answered_by_user_id: targetLeg.user_id })
      .eq("call_session_id", sessionId);
    if (ownerError) {
      throw new Error(`transfer stamp failed: ${ownerError.message}`);
    }
    try {
      await telnyxRequest(env, {
        method: "POST",
        path: `/v2/calls/${targetLeg.call_control_id}/actions/bridge`,
        body: { call_control_id: gate.call.customer_call_control_id },
      });
    } catch (cause) {
      await db
        .from("calls")
        .update({ answered_by_user_id: c.get("userId") })
        .eq("call_session_id", sessionId);
      throw cause;
    }

    // CRITICAL ORDERING: remove the consult ledger rows BEFORE hanging up the
    // sender leg. The sender-hangup fires call.hangup (still brc-tagged) →
    // handleConsultLegEvent, which dismisses live sibling consult legs. With
    // the rows gone it matches nothing, so it can never tear down the target
    // leg that now carries the bridged customer. (The target's brc leg keeps
    // ringing the customer; its own later hangup is a harmless no-op.)
    const { error: clearError } = await db
      .from("call_member_legs")
      .delete()
      .eq("call_session_id", sessionId)
      .eq("kind", "consult");
    if (clearError) {
      throw new Error(`consult ledger clear failed: ${clearError.message}`);
    }
    if (senderLeg) {
      try {
        await telnyxRequest(env, {
          method: "POST",
          path: `/v2/calls/${senderLeg.call_control_id}/actions/hangup`,
          body: {},
        });
      } catch {
        /* already gone */
      }
    }

    if (gate.call.conversation_id) {
      await insertJourneyEvent(db, {
        companyId: c.get("companyId"),
        conversationId: gate.call.conversation_id,
        callSessionId: sessionId,
        kind: "transferred",
        fromUserId: c.get("userId"),
        toUserId: targetLeg.user_id,
      });
    }
    return c.json({ status: "transferred" });
  },
);

/** Tear the consult down (both legs; the customer call is untouched). */
liveCallsRoutes.post(
  "/calls/live/:sessionId/consult/cancel",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const sessionId = c.req.param("sessionId");
    const gate = await requireLiveCall(c, db, sessionId);
    if (gate instanceof Response) return gate;

    const legs = await consultLegs(db, sessionId);
    for (const leg of legs) {
      if (leg.state === "failed") continue;
      try {
        await telnyxRequest(env, {
          method: "POST",
          path: `/v2/calls/${leg.call_control_id}/actions/hangup`,
          body: {},
        });
      } catch {
        /* already gone */
      }
    }
    return c.json({ status: "cancelled" });
  },
);

/**
 * POST /v1/calls/live/:sessionId/ring-me (#135 push-to-wake) — a member who just
 * opened the app from an incoming-call push asks to be (re-)rung for a call that
 * is STILL ringing (the customer is on the line, no one has answered). Dials
 * their now-awake browser so the ringing call surfaces and they can answer it.
 * Unlike the other live-call ops this accepts a NOT-yet-answered call (that's the
 * whole point) — but is otherwise gated identically: live, company-scoped, #106
 * 'text' access to the number.
 */
liveCallsRoutes.post(
  "/calls/live/:sessionId/ring-me",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const sessionId = c.req.param("sessionId");
    const companyId = c.get("companyId");
    const userId = c.get("userId");

    const call = await liveCallBySession(db, sessionId);
    if (!call || call.company_id !== companyId) {
      return errorResponse(c, "not_found", "No such call.");
    }
    // ring-me is INBOUND push-to-wake only. A still-ringing OUTBOUND call
    // (outcome + answered_at both null, both ccids set) would otherwise pass
    // every gate below — letting any text-level member fire a spurious billable
    // dial onto a teammate's live outbound line and, on a race, bridge-steal it
    // (#139). The ring engine never fans a member ring leg onto an outbound
    // call, so there is nothing legitimate to re-ring here.
    if (call.direction !== "inbound") {
      return errorResponse(c, "conflict", "This call can't be rung.");
    }
    if (call.outcome !== null || call.answered_at) {
      return errorResponse(c, "conflict", "This call isn't ringing anymore.");
    }
    // #168 (part B): "outcome null + answered_at null" is NOT enough — a call
    // that fell to VOICEMAIL is already answered on the vmi tag with nothing
    // stamped on the row until its hangup. The ring ledger tells the truth:
    // legs were dialed and none is still 'ringing' (nor 'answered') → the
    // ring window is over. Re-dialing here would ring a member for a call
    // voicemail owns (the founder's stale-ring-after-voicemail evidence).
    // Zero ledgered legs = the ring engine hasn't dialed yet (the wake push
    // fans out in parallel with the dial loop) — allowed, as before.
    const legs = unwrap<{ state: string }[]>(
      await db
        .from("call_member_legs")
        .select("state")
        .eq("call_session_id", sessionId)
        .eq("kind", "ring"),
      "ring ledger read",
    );
    if (
      legs.length > 0 &&
      !legs.some((leg) => leg.state === "ringing" || leg.state === "answered")
    ) {
      return errorResponse(c, "conflict", "This call isn't ringing anymore.");
    }
    if (!call.customer_call_control_id || !call.phone_number_id) {
      return errorResponse(c, "conflict", "This call can't be rung.");
    }
    await assertNumberLevel(db, {
      companyId,
      userId,
      role: c.get("role"),
      phoneNumberId: call.phone_number_id,
      need: "text",
    });

    const target = await eligibleTarget(
      db,
      companyId,
      call.phone_number_id,
      userId,
    );
    if (!target) {
      return errorResponse(c, "conflict", "Your device can't take calls yet.");
    }
    const numbers = unwrap<{ number_e164: string }[]>(
      await db
        .from("phone_numbers")
        .select("number_e164")
        .eq("id", call.phone_number_id)
        .limit(1),
      "number lookup",
    );
    const businessNumber = numbers[0]?.number_e164;
    if (!businessNumber) {
      return errorResponse(c, "conflict", "This call can't be rung.");
    }

    await ringMemberBrowser(env, db, {
      callSessionId: sessionId,
      companyId,
      userId,
      sipUsername: target.sipUsername,
      caller: call.caller_e164,
      businessNumberE164: businessNumber,
      inboundCcid: call.customer_call_control_id,
    });
    return c.json({ ok: true });
  },
);
