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
import { normalizeNanpPhone } from "./core/phone";

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

// A browser call can start from an existing THREAD (conversation_id), a CONTACT
// with no thread yet (contact_id — the fresh-import case), or a raw NUMBER typed
// into the DIALER (to). The optional phone_number_id chooses which business
// number presents as caller ID when the company owns more than one.
const outboundBodySchema = z
  .object({
    conversation_id: z.uuid().optional(),
    contact_id: z.uuid().optional(),
    to: z.string().trim().min(1).max(32).optional(),
    phone_number_id: z.uuid().optional(),
  })
  .refine((b) => Boolean(b.conversation_id ?? b.contact_id ?? b.to), {
    message: "Provide a conversation, a contact, or a number to call.",
  });
type OutboundBody = z.infer<typeof outboundBodySchema>;

/** The resolved parties + gate result an outbound call authorization needs.
 *  contactId is null for a dialer call to a not-yet-known number (threading
 *  find-or-creates the contact on answer). */
interface OutboundAuth {
  phoneNumberId: string;
  customer: string;
  businessNumber: string;
  contactId: string | null;
}

/**
 * Which business number presents as caller ID for a contact- or dialer-
 * originated call (a thread already names its own). An explicit, still-active
 * phone_number_id wins; otherwise the company's SOLE active number is implied;
 * a company with several must choose (the dialer's From selector sends one),
 * and a company with none can't place the call. Company-scoped throughout, so a
 * caller can never present another tenant's number.
 */
async function resolveBusinessNumber(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDb>,
  companyId: string,
  wanted: string | undefined,
): Promise<{ phoneNumberId: string; businessNumber: string } | Response> {
  const rows = unwrap<{ id: string; number_e164: string }[]>(
    await db
      .from("phone_numbers")
      .select("id,number_e164")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    "active numbers",
  );
  if (wanted) {
    const match = rows.find((r) => r.id === wanted);
    if (!match) {
      return errorResponse(c, "conflict", "That number isn't active right now.");
    }
    return { phoneNumberId: match.id, businessNumber: match.number_e164 };
  }
  if (rows.length === 0) {
    return errorResponse(c, "conflict", "You have no active number to call from.");
  }
  if (rows.length > 1) {
    return errorResponse(
      c,
      "validation_failed",
      "Choose which of your numbers to call from.",
    );
  }
  return { phoneNumberId: rows[0].id, businessNumber: rows[0].number_e164 };
}

/**
 * Shared outbound-call gates (D43 browser origination). Resolves the customer
 * number + the business number to present from whichever origin the caller
 * used — an existing THREAD, a CONTACT with no thread yet, or a raw NUMBER from
 * the dialer — then runs the SAME gates for all three: #106 'text' level on the
 * resolved number (calling is outreach), a live subscription, and the D36 voice
 * spending cap. Every lookup is company-scoped, so a caller can only ever call
 * from a number their own company owns. Returns the resolved parties, or a
 * Response to short-circuit with.
 */
async function authorizeOutboundCall(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDb>,
  companyId: string,
  userId: string,
  body: OutboundBody,
): Promise<OutboundAuth | Response> {
  let customer: string;
  let businessNumber: string;
  let phoneNumberId: string;
  let contactId: string | null = null;

  if (body.conversation_id) {
    // From an existing thread: it names the customer AND the business number.
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
    if (
      !conversation.contacts?.phone_e164 ||
      !conversation.phone_numbers?.number_e164 ||
      !conversation.phone_number_id
    ) {
      return errorResponse(
        c,
        "conflict",
        "This conversation has no callable number.",
      );
    }
    if (conversation.phone_numbers.status !== "active") {
      return errorResponse(c, "conflict", "This number isn't active right now.");
    }
    customer = conversation.contacts.phone_e164;
    businessNumber = conversation.phone_numbers.number_e164;
    phoneNumberId = conversation.phone_number_id;
    contactId = conversation.contact_id;
  } else {
    // From a contact (fresh import — no thread) or the dialer (raw number).
    // Threading find-or-creates the contact + conversation on ANSWER.
    if (body.contact_id) {
      const rows = unwrap<{ phone_e164: string }[]>(
        await db
          .from("contacts")
          .select("phone_e164")
          .eq("company_id", companyId)
          .eq("id", body.contact_id)
          .limit(1),
        "contact lookup",
      );
      if (!rows[0]) {
        return errorResponse(c, "not_found", "No such contact.");
      }
      customer = rows[0].phone_e164;
      contactId = body.contact_id;
    } else {
      const normalized = normalizeNanpPhone(body.to ?? "");
      if (!normalized) {
        return errorResponse(
          c,
          "validation_failed",
          "Enter a valid US or Canada number.",
        );
      }
      customer = normalized;
    }
    const resolved = await resolveBusinessNumber(
      c,
      db,
      companyId,
      body.phone_number_id,
    );
    if (resolved instanceof Response) return resolved;
    phoneNumberId = resolved.phoneNumberId;
    businessNumber = resolved.businessNumber;
  }

  // US/CA only, on EVERY origin (defense in depth — the dialer already
  // NANP-normalizes; a contact/thread could in theory hold a non-NANP number).
  // normalizeNanpPhone consults the shared US/CA table (EXCLUDES Caribbean +1,
  // the toll-pumping target) — a bare `+1[2-9]…` regex would let 876/etc.
  // through. The webhook re-validates the real dialed number too (#136).
  if (!normalizeNanpPhone(customer)) {
    return errorResponse(
      c,
      "validation_failed",
      "Calling is available to US and Canada numbers only.",
    );
  }

  await assertNumberLevel(db, {
    companyId,
    userId,
    role: c.get("role"),
    phoneNumberId,
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

  return { phoneNumberId, customer, businessNumber, contactId };
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

  const auth = await authorizeOutboundCall(c, db, companyId, userId, body);
  if (auth instanceof Response) return auth;

  // The line model (D43 phase 3, founder-binding): ONE live call per phone
  // NUMBER — a held call still occupies its line. Claim the line AND mint the
  // single-use authorization ATOMICALLY, under the same per-(company,number)
  // advisory lock the inbound claim uses. The authorization row doubles as the
  // line reservation (the calls row lands only later at call.initiated), so
  // two concurrent outbound calls — or an inbound call during the
  // authorize→initiate window — can never both go live. The nonce also binds
  // the call to this authenticated member's OWN company/number/caller-ID, so
  // the browser can never present a number, or place a call, it wasn't
  // authorized for (closes cross-tenant caller-ID billing, the note-only #106
  // bypass, and forged/omitted client_state).
  const nonce = crypto.randomUUID();
  const claimed = unwrap<boolean>(
    await db.rpc("api_claim_outbound_line", {
      p_company_id: companyId,
      p_phone_number_id: auth.phoneNumberId,
      p_nonce: nonce,
      p_from: auth.businessNumber,
      p_customer: auth.customer,
      p_window_start: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
    }),
    "outbound line claim",
  );
  if (claimed !== true) {
    return errorResponse(
      c,
      "conflict",
      "This line is on another call right now.",
    );
  }

  return c.json({
    from: auth.businessNumber,
    to: auth.customer,
    client_state: buildOutboundState(
      OUTBOUND_CUSTOMER_STATE,
      auth.customer,
      nonce,
    ),
  });
});
