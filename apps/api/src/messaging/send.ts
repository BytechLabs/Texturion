/**
 * Shared outbound-send core (SPEC §5, §7, §8, §10) used by
 * POST /v1/messages/send and POST /v1/conversations:
 *
 *   pre-gates (subscription → US/CA destination → per-destination
 *   registration, in exactly the §7 order) → gate_outbound_send RPC
 *   (atomic opt-out / rate / cap checks + the insert-before-call queued
 *   row) → Telnyx POST /v2/messages → persist telnyx_message_id, or
 *   status='failed' + surfaced error on API failure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupAreaCode } from "@loonext/shared";

import { capture } from "../analytics/posthog";
import { isModuleEnabled } from "../billing/company-modules";
import { PLAN_MMS_INCLUDED, type PlanId } from "../billing/plans";
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

/**
 * #20: how long an outbound row may sit `queued` without a telnyx_message_id
 * before it counts as STUCK (the send crashed between the gate insert and the
 * Telnyx call) — far beyond any Worker request's wall clock, so an in-flight
 * dispatch is never mistaken for a crash. Shared by the retry route's
 * eligibility pre-check, claim_message_retry, and the fail-out sweeper cron.
 */
export const STUCK_SEND_SECONDS = 15 * 60;

/**
 * #20: the messages.error_code a crashed-before-Telnyx send is failed out
 * with (by the route's interruption handler or the sweeper cron). Not a
 * carrier code — it marks the row retryable (failed + no telnyx_message_id,
 * §7 retry rules) with a stable machine-readable reason.
 */
export const SEND_INTERRUPTED_ERROR_CODE = "send_interrupted";

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

/**
 * Invoke the claim_message_retry RPC — the atomic arbiter for
 * POST /v1/messages/:id/retry (#19/#20/#47): eligibility re-check (failed, or
 * queued-and-stuck beyond {@link STUCK_SEND_SECONDS}), the same SQL rate/cap
 * gates a fresh send gets, and the failed→queued flip, all under the company
 * + message row locks. Exactly ONE of two concurrent retries gets the row
 * back; every other caller gets a typed ApiError (`conflict` for the loser —
 * the §7 "not retryable" code).
 */
export async function claimMessageRetry(
  db: SupabaseClient,
  args: {
    companyId: string;
    messageId: string;
    stuckAfterSeconds: number;
  },
): Promise<MessageRow> {
  const { data, error } = await db.rpc("claim_message_retry", {
    p_company_id: args.companyId,
    p_message_id: args.messageId,
    p_stuck_after_seconds: args.stuckAfterSeconds,
  });
  if (error) throw new Error(`claim_message_retry failed: ${error.message}`);

  const result = data as
    | { error?: string; message?: MessageRow }
    | null;
  if (result && typeof result.error === "string") {
    if (result.error === "conflict") {
      throw new ApiError(
        "conflict",
        "Only failed sends without a carrier message id can be retried.",
      );
    }
    const code = result.error as GateErrorCode;
    if (GATE_ERROR_CODES.has(code)) {
      throw new ApiError(code, GATE_ERROR_MESSAGES[code]);
    }
    throw new Error(
      `claim_message_retry returned unknown error: ${result.error}`,
    );
  }
  if (!result?.message?.id) {
    throw new Error("claim_message_retry returned no message row");
  }
  return result.message;
}

