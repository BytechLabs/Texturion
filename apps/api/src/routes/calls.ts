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
import { runPreSendGates } from "../messaging/send";
import {
  buildOutboundState,
  companyOverVoiceCap,
  OUTBOUND_AGENT_STATE,
  OUTBOUND_AGENT_TIMEOUT_SECS,
  OUTBOUND_CUSTOMER_STATE,
  type CompanyVoiceState,
} from "../messaging/voice-webhook";
import { TelnyxApiError, telnyxRequest } from "../telnyx/client";
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

const verifyBodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const outboundBodySchema = z.object({
  conversation_id: z.uuid(),
});

// D40 verification knobs. Every code send is a real Telnyx charge on US —
// the window cap is the durable ceiling (cost-protection), the cooldown
// stops accidental double-taps, and VERIFY_RATE_LIMITER (shared binding)
// bounds burst rate per TARGET cell across the whole platform.
const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_COOLDOWN_MS = 60_000;
const CODE_WINDOW_MS = 24 * 60 * 60_000;
const CODE_WINDOW_MAX_SENDS = 6;

/** The member's verification state as company_members persists it. */
interface CellRow {
  call_cell_e164: string | null;
  call_cell_verified_at: string | null;
  call_cell_code_hash: string | null;
  call_cell_code_expires_at: string | null;
  call_cell_code_attempts: number;
  call_cell_code_sent_at: string | null;
  call_cell_code_window_start: string | null;
  call_cell_code_window_sends: number;
}

const CELL_COLUMNS =
  "call_cell_e164,call_cell_verified_at,call_cell_code_hash," +
  "call_cell_code_expires_at,call_cell_code_attempts,call_cell_code_sent_at," +
  "call_cell_code_window_start,call_cell_code_window_sends";

async function readCellRow(
  db: ReturnType<typeof getDb>,
  companyId: string,
  userId: string,
): Promise<CellRow | null> {
  const rows = unwrap<CellRow[]>(
    await db
      .from("company_members")
      .select(CELL_COLUMNS)
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1),
    "membership lookup",
  );
  return rows[0] ?? null;
}

/** sha-256 hex of the code scoped to the membership AND the cell it was
 *  texted to — never the raw code. The cell in the preimage means a code can
 *  only ever verify the exact number it was sent to (defense in depth under
 *  the verify handler's guarded success UPDATE). */
