/**
 * GET /v1/calls (#129 Calls feature, docs/CALLS-FEATURE.md P3) — the
 * company's call log from the session-grain `calls` read model, newest
 * first, keyset-paginated on (started_at, id).
 *
 * Every row is #106 number-access filtered INSIDE the SQL (the deny list
 * runs before the keyset window, so cursors never strand restricted
 * members): a member whose access excludes number N sees no calls to N —
 * anywhere. Owners/admins short-circuit with hiddenNumberIds = null. Rows
 * whose number was released (NULL phone_number_id) stay visible, matching
 * the conversations semantics.
 *
 * `?outcome=missed|answered|voicemail` narrows the list (the surface's one
 * filter — "who called and do I need to act?").
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { assertNumberLevel, resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
import {
  buildOutboundState,
  companyOverVoiceCap,
  OUTBOUND_CUSTOMER_STATE,
  type CompanyVoiceState,
} from "../messaging/voice-webhook";
import { VOICEMAILS_BUCKET } from "../messaging/inbound-ring";
import {
  parseCursor,
  parseJsonBody,
  parseLimit,
  parseWith,
  unwrap,
} from "./core/http";

const listQuerySchema = z.object({
  outcome: z.enum(["answered", "voicemail", "missed"]).optional(),
});

/** One row of GET /v1/calls (mirrored by the web `Call` type). */
export interface CallRow {
  id: string;
  /** D43: the Telnyx session id — voicemail playback + live-call identity. */
  call_session_id: string;
  caller_e164: string | null;
  contact_id: string | null;
  contact_name: string | null;
  /** D43: CNAM-dipped display name (when the owner enabled the lookup). */
  caller_name: string | null;
  phone_number_id: string | null;
  conversation_id: string | null;
  /** null = the call is IN PROGRESS (D43 creates the row at call.initiated). */
  outcome: "answered" | "voicemail" | "missed" | null;
  forward_seconds: number;
  /** D43: raw carrier screening verdict + STIR/SHAKEN attestation (A/B/C). */
  screening_result: string | null;
  stir_attestation: string | null;
  voicemail_seconds: number | null;
  answered_by_user_id: string | null;
  started_at: string;
}

export const callsRoutes = new Hono<AppEnv>();

callsRoutes.get("/calls", requireRole("member"), async (c) => {
  const query = parseWith(listQuerySchema, {
    outcome: c.req.query("outcome"),
  });
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);

  const db = getDb(getEnv(c.env));
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const rows = unwrap<CallRow[]>(
    await db.rpc("api_list_calls", {
      p_company_id: c.get("companyId"),
      p_limit: limit + 1,
      p_outcome: query.outcome ?? null,
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_hidden_number_ids: access.hiddenNumberIds,
    }),
    "calls list",
  );
  return c.json(buildPage(rows, limit, "started_at"));
});

/**
 * D43: voicemail playback. Returns a short-lived signed URL for the
 * session's stored recording. #106-enforced: the call's number must be
 * readable by the caller (a hidden number's voicemail must not even
 * enumerate — same not_found shape as its conversations).
 */
callsRoutes.get("/calls/:sessionId/voicemail", requireRole("member"), async (c) => {
  const sessionId = c.req.param("sessionId");
  const db = getDb(getEnv(c.env));

  const rows = unwrap<
    {
      phone_number_id: string | null;
      voicemail_path: string | null;
      voicemail_seconds: number | null;
    }[]
  >(
    await db
      .from("calls")
      .select("phone_number_id,voicemail_path,voicemail_seconds")
      .eq("company_id", c.get("companyId"))
      .eq("call_session_id", sessionId)
      .limit(1),
    "call lookup",
  );
  const call = rows[0];
  if (!call?.voicemail_path) {
    return errorResponse(c, "not_found", "No voicemail for this call.");
  }
  await assertNumberLevel(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
    phoneNumberId: call.phone_number_id,
    need: "read",
  });

  const signed = await db.storage
    .from(VOICEMAILS_BUCKET)
    .createSignedUrl(call.voicemail_path, 60 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(
      `voicemail sign failed: ${signed.error?.message ?? "no URL"}`,
    );
  }
  return c.json({
    url: signed.data.signedUrl,
    seconds: call.voicemail_seconds ?? 0,
  });
});

const outboundBodySchema = z.object({
  conversation_id: z.uuid(),
});

/** The conversation + gate result an outbound call authorization needs. */
interface OutboundAuth {
  conversation: { id: string; contact_id: string; phone_number_id: string };
  customer: string;
  businessNumber: string;
}

