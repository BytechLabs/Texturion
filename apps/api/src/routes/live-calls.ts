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
import { callsV3Active, callsV3LegacyMode } from "../calls/runtime";
import type { CallSessionDO, SessionSnapshot } from "../calls/session-do";
import type { CallState } from "../calls/transitions";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
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
import {
  LOONEXT_SESSION_HEADER,
  ringMemberBrowser,
} from "../messaging/inbound-ring";
import { telnyxRequest } from "../telnyx/client";
import { parseJsonBody, unwrap } from "./core/http";

const targetBodySchema = z.object({
  target_user_id: z.uuid(),
});

const ringMeBodySchema = z
  .object({
    // §6 v2 wire change: v3 clients ALWAYS send true (calling ring-me only
    // when holding no live leg IS the attestation). Absent = pre-v3 client.
    no_local_leg: z.boolean().optional(),
  })
  .optional();

/** The CallSessionDO stub for a session, or null when the binding is absent. */
function callSessionStub(env: Env, sessionId: string): CallSessionDO | null {
  const namespace = env.CALL_SESSIONS;
  if (!namespace) return null;
  return namespace.get(
    namespace.idFromName(sessionId),
  ) as unknown as CallSessionDO;
}

/** §8.1 row-derivation fallback (DEGRADED truth — cannot represent
 *  voicemail-in-progress; that is phase-1 defect 4). Used when the DO returns
 *  null (purged/legacy) or in kill-switch mode. */
function deriveStateFromRow(row: {
  outcome: string | null;
  answered_at: string | null;
  direction: string | null;
}): CallState | null {
  if (row.outcome === "answered") return "ended_answered";
  if (row.outcome === "voicemail") return "ended_voicemail";
  if (row.outcome === "missed") return "ended_missed";
  // A live (outcome-null) row that has answered_at is 'answered' in BOTH
  // directions. #211: an outbound live row with no answered_at is 'dialing'
  // (never a false 'ringing'); inbound (or a pre-v3 legacy row with null
  // direction) stays 'ringing'.
  if (row.answered_at) return "answered";
  return row.direction === "outbound" ? "dialing" : "ringing";
}

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
 * POST /v1/calls/live/decline-mine (#171 R1) — the ONE decline the client ever
 * calls. A foreground live-socket ring exposes NO session id to the SDK
 * (getTelnyxCallControlId is outbound-only), so the client can't name the
 * session it's declining; it just says "decline whatever is ringing ME". The
 * server finds the company's currently-ringing sessions (the DO mirrors machine
 * state → calls.state, so `state='ringing'` is the queryable truth — typically
 * 0-1 rows) and routes the EXISTING idempotent DO.decline(session, me) into
 * each. The DO no-ops (declined:false) for any session where this member isn't
 * a ring target, so "decline mine" only ever affects sessions actually ringing
 * this member — that per-session target check is also the #106 boundary (a
 * member can only decline a session they were genuinely rung for).
 *
 * Registered BEFORE the :sessionId routes so 'decline-mine' never parses as a
 * session id. ALWAYS 200 (never a 409 for state). Kill-switch / no-DO env →
 * {declined:false, sessions:[]} (legacy relies on the client SDK hangup).
 * Crash-safe fan-out: a per-session DO throw is logged and skipped, never
 * sinking the batch or the 200 (the DO journals its own state internally).
 */