async function hashCellCode(
  companyId: string,
  userId: string,
  cell: string,
  code: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `${companyId}:${userId}:${cell}:${code}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function mintCellCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

/**
 * GET/PUT /v1/calls/cell (D38, verification D40/#133) — the member's OWN
 * cell the outbound bridge rings first. Self-service per membership (any
 * active member), never another member's row.
 *
 * PUT with a number texts a 6-digit code to it from the company's business
 * number (a raw Telnyx send: no messages row, no usage_events, never
 * metered — it is our operational cost, capped by the window budget). The
 * cell stays UNDIALABLE until POST /v1/calls/cell/verify confirms the code:
 * possession, not just syntax, is what lets the platform ring a phone. A
 * PUT of the same unverified number re-sends (cooldown-gated); a PUT of the
 * already-verified number is a no-op; null clears everything.
 */
callsRoutes.get("/calls/cell", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  const row = await readCellRow(db, c.get("companyId"), c.get("userId"));
  return c.json({
    call_cell_e164: row?.call_cell_e164 ?? null,
    verified: row?.call_cell_verified_at != null,
  });
});

callsRoutes.put("/calls/cell", requireRole("member"), async (c) => {
  const body = await parseJsonBody(c, cellBodySchema);
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");

  // Clearing the cell clears the whole verification state with it.
  if (body.call_cell_e164 === null) {
    unwrap(
      await db
        .from("company_members")
        .update({
          call_cell_e164: null,
          call_cell_verified_at: null,
          call_cell_code_hash: null,
          call_cell_code_expires_at: null,
          call_cell_code_attempts: 0,
        })
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .select("id"),
      "call cell clear",
    );
    return c.json({ call_cell_e164: null, verified: false, code_sent: false });
  }

  const cell = body.call_cell_e164;
  const current = await readCellRow(db, companyId, userId);

  // Saving the number that is already verified changes nothing — the web
  // settings card PUTs on save, and a no-op save must not burn a code.
  if (current?.call_cell_e164 === cell && current.call_cell_verified_at) {
    return c.json({ call_cell_e164: cell, verified: true, code_sent: false });
  }

  // Burst gate on the TARGET cell (platform-wide — a member id is free to
  // mint, the victim's phone number is the resource being protected).
  if (env.VERIFY_RATE_LIMITER) {
    const { success } = await env.VERIFY_RATE_LIMITER.limit({
      key: `call-cell-code:${cell}`,
    });
    if (!success) {
      return errorResponse(
        c,
        "rate_limited",
        "Too many codes requested for this number. Wait a minute and try again.",
      );
    }
  }

  const now = Date.now();
  const sentAt = current?.call_cell_code_sent_at
    ? Date.parse(current.call_cell_code_sent_at)
    : null;
  if (sentAt !== null && now - sentAt < CODE_RESEND_COOLDOWN_MS) {
    return errorResponse(
      c,
      "rate_limited",
      "We just texted you a code. Give it a minute to arrive, then try again.",
    );
  }

  // Durable send budget: N codes per rolling window, whatever the number.
  const windowStart = current?.call_cell_code_window_start
    ? Date.parse(current.call_cell_code_window_start)
    : null;
  const windowLive = windowStart !== null && now - windowStart < CODE_WINDOW_MS;
  const windowSends = windowLive ? (current?.call_cell_code_window_sends ?? 0) : 0;
  if (windowSends >= CODE_WINDOW_MAX_SENDS) {
    return errorResponse(
      c,
      "conflict",
      "Too many verification codes today. Try again tomorrow, or contact support.",
    );
  }

  // The code arrives FROM the business number — the same compliance gates as
  // any send from it (subscription, US/CA destination, 10DLC for US).
  const numbers = unwrap<{ number_e164: string | null }[]>(
    await db
      .from("phone_numbers")
      .select("number_e164")
      .eq("company_id", companyId)
      .eq("status", "active")
      .not("number_e164", "is", null)
      .order("created_at", { ascending: true })
      .limit(1),
    "sending number lookup",
  );
  const fromNumber = numbers[0]?.number_e164;
  if (!fromNumber) {
    return errorResponse(
      c,
      "conflict",
      "Your workspace needs an active number before we can text you a code.",
    );
  }
  await runPreSendGates(env, companyId, cell);

  // A prior STOP from this cell to this business would make Telnyx drop the
  // code invisibly (no messages row to fail onto) — surface it honestly.
  const optOuts = unwrap<{ id: string }[]>(
    await db
      .from("opt_outs")
      .select("id")
      .eq("company_id", companyId)
      .eq("phone_e164", cell)
      .is("revoked_at", null)
      .limit(1),
    "opt-out lookup",
  );
  if (optOuts.length > 0) {
    return errorResponse(
      c,
      "conflict",
      `This number has texted STOP to your business number. Text START to ${fromNumber} from it first, then try again.`,
    );
  }

  const code = mintCellCode();
  const codeHash = await hashCellCode(companyId, userId, cell, code);
  const nowIso = new Date(now).toISOString();

  // Persist BEFORE the send (fail-closed: a crash between the two costs the
  // member a resend, never an unbilled/untracked send). The window counter is
  // a GUARDED increment (#133 review): the UPDATE only lands while the row
  // still holds the observed send count, so concurrent PUTs collapse to one
  // send — the durable 6/24h budget is enforced, not merely observed.
  const persisted = unwrap<{ id: string }[]>(
    await db
      .from("company_members")
      .update({
        call_cell_e164: cell,
        call_cell_verified_at: null,
        call_cell_code_hash: codeHash,
        call_cell_code_expires_at: new Date(now + CODE_TTL_MS).toISOString(),
        call_cell_code_attempts: 0,
        call_cell_code_sent_at: nowIso,
        call_cell_code_window_start: windowLive
          ? current?.call_cell_code_window_start
          : nowIso,
        call_cell_code_window_sends: windowSends + 1,
      })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq(
        "call_cell_code_window_sends",
        current?.call_cell_code_window_sends ?? 0,
      )
      .select("id"),
    "call cell update",
  );
  if (persisted.length === 0) {
    return errorResponse(
      c,
      "rate_limited",
      "Another code request just went through. Give it a minute.",
    );
  }

  try {
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/messages",
      body: {
        from: fromNumber,
        to: cell,
        text: `${code} is your Loonext code to confirm this cell for calling. It expires in 10 minutes. Not you? Ignore this text.`,
      },
      idempotencyKey: `call-cell-code:${companyId}:${userId}:${nowIso}`,
    });
  } catch (cause) {
    if (cause instanceof TelnyxApiError) {
      return errorResponse(
        c,
        "conflict",
        "We couldn't text that number right now. Check the number and try again.",
      );
    }
    throw cause;
  }

  return c.json({ call_cell_e164: cell, verified: false, code_sent: true });
});

/**
 * POST /v1/calls/cell/verify (D40) — check the texted code. Attempts are
 * consumed BEFORE comparison (guarded increment) so a brute-force burst
 * cannot outrun the counter; at the cap or past expiry the member simply
 * requests a fresh code.
 */
callsRoutes.post("/calls/cell/verify", requireRole("member"), async (c) => {
  const body = await parseJsonBody(c, verifyBodySchema);
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");

  if (env.VERIFY_RATE_LIMITER) {
    const { success } = await env.VERIFY_RATE_LIMITER.limit({
      key: `call-cell-check:${companyId}:${userId}`,
    });
    if (!success) {
      return errorResponse(
        c,
        "rate_limited",
        "Too many code attempts. Wait a minute and try again.",
      );
    }
  }

  const current = await readCellRow(db, companyId, userId);
  if (!current?.call_cell_e164 || !current.call_cell_code_hash) {
    return errorResponse(
      c,
      "conflict",
      "No code is pending. Save your cell number to get one.",
    );
  }
  if (current.call_cell_verified_at) {
    return c.json({ call_cell_e164: current.call_cell_e164, verified: true });
  }

  // Consume an attempt first — the guarded UPDATE only lands below the cap,
  // so concurrent guesses cannot exceed CODE_MAX_ATTEMPTS comparisons.
  const consumed = unwrap<{ call_cell_code_attempts: number }[]>(
    await db
      .from("company_members")
      .update({
        call_cell_code_attempts: current.call_cell_code_attempts + 1,
      })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("call_cell_code_attempts", current.call_cell_code_attempts)
      .lt("call_cell_code_attempts", CODE_MAX_ATTEMPTS)
      .select("call_cell_code_attempts"),
    "attempt consume",
  );
  if (consumed.length === 0) {
    return errorResponse(
      c,
      "conflict",
      "Too many tries for that code. Request a new one.",
    );
  }

  const expiresAt = current.call_cell_code_expires_at
    ? Date.parse(current.call_cell_code_expires_at)
    : 0;
  if (Date.now() > expiresAt) {
    return errorResponse(
      c,
      "conflict",
      "That code expired. Request a new one.",
    );
  }

  const codeHash = await hashCellCode(
    companyId,
    userId,
    current.call_cell_e164,
    body.code,
  );
  if (codeHash !== current.call_cell_code_hash) {
    return errorResponse(
      c,
      "validation_failed",
      "That code didn't match. Check the text and try again.",
    );
  }

  // Guarded success (#133 review): the UPDATE only lands while the row still
  // holds the SAME cell and the SAME pending hash this handler compared —
  // a concurrent PUT that changed (or cleared) the number between our read
  // and here makes this match zero rows, so a code can never verify a
  // number it was not texted to. Belt and braces with the cell-scoped hash.
  const stamped = unwrap<{ id: string }[]>(
    await db
      .from("company_members")
      .update({
        call_cell_verified_at: new Date().toISOString(),
        call_cell_code_hash: null,
        call_cell_code_expires_at: null,
        call_cell_code_attempts: 0,
      })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("call_cell_e164", current.call_cell_e164)
      .eq("call_cell_code_hash", current.call_cell_code_hash)
      .select("id"),
    "cell verify",
  );
  if (stamped.length === 0) {
    return errorResponse(
      c,
      "conflict",
      "Your cell changed while verifying. Request a new code.",
    );
  }
  return c.json({ call_cell_e164: current.call_cell_e164, verified: true });
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
 *
 * D43 (#135): superseded by /calls/browser (the softphone) — kept as the
 * fallback path for devices without a mic until browser calling is proven,
 * then deleted with forwarding + cell verification.
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
  // #134/D42: calling is included on every plan — no module gate. The live
  // subscription check above is the only packaging gate.
  if (await companyOverVoiceCap(db, companyId, company)) {
    return errorResponse(
      c,
      "usage_cap_reached",
      "You've reached your calling spending cap for this period.",
    );
  }

  const members = unwrap<
    { call_cell_e164: string | null; call_cell_verified_at: string | null }[]
  >(
    await db
      .from("company_members")
      .select("call_cell_e164,call_cell_verified_at")
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
  // D40: possession, not syntax — the bridge never dials an unverified cell
  // (a typo would ring a stranger with the business number; worse, bridge
  // them to a customer).
  if (!members[0]?.call_cell_verified_at) {
    return errorResponse(
      c,
      "conflict",
      "Confirm your cell first — enter the code we texted you.",
    );
  }

  // #133 double-dial guard, layer 1 — honest state: refuse while an outbound
  // session for this conversation is genuinely in flight. The window matches
  // the stale-calls sweeper (4h) so the guard holds for the WHOLE life of a
  // bridged call (they can legally run to Telnyx's hour cap), and a wedged
  // session re-opens the guard the moment the sweeper flips it.
  const inflight = unwrap<{ id: string }[]>(
    await db
      .from("calls")
      .select("id")
      .eq("company_id", companyId)
      .eq("conversation_id", conversation.id)
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

  // Layer 2 — the ATOMIC claim (#133 review): the state check above is
  // check-then-act, and the race window spans the whole Telnyx round-trip;
  // two concurrent POSTs would both pass it and both dial (double spend, the
  // customer rung twice). The lease upsert lands for exactly ONE concurrent
  // caller; it is released once the calls row is durably visible (from then
  // on layer 1 guards) or on any dial failure, and a crashed worker's lease
  // simply expires (2 min TTL).
  const claimed = unwrap<boolean>(
    await db.rpc("api_claim_outbound_dial", {
      p_company_id: companyId,
      p_conversation_id: conversation.id,
    }),
    "dial claim",
  );
  if (claimed !== true) {
    return errorResponse(
      c,
      "conflict",
      "A call for this conversation is already being started.",
    );
  }

  const releaseLease = async () => {
    const { error } = await db
      .from("outbound_dial_leases")
      .delete()
      .eq("conversation_id", conversation.id);
    if (error) {
      // Non-fatal: an unreleased lease expires in 2 minutes on its own.
      console.error(
        `dial lease release failed for ${conversation.id}: ${error.message}`,
      );
    }
  };

  // Dial the AGENT leg: business number → the member's cell, AMD on.
  let dial: { data?: { call_session_id?: string; call_control_id?: string } };
  try {
    dial = await telnyxRequest<{
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
  } catch (cause) {
    await releaseLease();
    throw cause;
  }
  const callSessionId = dial.data?.call_session_id;
  const callControlId = dial.data?.call_control_id;

  // A dial Telnyx accepted but did not identify can't be tracked, gated, or
  // linked — hang it up rather than let an orphan leg ring (#133).
  if (!callSessionId) {
    await hangupQuietly(env, callControlId);
    await releaseLease();
    return errorResponse(
      c,
      "conflict",
      "The call couldn't be started. Try again.",
    );
  }

  // Pre-create the session row (in-flight, outcome null) and link it — the
  // conversation is known HERE, so /calls shows the call immediately and the
  // webhook merge converges onto the same row. If persisting fails, the
  // member's phone is ALREADY ringing a call we can no longer track or guard
  // against double-dialing — compensate by hanging the leg up before
  // surfacing the error (#133; the error copy invites a retry, which must be
  // safe).
  try {
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
  } catch (cause) {
    await hangupQuietly(env, callControlId);
    await releaseLease();
    throw cause;
  }
  // The linked row is visible — layer 1 takes over from here.
  await releaseLease();

  return c.json({ status: "dialing", call_session_id: callSessionId }, 202);
});

/** Best-effort agent-leg hangup for #133 dial compensation — the caller is
 *  already returning an error; a failed hangup must not mask it. */
async function hangupQuietly(
  env: ReturnType<typeof getEnv>,
  callControlId: string | undefined,
): Promise<void> {
  if (!callControlId) return;
  try {
    await telnyxRequest(env, {
      method: "POST",
      path: `/v2/calls/${callControlId}/actions/hangup`,
      body: {},
    });
  } catch (cause) {
    console.error(
      `outbound dial compensation hangup failed for ${callControlId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
