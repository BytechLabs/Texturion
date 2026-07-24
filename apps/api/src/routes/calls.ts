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
 *
 * `?contact_id=<uuid>` (#205) narrows to one contact's calls (the per-contact
 * history surface). It composes with `outcome`, keeps the same keyset cursor,
 * and the #106 deny list still applies inside the SQL: a restricted member
 * cannot see a hidden number's calls by asking for the contact directly.
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
import { resolveActorNames } from "./core/attribution";
import {
  buildOutboundState,
  companyOverVoiceCap,
  OUTBOUND_CUSTOMER_STATE,
  type CompanyVoiceState,
} from "../messaging/voice-webhook";
import {
  LOONEXT_SESSION_HEADER,
  RING_TIMEOUT_SECS,
  VOICEMAILS_BUCKET,
} from "../messaging/inbound-ring";
import { telnyxRequest, TelnyxApiError } from "../telnyx/client";
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
  // #205: optional per-contact narrowing for the contact history surface.
  contact_id: z.uuid().optional(),
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
  /** #191 attribution: the display name of the acting member — the PLACER for an
   *  outbound call ("{name} called"), the ANSWERER for an inbound one ("Answered
   *  by {name}"). Resolved from answered_by_user_id via a batched profiles lookup
   *  (same mechanism as contact attribution). Null when the actor is unknown (a
   *  pre-#211 outbound row, an un-answered inbound call, or a blank profile), so
   *  the client omits the attribution line rather than showing an empty one. */
  answered_by_name: string | null;
  /** #208: the DO's state mirror (ended_% = terminal even while outcome lags). */
  state: string | null;
  /** #210: when the call was answered — the live-duration anchor. */
  answered_at: string | null;
  started_at: string;
}

export const callsRoutes = new Hono<AppEnv>();

callsRoutes.get("/calls", requireRole("member"), async (c) => {
  const query = parseWith(listQuerySchema, {
    outcome: c.req.query("outcome"),
    contact_id: c.req.query("contact_id"),
  });
  const limit = parseLimit(c, 25, 100);
  const cursor = parseCursor(c);

  const db = getDb(getEnv(c.env));
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });
  const rows = unwrap<Omit<CallRow, "answered_by_name">[]>(
    await db.rpc("api_list_calls", {
      p_company_id: c.get("companyId"),
      p_limit: limit + 1,
      p_outcome: query.outcome ?? null,
      p_cursor_ts: cursor?.ts ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_hidden_number_ids: access.hiddenNumberIds,
      p_contact_id: query.contact_id ?? null,
    }),
    "calls list",
  );
  // #191 attribution: name the acting member — the placer of an outbound call, the
  // answerer of an inbound one (both land in answered_by_user_id). One batched
  // profiles lookup for the page; a row with no actor / blank profile stays null.
  const actorNames = await resolveActorNames(
    db,
    rows.map((r) => r.answered_by_user_id),
  );
  const enriched: CallRow[] = rows.map((r) => ({
    ...r,
    answered_by_name: r.answered_by_user_id
      ? actorNames.get(r.answered_by_user_id) ?? null
      : null,
  }));
  return c.json(buildPage(enriched, limit, "started_at"));
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

/** #144: committed-minutes reserve per already-live outbound call when checking
 *  the spending cap. A conservative estimate (2 min) — big enough to stop a
 *  near-cap tenant from fanning out several concurrent new calls, small enough
 *  that it only ever bites within a couple minutes of the cap. In-flight calls
 *  are never dropped (a soft cap); they finish and bill their real talk time. */
const OUTBOUND_LIVE_CALL_RESERVE_SECS = 120;

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
  // #144: reserve committed minutes for the company's already-live outbound
  // calls (they bill only on hangup, so they're invisible to the terminated-
  // usage cap check). Without this, a tenant AT the cap could start one call
  // per number simultaneously — each passing the same pre-answer boundary — and
  // overshoot. Counting live outbound calls tightens the boundary only near the
  // cap; a crew comfortably under it is never affected. (The exact same-instant
  // double-start before either row exists remains bounded by the runaway
  // ceiling in sweepStaleCalls.)
  const liveOutbound = unwrap<{ id: string }[]>(
    await db
      .from("calls")
      .select("id")
      .eq("company_id", companyId)
      .eq("direction", "outbound")
      .is("outcome", null)
      .not("customer_call_control_id", "is", null)
      .limit(50),
    "live outbound count",
  );
  const reserveSeconds = liveOutbound.length * OUTBOUND_LIVE_CALL_RESERVE_SECS;
  if (await companyOverVoiceCap(db, companyId, company, reserveSeconds)) {
    return errorResponse(
      c,
      "usage_cap_reached",
      "You've reached your calling spending cap for this period.",
    );
  }

  return { phoneNumberId, customer, businessNumber, contactId };
}