liveCallsRoutes.post(
  "/calls/live/decline-mine",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const companyId = c.get("companyId");
    const userId = c.get("userId");

    // Kill-switch / no-binding: decline is a v3-only signal (no avenue ladder
    // without the DO). Empty 200 — the legacy client owns its own SDK hangup.
    if (!callsV3Active(env)) {
      return c.json({ declined: false, sessions: [] });
    }

    const db = getDb(env);
    // The company's currently-ringing sessions. The DO mirror keeps
    // calls.state authoritative; bound to the newest 25 (there is realistically
    // never more than one ringing session, but the query stays bounded).
    const rows = unwrap<{ call_session_id: string }[]>(
      await db
        .from("calls")
        .select("call_session_id")
        .eq("company_id", companyId)
        .eq("state", "ringing")
        .is("outcome", null)
        .order("created_at", { ascending: false })
        .limit(25),
      "ringing sessions",
    );

    // Route the existing DO.decline into each; collect ONLY the sessions this
    // member was genuinely a target of (declined:true). We never enumerate the
    // company's other ringing sessions in the body — the per-session no-op both
    // enforces #106 and keeps those sessions out of the response.
    const sessions: { session_id: string; state: string }[] = [];
    for (const row of rows) {
      const stub = callSessionStub(env, row.call_session_id);
      if (!stub) continue;
      try {
        const result = await stub.decline({
          sessionId: row.call_session_id,
          userId,
        });
        if (result.declined) {
          sessions.push({
            session_id: row.call_session_id,
            state: result.state,
          });
        }
      } catch (cause) {
        // A DO RPC failure on ONE session must not sink the batch or the 200.
        // The DO journals its own in-flight state; here we log and move on.
        console.error(
          `decline-mine: DO.decline failed (session ${row.call_session_id}):`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    }

    return c.json({ declined: sessions.length > 0, sessions });
  },
);

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
 * GET /v1/calls/live/:sessionId/state (#170 §8.1) — the ONE state read,
 * ALWAYS 200 for an authorized request (no client ever infers state from a 4xx
 * again). Authorizes from the calls row (company + #106), then reads the DO
 * snapshot; if the DO returns null (purged / legacy) OR the kill switch is
 * flipped, state is DERIVED from the row (§8.1 — degraded but strictly better
 * than 4xx inference). Kill-switch mode NEVER calls the DO (review X1: a DO
 * holding pre-flip state would serve a stale snapshot forever).
 */
liveCallsRoutes.get(
  "/calls/live/:sessionId/state",
  requireRole("member"),
  async (c) => {
    const env = getEnv(c.env);
    const db = getDb(env);
    const sessionId = c.req.param("sessionId");
    const companyId = c.get("companyId");

    interface StateRow {
      call_session_id: string;
      caller_e164: string | null;
      caller_name: string | null;
      conversation_id: string | null;
      phone_number_id: string | null;
      direction: string | null;
      started_at: string;
      answered_at: string | null;
      answered_by_user_id: string | null;
      outcome: string | null;
      company_id: string;
    }
    const rows = unwrap<StateRow[]>(
      await db
        .from("calls")
        .select(
          "call_session_id,caller_e164,caller_name,conversation_id,phone_number_id,direction,started_at,answered_at,answered_by_user_id,outcome,company_id",
        )
        .eq("call_session_id", sessionId)
        .limit(1),
      "state read",
    );
    const row = rows[0];
    if (!row || row.company_id !== companyId) {
      return errorResponse(c, "not_found", "No such call.");
    }
    // #106: a number hidden from this member never enumerates (404, not 403).
    if (row.phone_number_id) {
      const access = await resolveNumberAccess(db, {
        companyId,
        userId: c.get("userId"),
        role: c.get("role"),
      });
      if ((access.hiddenNumberIds ?? []).includes(row.phone_number_id)) {
        return errorResponse(c, "not_found", "No such call.");
      }
    }

    let state: CallState | null = null;
    let yourLeg: { call_control_id: string; status: string } | null = null;

    // Kill-switch mode bypasses the DO entirely (§8.1 / §12.4).
    if (!callsV3LegacyMode(env)) {
      const stub = callSessionStub(env, sessionId);
      if (stub) {
        const snap: SessionSnapshot | null = await stub.snapshot(sessionId);
        if (snap) {
          state = snap.state;
          const mine = snap.legs.find((leg) => leg.user_id === c.get("userId"));
          if (mine) {
            yourLeg = { call_control_id: mine.call_control_id, status: mine.status };
          }
        }
      }
    }
    if (state === null) state = deriveStateFromRow(row);

    return c.json({
      call_session_id: row.call_session_id,
      state,
      direction: row.direction,
      started_at: row.started_at,
      answered_at: row.answered_at,
      answered_by_user_id: row.answered_by_user_id,
      caller_e164: row.caller_e164,
      caller_name: row.caller_name,
      conversation_id: row.conversation_id,
      phone_number_id: row.phone_number_id,
      outcome: row.outcome,
      your_leg: yourLeg,
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

    // #211 D13 CLOSE: under the v3 kill switch (no DO adjudicating), REFUSE an
    // outbound transfer — the legacy issueTransfer-on-outbound path is untested,
    // and parity exists only under v3. (Inbound keeps its legacy fallback.)
    if (gate.call.direction === "outbound" && !callsV3Active(env)) {
      return errorResponse(c, "conflict", "This call can't be transferred right now.");
    }

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

    // #170 §7.4: register the intent on the DO BEFORE issuing any Telnyx
    // command — T7's stand-down guard reads only this record, so the guard can
    // never miss an in-flight transfer. The DO returns the machine state; abort
    // (dial nothing) unless it is 'answered' (review R1-m3 — requireLiveCall
    // can pass and T5/T8 land before this call).
    const transferStub = callsV3Active(env) ? callSessionStub(env, sessionId) : null;
    if (transferStub) {
      const { state } = await transferStub.registerIntent({
        sessionId,
        kind: "transfer",
        targetUserId: body.target_user_id,
      });
      if (state !== "answered") {
        return errorResponse(c, "conflict", "The call just ended.");
      }
    }

    const issued = await issueTransfer(env, db, {
      companyId: c.get("companyId"),
      customerCcid: gate.call.customer_call_control_id as string,
      targetSipUsername: target.sipUsername,
      // Present the customer to the target (who they're about to talk to),
      // falling back to the business number for an anonymous caller.
      callerNumberForTarget: gate.call.caller_e164 ?? gate.businessNumber,
      // #211 (D11): outbound uses the consult-style dial+bridge-steal mechanic
      // INSIDE issueTransfer (proven against customer ccids); inbound keeps the
      // Telnyx transfer command. Same route, same intent discipline, same UX.
      direction: gate.call.direction === "outbound" ? "outbound" : "inbound",
      state: {
        sessionId,
        targetUserId: body.target_user_id,
        senderUserId: c.get("userId"),
        hops: 0,
        caller: gate.call.caller_e164,
      },
    });
    if (!issued) {
      if (transferStub) await transferStub.clearIntent();
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

    // #211 D13 CLOSE: no outbound consult under the v3 kill switch (untested
    // legacy path); parity exists only under v3.
    if (gate.call.direction === "outbound" && !callsV3Active(env)) {
      return errorResponse(c, "conflict", "This call can't be transferred right now.");
    }

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

    // #170 §7.4: intent BEFORE any Telnyx command (the consult route dials BOTH
    // legs; T7 must observe the intent already registered). Abort unless the
    // machine is still 'answered'.
    const consultStub = callsV3Active(env) ? callSessionStub(env, sessionId) : null;
    if (consultStub) {
      const { state } = await consultStub.registerIntent({
        sessionId,
        kind: "consult",
        targetUserId: body.target_user_id,
      });
      if (state !== "answered") {
        return errorResponse(c, "conflict", "The call just ended.");
      }
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
            // CALLS-CLIENT-V2 §3.2 (#208): consult legs carry the same
            // session-correlation custom SIP header as ring legs (X- prefix
            // mandatory), so both members' clients correlate the INVITE to the
            // server session deterministically.
            custom_headers: [
              { name: LOONEXT_SESSION_HEADER, value: sessionId },
            ],
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
      if (consultStub) await consultStub.clearIntent();
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

    // #211 D13 CLOSE: no outbound consult-complete under the v3 kill switch.
    if (gate.call.direction === "outbound" && !callsV3Active(env)) {
      return errorResponse(c, "conflict", "This call can't be transferred right now.");
    }

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
    // #170 §7.4 + #208: the DO owner stamp moves WITH the DB stamp, BEFORE
    // the bridge-steal and the sender-leg hangup (set-owner is idempotent, so
    // a replay is safe). Stamping after the steal left a crash window where
    // the machine still believed the SENDER owned the call: the sender's leg
    // death during the steal would flag ownerLegDeadDuringIntent, and the
    // re-armed intent expiry would then force-hang the transferred customer.
    // Clearing the intent re-runs T7's stood-down recovery check, a no-op
    // now that the owner changed.
    const completeStub = callsV3Active(env)
      ? callSessionStub(env, sessionId)
      : null;
    if (completeStub) {
      await completeStub.setOwner({ sessionId, userId: targetLeg.user_id });
      await completeStub.clearIntent();
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
      // #208: the machine's owner must follow the DB restore. The steal
      // failed, so the SENDER still holds the customer (set-owner is
      // idempotent; a stale target owner would misroute T7's stranded-call
      // teardown at the sender's next leg death).
      if (completeStub) {
        await completeStub.setOwner({ sessionId, userId: c.get("userId") });
      }
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
    // #170 §7.4: clear the consult intent (also re-runs T7's stood-down check).
    if (callsV3Active(env)) {
      const stub = callSessionStub(env, sessionId);
      if (stub) await stub.clearIntent();
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
    const body = (await parseJsonBody(c, ringMeBodySchema)) ?? {};
    const noLocalLeg = body.no_local_leg === true;

    const call = await liveCallBySession(db, sessionId);
    if (!call || call.company_id !== companyId) {
      return errorResponse(c, "not_found", "No such call.");
    }
    // ring-me is INBOUND push-to-wake only. A still-ringing OUTBOUND call would
    // otherwise let any text-level member fire a spurious billable dial onto a
    // teammate's live outbound line and, on a race, bridge-steal it (#139).
    // This is a property of the REQUEST, not session state → 409 (§8.3).
    if (call.direction !== "inbound") {
      return errorResponse(c, "conflict", "This call can't be rung.");
    }
    if (!call.phone_number_id) {
      return errorResponse(c, "conflict", "This call can't be rung.");
    }
    // #106: a number hidden from this member 404s (never enumerates).
    await assertNumberLevel(db, {
      companyId,
      userId,
      role: c.get("role"),
      phoneNumberId: call.phone_number_id,
      need: "text",
    });

    const target = await eligibleTarget(db, companyId, call.phone_number_id, userId);
    if (!target) {
      // Requester ineligibility is a REQUEST property → 409 (§8.3).
      return errorResponse(c, "conflict", "Your device can't take calls yet.");
    }

    // v3: the DO owns sequencing/state. The #168 ledger 409 gate is GONE — the
    // DO's state guard replaces it with a truthful 200 body (§6). ring-me NEVER
    // cancels a leg; the DO decides rang/reason.
    if (callsV3Active(env)) {
      const stub = callSessionStub(env, sessionId);
      if (stub) {
        const result = await stub.ringMe({
          sessionId,
          userId,
          sipUsername: target.sipUsername,
          noLocalLeg,
        });
        return c.json({
          ok: true,
          rang: result.rang,
          state: result.state,
          ...(result.reason ? { reason: result.reason } : {}),
        });
      }
    }

    // Kill-switch / no-binding fallback: the legacy ring engine. Preserve the
    // #168 ledger gate ONLY on this path (the DO is not in play).
    if (call.outcome !== null || call.answered_at) {
      return c.json({ ok: true, rang: false, state: "answered", reason: "not_ringing" });
    }
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
      return c.json({ ok: true, rang: false, state: "ringing", reason: "not_ringing" });
    }
    if (!call.customer_call_control_id) {
      return errorResponse(c, "conflict", "This call can't be rung.");
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
    return c.json({ ok: true, rang: true, state: "ringing" });
  },
);

/**
 * POST /v1/calls/live/:sessionId/decline (#171) — a member explicitly DECLINES
 * an inbound ring. This is a first-class SERVER signal, NOT a leg hangup: the
 * DO removes the member from the avenue/audience set, cancels their ring legs,
 * and re-runs the T3 exhaustion ladder — single-member decline → voicemail
 * immediately (the decliner's still-push-capable device no longer holds the
 * ring open); multi-member → the caller keeps ringing the others.
 *
 * Gated like ring-me: Bearer + member, company-scoped, inbound-only, #106
 * 'text' access to the number. It does NOT require a telephony credential
 * (unlike ring-me, which is about to DIAL the requester) — a push-only member
 * who was woken must be able to decline and drop themselves from the audience.
 *
 * Idempotent + ALWAYS 200 (never a 409 for state): a decline for an
 * already-resolved/ended session is a `{declined:false, reason}` no-op body.
 */
liveCallsRoutes.post(
  "/calls/live/:sessionId/decline",
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
    // Decline is INBOUND-only (mirrors ring-me's #139 gate): only an inbound
    // ring is presented to a member to decline. A property of the REQUEST → 409.
    if (call.direction !== "inbound") {
      return errorResponse(c, "conflict", "This call can't be declined.");
    }
    if (!call.phone_number_id) {
      return errorResponse(c, "conflict", "This call can't be declined.");
    }
    // #106: a number hidden from this member 404s (never enumerates).
    await assertNumberLevel(db, {
      companyId,
      userId,
      role: c.get("role"),
      phoneNumberId: call.phone_number_id,
      need: "text",
    });

    // v3: the DO owns the decline signal + the avenue ladder. Always-200 body.
    if (callsV3Active(env)) {
      const stub = callSessionStub(env, sessionId);
      if (stub) {
        const result = await stub.decline({ sessionId, userId });
        return c.json({
          declined: result.declined,
          state: result.state,
          ...(result.reason ? { reason: result.reason } : {}),
        });
      }
    }

    // Kill-switch / no-binding fallback: decline is a v3-only signal (there is
    // no avenue ladder without the DO). Honestly 200 no-op — the legacy client
    // relies on its own SDK hangup, unchanged.
    return c.json({
      declined: false,
      state: deriveStateFromRow(call) ?? "ended_missed",
      reason: "not_ringing",
    });
  },
);