/**
 * Default Telnyx host; `env.TELNYX_API_BASE` overrides it (unset in production
 * → the real host). This is the SAME seam telnyx/client.ts uses, so the D31
 * launch-pass harness can retarget the outbound `/v2/messages` send at its
 * in-process fake exactly as it does every other Telnyx call.
 */
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
    response = await fetch(`${env.TELNYX_API_BASE ?? TELNYX_API_BASE}/v2/messages`, {
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

/** Persist a patch onto the message row and return the updated row. */
async function persistMessagePatch(
  db: SupabaseClient,
  message: MessageRow,
  patch: Record<string, unknown>,
): Promise<MessageRow> {
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

/**
 * #20: fail out a gate-inserted `queued` row whose send was interrupted
 * BEFORE the Telnyx call (media upload / signing / event-insert failure
 * between the insert and dispatchOutbound). Without this the row sits queued
 * forever — undeliverable, unretryable, and still counting against the
 * period cap. Persisting `failed` + {@link SEND_INTERRUPTED_ERROR_CODE}
 * makes it immediately retryable (§7 rules). Best-effort by design: if the
 * persist itself fails (DB down — likely the same outage that interrupted
 * the send), the error is logged and swallowed so the ORIGINAL failure
 * propagates; the fail-stuck sweeper cron is the durable backstop.
 */
export async function persistSendInterruption(
  db: SupabaseClient,
  message: MessageRow,
  detail: string,
): Promise<void> {
  try {
    await persistMessagePatch(db, message, {
      status: "failed",
      error_code: SEND_INTERRUPTED_ERROR_CODE,
      error_detail: detail.slice(0, 2000),
    });
  } catch (cause) {
    console.error(
      `send interruption persist failed for message ${message.id}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * SPEC §12 step 18 north-star: `first_outbound_sent` — fired when the row
 * that just got its telnyx_message_id is the company's first Telnyx-accepted
 * outbound ever. The existence check (one indexed limit-1 lookup for any
 * OTHER dispatched outbound) runs ONLY when POSTHOG_API_KEY is set, so the
 * hot path pays nothing with analytics off. Best-effort: a lookup or capture
 * failure never breaks the send, and the rare concurrent-first-sends
 * duplicate is harmless (funnels count first occurrence per distinct_id).
 */
async function captureFirstOutboundSent(
  env: Env,
  db: SupabaseClient,
  message: MessageRow,
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return; // analytics off — keep the hot path clean
  try {
    const { data, error } = await db
      .from("messages")
      .select("id")
      .eq("company_id", message.company_id)
      .eq("direction", "outbound")
      .not("telnyx_message_id", "is", null)
      .neq("id", message.id)
      .limit(1);
    if (error) {
      throw new Error(`first-outbound lookup failed: ${error.message}`);
    }
    if ((data ?? []).length > 0) return; // not the first — nothing to record
    await capture(env, "first_outbound_sent", message.company_id);
  } catch (cause) {
    // Analytics never breaks a send that already succeeded.
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error("first_outbound_sent capture skipped:", detail);
  }
}

/**
 * #12 MMS cap: has the company already SENT its plan's included outbound picture
 * messages this period? Mirrors voice-webhook.ts companyOverVoiceBudget. Exported
 * so the send/compose routes pre-check it BEFORE uploading media or recording
 * attachment rows (an over-cap send must degrade to text-only everywhere: no
 * attachment rows to over-count the meter, no MMS segment estimate, no photo
 * rendered as sent). No plan / no live period → not over (a pre-checkout company
 * has no allowance and no numbers to send from). Reads the period-count RPC over
 * the outbound messages the company has already had accepted by Telnyx this
 * period.
 */
export async function companyOverMmsCap(
  db: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  // Module off → over-cap (media stripped). No legitimate path sends media with
  // the module off (routes 409 first), so this only closes the hole for a
  // future caller — fail-safe: never an uncapped MMS charge.
  if (!(await isModuleEnabled(db, companyId, "mms"))) return true;

  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select("plan,current_period_start")
    .eq("id", companyId)
    .is("deleted_at", null)
    .limit(1);
  if (companyError) {
    throw new Error(`company lookup failed: ${companyError.message}`);
  }
  const company = (companyRows ?? [])[0] as
    | { plan: PlanId | null; current_period_start: string | null }
    | undefined;
  if (!company?.plan || !company.current_period_start) return false;

  const { data, error } = await db.rpc("api_period_outbound_mms", {
    p_company_id: companyId,
    p_since: company.current_period_start,
  });
  if (error) {
    throw new Error(`mms usage lookup failed: ${error.message}`);
  }
  return Number(data) >= PLAN_MMS_INCLUDED[company.plan];
}

/**
 * The send-lifecycle tail (SPEC §8): Telnyx call → persist telnyx_message_id
 * on success, or status='failed' + error columns on API failure (retryable
 * via POST /v1/messages/:id/retry while telnyx_message_id IS NULL, §7).
 * Returns the updated message row either way — failures are surfaced on the
 * row, never thrown away.
 *
 * This is also the ONE outbound choke point (routes, composes, and every
 * auto-send funnel through it), so the SPEC §10 layer-3 per-company rate
 * limiter lives here: when the SEND_RATE_LIMITER binding exists (production),
 * a denial persists a retryable failure on the row (failed + no Telnyx id,
 * §7 retry rules) and throws the stable §7 `rate_limited` code. Local
 * dev/tests have no binding → the gate is skipped.
 *
 * The #12 MMS cap-and-drop backstop also lives here (the one choke point every
 * MMS send funnels through): when this send carries a picture but the company
 * has already sent its plan's included outbound MMS this period (or the mms
 * module is off), the media is STRIPPED and the send goes out text-only —
 * cap-and-drop the (cost-incurring) photo, never the customer's message. The
 * owner was warned at 80% by the mms arm of the usage-alerts cron. Text-only
 * sends short-circuit the lookup and pay nothing.
 */
export async function dispatchOutbound(
  env: Env,
  db: SupabaseClient,
  message: MessageRow,
  args: { from: string; to: string; text: string; mediaUrls: string[] },
): Promise<MessageRow> {
  if (env.SEND_RATE_LIMITER) {
    const { success } = await env.SEND_RATE_LIMITER.limit({
      key: message.company_id,
    });
    if (!success) {
      await persistMessagePatch(db, message, {
        status: "failed",
        error_code: "rate_limited",
        error_detail:
          "Outbound rate limit reached (about 1 message per second per company).",
      });
      throw new ApiError(
        "rate_limited",
        "Sending too quickly — try again in a moment.",
      );
    }
  }

  // TOCTOU backstop: the routes pre-check companyOverMmsCap and drop media
  // BEFORE uploading/recording attachments, so this strip is normally
  // unreachable. When it does fire (cap crossed between the pre-check and
  // here), the already-recorded attachment rows make the period meter
  // over-count this text-only send — by design, the fail-safe direction.
  let mediaUrls = args.mediaUrls;
  if (mediaUrls.length > 0 && (await companyOverMmsCap(db, message.company_id))) {
    mediaUrls = [];
    // Media-only TOCTOU edge: nothing left to send — Telnyx rejects empty text.
    if (args.text.trim().length === 0) {
      await persistMessagePatch(db, message, {
        status: "failed",
        error_code: "conflict",
        error_detail:
          "All included picture messages for this billing period have been used.",
      });
      throw new ApiError(
        "conflict",
        "All included picture messages for this billing period have been used — the photo can't be sent until the period resets, or add words to send it as a text.",
      );
    }
  }

  const result = await telnyxCreateMessage(env, { ...args, mediaUrls });

  const patch = result.ok
    ? { telnyx_message_id: result.telnyxMessageId }
    : {
        status: "failed" as const,
        error_code: result.errorCode,
        error_detail: result.errorDetail.slice(0, 2000),
      };
  const row = await persistMessagePatch(db, message, patch);
  if (result.ok) {
    // §12 step 18: after the accepted send is durably recorded (instant
    // no-op when analytics is off).
    await captureFirstOutboundSent(env, db, row);
  }
  return row;
}
