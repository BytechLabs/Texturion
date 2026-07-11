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
import { Hono } from "hono";
import { z } from "zod";

import { requireRole } from "../auth/company";
import { assertNumberLevel, resolveNumberAccess } from "../auth/number-access";
import { isModuleEnabled } from "../billing/company-modules";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { buildPage } from "../http/pagination";
import {
  buildOutboundState,
  companyOverVoiceCap,
  OUTBOUND_AGENT_STATE,
  OUTBOUND_AGENT_TIMEOUT_SECS,
  type CompanyVoiceState,
} from "../messaging/voice-webhook";
import { telnyxRequest } from "../telnyx/client";
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
  caller_e164: string | null;
  contact_id: string | null;
  contact_name: string | null;
  phone_number_id: string | null;
  conversation_id: string | null;
  outcome: "answered" | "voicemail" | "missed" | null;
  forward_seconds: number;
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

/** D38: the member's own cell (NANP), matching companies.forward_to_cell. */
const CELL_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

const cellBodySchema = z.object({
  call_cell_e164: z.string().regex(CELL_E164).nullable(),
});

const outboundBodySchema = z.object({
  conversation_id: z.uuid(),
});

/**
 * GET/PUT /v1/calls/cell (D38) — the member's OWN cell the outbound bridge
 * rings first. Self-service per membership (any active member), never
 * another member's row.
 */
callsRoutes.get("/calls/cell", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  const rows = unwrap<{ call_cell_e164: string | null }[]>(
    await db
      .from("company_members")
      .select("call_cell_e164")
      .eq("company_id", c.get("companyId"))
      .eq("user_id", c.get("userId"))
      .limit(1),
    "membership lookup",
  );
  return c.json({ call_cell_e164: rows[0]?.call_cell_e164 ?? null });
});

callsRoutes.put("/calls/cell", requireRole("member"), async (c) => {
  const body = await parseJsonBody(c, cellBodySchema);
  const db = getDb(getEnv(c.env));
  const rows = unwrap<{ call_cell_e164: string | null }[]>(
    await db
      .from("company_members")
      .update({ call_cell_e164: body.call_cell_e164 })
      .eq("company_id", c.get("companyId"))
      .eq("user_id", c.get("userId"))
      .select("call_cell_e164"),
    "call cell update",
  );
  return c.json({ call_cell_e164: rows[0]?.call_cell_e164 ?? null });
});

/**
 * POST /v1/calls (D38 outbound bridge, docs/CALLS-FEATURE.md) — click-to-call
 * from a conversation: dial the member's cell FROM the business number (AMD
 * on, so their voicemail can never be bridged), then the webhook connects
 * them to the customer on a human/undetermined verdict. Gates, in order:
 * active membership (member+), #106 'text' level on the conversation's
 * number (calling is outreach, like texting), live subscription, the voice
 * module, the member's cell configured, and the D36 voice spending cap —
 * the same boundary that pauses inbound forwarding. The calls session row is
 * pre-created (direction outbound, linked to the conversation) so the call
 * appears in /calls immediately as in-flight.
 */
callsRoutes.post("/calls", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");
  const body = await parseJsonBody(c, outboundBodySchema);

  // The conversation names the customer AND the business number to present.
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
      .eq("id", body.conversation_id)
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

  // #106: calling a customer is outreach — the same 'text' level as sending.
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
  if (!(await isModuleEnabled(db, companyId, "voice"))) {
    return errorResponse(
      c,
      "conflict",
      "Calling needs the Call forwarding add-on.",
    );
  }
  if (await companyOverVoiceCap(db, companyId, company)) {
    return errorResponse(
      c,
      "usage_cap_reached",
      "You've reached your calling spending cap for this period.",
    );
  }

  const members = unwrap<{ call_cell_e164: string | null }[]>(
    await db
      .from("company_members")
      .select("call_cell_e164")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1),
    "membership lookup",
  );
  const agentCell = members[0]?.call_cell_e164;
  if (!agentCell) {
    return errorResponse(
      c,
      "conflict",
      "Set your cell number for calls first.",
    );
  }

  // Dial the AGENT leg: business number → the member's cell, AMD on.
  const dial = await telnyxRequest<{
    data?: { call_session_id?: string; call_control_id?: string };
  }>(env, {
    method: "POST",
    path: "/v2/calls",
    body: {
      connection_id: env.TELNYX_VOICE_CONNECTION_ID,
      to: agentCell,
      from: businessNumber,
      timeout_secs: OUTBOUND_AGENT_TIMEOUT_SECS,
      answering_machine_detection: "detect",
      client_state: buildOutboundState(OUTBOUND_AGENT_STATE, customer),
    },
  });
  const callSessionId = dial.data?.call_session_id;

  // Pre-create the session row (in-flight, outcome null) and link it — the
  // conversation is known HERE, so /calls shows the call immediately and the
  // webhook merge converges onto the same row.
  if (callSessionId) {
    unwrap(
      await db.rpc("api_upsert_call", {
        p_company_id: companyId,
        p_phone_number_id: conversation.phone_number_id,
        p_call_session_id: callSessionId,
        p_caller_e164: customer,
        p_outcome: null,
        p_forward_seconds: 0,
        p_started_at: new Date().toISOString(),
        p_ended_at: null,
        p_direction: "outbound",
      }),
      "call session create",
    );
    unwrap(
      await db
        .from("calls")
        .update({
          contact_id: conversation.contact_id,
          conversation_id: conversation.id,
        })
        .eq("call_session_id", callSessionId)
        .is("conversation_id", null)
        .select("id"),
      "call session link",
    );
  }

  return c.json(
    { status: "dialing", call_session_id: callSessionId ?? null },
    202,
  );
});