/**
 * POST /v1/calls/browser (D43 #135, #213) — place an outbound call. The SERVER
 * dials the customer (not the browser): it runs the outbound gates + the
 * per-conversation in-flight guard + claims the line, then dials the customer as
 * a real Call-Control PSTN leg (the oc leg) on the voice connection. That leg's
 * call.initiated mints the outbound CallSessionDO, which stamps
 * customer_call_control_id = THIS controllable customer leg (the #213 fix — the
 * browser dialing the customer previously produced only the placer's WebRTC leg,
 * so the transfer bridge-steal grabbed the wrong leg and dropped the customer)
 * and rings the PLACER's own softphone (the op leg); the placer's browser
 * auto-answers by X-Loonext-Session correlation and the DO bridges op↔oc.
 *
 * Returns { from, to, call_session_id }: the business number to present, the
 * customer number (for the "Calling …" display), and S (the ONE id the client
 * addresses the live call by). The client NO LONGER dials — it waits for the op
 * INVITE and auto-answers it. `client_state` is still returned for wire-shape
 * stability but is no longer used by the client.
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
  // #211 identity-at-authorize (ONE-id): mint the server session id S HERE and
  // bind it to the nonce in the claim. S is the client's live-call session id,
  // the client_state tag's part-4, the DO idFromName key, AND the calls-row PK,
  // all one value by construction; the DO MACHINE itself is still minted
  // webhook-side at call.initiated (nonce consumption + row create under S).
  const sessionId = crypto.randomUUID();
  const claimed = unwrap<boolean>(
    await db.rpc("api_claim_outbound_line", {
      p_company_id: companyId,
      p_phone_number_id: auth.phoneNumberId,
      p_nonce: nonce,
      p_from: auth.businessNumber,
      p_customer: auth.customer,
      p_window_start: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
      // Store S + the placing member on the reservation so
      // api_authorize_outbound_call derives the calls-row PK from the STORED S,
      // never the caller's tag.
      p_call_session_id: sessionId,
      p_user_id: userId,
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

  // #213: SERVER-dial the customer as a real, controllable Call-Control PSTN leg
  // on the voice connection. This leg's call.initiated flows through the SAME
  // loadOutboundInitiatedContext path (nonce consume → row under S → stamp
  // customer_call_control_id = THIS leg), so customer_call_control_id is finally
  // the real customer (not the placer's browser leg). The 4-part oc client_state
  // + X-Loonext-Session=S route it to the DO keyed on S; the ring timeout bounds
  // how long the customer's phone rings.
  const clientState = buildOutboundState(
    OUTBOUND_CUSTOMER_STATE,
    auth.customer,
    nonce,
    sessionId,
  );
  try {
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/calls",
      body: {
        connection_id: env.TELNYX_VOICE_CONNECTION_ID,
        to: auth.customer,
        from: auth.businessNumber,
        timeout_secs: RING_TIMEOUT_SECS,
        client_state: clientState,
        custom_headers: [{ name: LOONEXT_SESSION_HEADER, value: sessionId }],
      },
    });
  } catch (cause) {
    // A 4xx is a DEFINITE refusal (no leg was created) → release the line
    // reservation so the member isn't wedged "on another call". A 5xx/timeout is
    // AMBIGUOUS (a leg MIGHT exist and its call.initiated will still mint +
    // self-heal), so leave the reservation for the webhook path to resolve. Either
    // way the failure propagates to the framework's 500 handler (the client shows
    // "Couldn't start the call") — there is no SPEC §7 code for a carrier fault.
    if (cause instanceof TelnyxApiError && cause.status < 500) {
      await db
        .from("outbound_call_authorizations")
        .delete()
        .eq("nonce", nonce)
        .eq("company_id", companyId);
    }
    throw cause instanceof Error
      ? cause
      : new Error("outbound customer dial failed");
  }

  return c.json({
    from: auth.businessNumber,
    to: auth.customer,
    // Wire-shape stability only — the client no longer dials with this (#213).
    client_state: clientState,
    // #211: the client seeds its live-call sessionId from this at placement, then
    // waits for the op INVITE (X-Loonext-Session=S) and auto-answers it. The
    // transfer/consult affordance lights only on a serverAddressable read.
    call_session_id: sessionId,
  });
});