/**
 * Shared outbound-call gates (D38 bridge AND D43 browser origination): the
 * conversation names the customer + business number; #106 'text' level (calling
 * is outreach); a live subscription; and the D36 voice spending cap. Returns
 * the resolved parties, or a Response to short-circuit with.
 */
async function authorizeOutboundCall(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDb>,
  companyId: string,
  userId: string,
  conversationId: string,
): Promise<OutboundAuth | Response> {
  const conversations = unwrap<
    {
      id: string;
      contact_id: string;
      phone_number_id: string | null;
      contacts: { phone_e164: string } | null;
      phone_numbers: { number_e164: string; status: string } | null;
    }[]
  >(
    await db
      .from("conversations")
      .select(
        "id,contact_id,phone_number_id,contacts(phone_e164),phone_numbers(number_e164,status)",
      )
      .eq("company_id", companyId)
      .eq("id", conversationId)
      .limit(1),
    "conversation lookup",
  );
  const conversation = conversations[0];
  if (!conversation) {
    return errorResponse(c, "not_found", "No such conversation.");
  }
  const customer = conversation.contacts?.phone_e164;
  const businessNumber = conversation.phone_numbers?.number_e164;
  if (!customer || !businessNumber || !conversation.phone_number_id) {
    return errorResponse(
      c,
      "conflict",
      "This conversation has no callable number.",
    );
  }
  if (conversation.phone_numbers?.status !== "active") {
    return errorResponse(c, "conflict", "This number isn't active right now.");
  }

  await assertNumberLevel(db, {
    companyId,
    userId,
    role: c.get("role"),
    phoneNumberId: conversation.phone_number_id,
    need: "text",
  });

  const companies = unwrap<
    (CompanyVoiceState & { subscription_status: string })[]
  >(
    await db
      .from("companies")
      .select(
        "plan,current_period_start,overage_cap_multiplier,subscription_status",
      )
      .eq("id", companyId)
      .limit(1),
    "company lookup",
  );
  const company = companies[0];
  if (!company || company.subscription_status !== "active") {
    return errorResponse(
      c,
      "subscription_inactive",
      "Your subscription isn't active.",
    );
  }
  if (await companyOverVoiceCap(db, companyId, company)) {
    return errorResponse(
      c,
      "usage_cap_reached",
      "You've reached your calling spending cap for this period.",
    );
  }

  return {
    conversation: {
      id: conversation.id,
      contact_id: conversation.contact_id,
      phone_number_id: conversation.phone_number_id,
    },
    customer,
    businessNumber,
  };
}

/**
 * POST /v1/calls/browser (D43 #135) — authorize a call the member will place
 * IN THE BROWSER via the WebRTC softphone. The server does NOT dial: it runs
 * the outbound gates + the per-conversation in-flight guard, then returns the
 * business number to present as caller ID, the customer number to dial, and
 * the `oc_customer` client_state tag the client stamps on newCall — so the
 * resulting PSTN leg records through the EXACT same webhook path as a D38
 * bridge's customer leg (one calling-minutes pool, threading, direction
 * outbound), with no agent leg and no cell. The calls row is created by the
 * webhook when the leg's events arrive (appears in /calls a beat later, then
 * live via the call.updated broadcast).
 */
callsRoutes.post("/calls/browser", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const body = await parseJsonBody(c, outboundBodySchema);

  const auth = await authorizeOutboundCall(
    c,
    db,
    companyId,
    userId,
    body.conversation_id,
  );
  if (auth instanceof Response) return auth;

  // The line model (D43): one live call per number. Refuse while an outbound
  // session for this conversation is genuinely in flight (matches the
  // stale-calls sweeper window; a wedged session re-opens it).
  const inflight = unwrap<{ id: string }[]>(
    await db
      .from("calls")
      .select("id")
      .eq("company_id", companyId)
      .eq("conversation_id", auth.conversation.id)
      .eq("direction", "outbound")
      .is("outcome", null)
      .gt("started_at", new Date(Date.now() - 4 * 60 * 60_000).toISOString())
      .limit(1),
    "in-flight lookup",
  );
  if (inflight.length > 0) {
    return errorResponse(
      c,
      "conflict",
      "A call for this conversation is already in progress.",
    );
  }

  return c.json({
    from: auth.businessNumber,
    to: auth.customer,
    client_state: buildOutboundState(OUTBOUND_CUSTOMER_STATE, auth.customer),
  });
});
