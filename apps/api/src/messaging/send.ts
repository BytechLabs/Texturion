/**
 * Shared outbound-send core (SPEC §5, §7, §8, §10) used by
 * POST /v1/messages/send and POST /v1/conversations:
 *
 *   pre-gates (subscription → US/CA destination → per-destination
 *   registration, in exactly the §7 order) → §5 first-message footer →
 *   gate_outbound_send RPC (atomic opt-out / rate / cap checks + the
 *   insert-before-call queued row) → Telnyx POST /v2/messages → persist
 *   telnyx_message_id, or status='failed' + surfaced error on API failure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupAreaCode } from "@jobtext/shared";

import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { getSendGates } from "../telnyx/registration";
import type { GateResult, MessageRow } from "./types";

/**
 * SPEC §7 gate order, steps 2–4 (membership is the /v1 middleware):
 * subscription `active` (402) → destination is a US/CA NANP area code (422;
 * §10 layer 2 — `+1` alone is never enough) → per-destination registration
 * gate (403 `registration_pending`). Throws the matching ApiError.
 */
export async function runPreSendGates(
  env: Env,
  companyId: string,
  destinationE164: string,
): Promise<void> {
  const gates = await getSendGates(env, companyId);
  if (!gates.subscriptionActive) {
    throw new ApiError(
      "subscription_inactive",
      "Outbound texting requires an active subscription.",
    );
  }

  const entry = lookupAreaCode(destinationE164);
  if (!entry) {
    throw new ApiError(
      "validation_failed",
      "Destination must be a US or Canada number.",
    );
  }

  if (entry.country === "US" && !gates.usApproved) {
    throw new ApiError(
      "registration_pending",
      "US texting activates after carrier approval (typically 3–7 business days).",
    );
  }
  if (entry.country === "CA" && !gates.caAllowed) {
    throw new ApiError(
      "registration_pending",
      "Texting Canadian numbers is not enabled for this company yet.",
    );
  }
}

/** The SPEC §5 identification footer, exactly once per contact. */
export function appendIdentificationFooter(
  body: string,
  businessName: string,
): string {
  const footer = `— ${businessName}. Reply STOP to opt out`;
  return body.length > 0 ? `${body}\n${footer}` : footer;
}

/**
 * True when the conversation contains an inbound message — replies to
 * inbound conversations are never decorated with the §5 footer.
 */
export async function conversationHasInbound(
  db: SupabaseClient,
  companyId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("messages")
    .select("id")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .limit(1);
  if (error) throw new Error(`inbound-message lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Stamp contacts.first_identification_sent_at exactly once (SPEC §5). */
export async function stampFirstIdentification(
  db: SupabaseClient,
  companyId: string,
  contactId: string,
): Promise<void> {
  const { error } = await db
    .from("contacts")
    .update({ first_identification_sent_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", contactId)
    .is("first_identification_sent_at", null);
  if (error) {
    throw new Error(`first_identification stamp failed: ${error.message}`);
  }
}

/** Error codes gate_outbound_send returns that map 1:1 onto SPEC §7 codes. */
const GATE_ERROR_CODES = new Set([
  "subscription_inactive",
  "recipient_opted_out",
  "rate_limited",
  "usage_cap_reached",
  "not_found",
  "validation_failed",
] as const);

type GateErrorCode =
  typeof GATE_ERROR_CODES extends Set<infer T> ? T : never;

const GATE_ERROR_MESSAGES: Record<GateErrorCode, string> = {
  subscription_inactive: "Outbound texting requires an active subscription.",
  recipient_opted_out: "This recipient has opted out of receiving texts.",
  rate_limited: "Sending limit reached (250 segments per hour). Try again soon.",
  usage_cap_reached:
    "Monthly usage cap reached. The owner can raise it in the usage screen.",
  not_found: "No such conversation.",
  validation_failed: "Invalid send request.",
};

/**
 * Invoke the gate_outbound_send RPC (SPEC §7/§10 atomic DB-side gates + the
 * queued insert). Gate rejections become their typed ApiError; success
 * returns the message row and whether it pre-existed (idempotent replay).
 */
export async function gateOutboundSend(
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    senderUserId: string;
    body: string;
    idempotencyKey: string;
    segmentsEstimate: number;
  },
): Promise<{ message: MessageRow; existing: boolean }> {
  const { data, error } = await db.rpc("gate_outbound_send", {
    p_company_id: args.companyId,
    p_conversation_id: args.conversationId,
    p_sender_user_id: args.senderUserId,
    p_body: args.body,
    p_idempotency_key: args.idempotencyKey,
    p_segments_estimate: args.segmentsEstimate,
  });
  if (error) throw new Error(`gate_outbound_send failed: ${error.message}`);

  const result = data as GateResult | null;
  if (result && "error" in result && typeof result.error === "string") {
    const code = result.error as GateErrorCode;
    if (GATE_ERROR_CODES.has(code)) {
      throw new ApiError(code, GATE_ERROR_MESSAGES[code]);
    }
    throw new Error(`gate_outbound_send returned unknown error: ${result.error}`);
  }
  if (!result || !("message" in result) || !result.message?.id) {
    throw new Error("gate_outbound_send returned no message row");
  }
  return { message: result.message, existing: result.existing === true };
}

const TELNYX_API_BASE = "https://api.telnyx.com";

/** A Telnyx /v2/messages API failure — surfaced, never silent (SPEC §5, §8). */
export interface TelnyxSendFailure {
  errorCode: string | null;
  errorDetail: string;
}

type TelnyxSendResult =
  | { ok: true; telnyxMessageId: string }
  | ({ ok: false } & TelnyxSendFailure);

/** Telnyx POST /v2/messages (SPEC §8): from, to, text, media_urls. */
async function telnyxCreateMessage(
  env: Env,
  args: { from: string; to: string; text: string; mediaUrls: string[] },
): Promise<TelnyxSendResult> {
  let response: Response;
  try {
    response = await fetch(`${TELNYX_API_BASE}/v2/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        text: args.text,
        ...(args.mediaUrls.length > 0 ? { media_urls: args.mediaUrls } : {}),
      }),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, errorCode: null, errorDetail: `network error: ${detail}` };
  }

  if (!response.ok) {
    let errorCode: string | null = null;
    let errorDetail = `Telnyx API error (HTTP ${response.status})`;
    try {
      const body = (await response.json()) as {
        errors?: { code?: string; title?: string; detail?: string }[];
      };
      const first = body.errors?.[0];
      if (first) {
        errorCode = typeof first.code === "string" ? first.code : null;
        errorDetail = first.detail || first.title || errorDetail;
      }
    } catch {
      // Non-JSON error body: keep the HTTP-status detail.
    }
    return { ok: false, errorCode, errorDetail };
  }

  const body = (await response.json()) as { data?: { id?: string } };
  const telnyxMessageId = body.data?.id;
  if (typeof telnyxMessageId !== "string" || telnyxMessageId.length === 0) {
    return {
      ok: false,
      errorCode: null,
      errorDetail: "Telnyx response carried no message id",
    };
  }
  return { ok: true, telnyxMessageId };
}

/**
 * The send-lifecycle tail (SPEC §8): Telnyx call → persist telnyx_message_id
 * on success, or status='failed' + error columns on API failure (retryable
 * via POST /v1/messages/:id/retry while telnyx_message_id IS NULL, §7).
 * Returns the updated message row either way — failures are surfaced on the
 * row, never thrown away.
 */
export async function dispatchOutbound(
  env: Env,
  db: SupabaseClient,
  message: MessageRow,
  args: { from: string; to: string; text: string; mediaUrls: string[] },
): Promise<MessageRow> {
  const result = await telnyxCreateMessage(env, args);

  const patch = result.ok
    ? { telnyx_message_id: result.telnyxMessageId }
    : {
        status: "failed" as const,
        error_code: result.errorCode,
        error_detail: result.errorDetail.slice(0, 2000),
      };
  const { data, error } = await db
    .from("messages")
    .update(patch)
    .eq("id", message.id)
    .eq("company_id", message.company_id)
    .select("*")
    .limit(1);
  if (error) throw new Error(`message persist failed: ${error.message}`);
  const row = (data ?? [])[0] as MessageRow | undefined;
  if (!row) throw new Error(`message ${message.id} vanished during send`);
  return row;
}
