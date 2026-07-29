/**
 * #308 — the synthetic canary.
 *
 * The traffic probes in `liveness-check.ts` infer health from customer
 * traffic, and at this platform's size customer traffic cannot tell "broken"
 * from "quiet" quickly. Their graces are twelve hours and two days for exactly
 * that reason, and no cleverness in the threshold fixes it: there is not
 * enough volume to do statistics on.
 *
 * This removes the ambiguity by GENERATING the traffic. One text, from a
 * number we own to a number we own, and we wait for its `message.received`
 * webhook. That exercises the whole path — Telnyx accepted it, Telnyx
 * delivered the webhook, Cloudflare routed it, signature verification passed,
 * the handler ran — so its silence means something specific.
 *
 * OFF UNTIL CONFIGURED. Two secrets turn it on. Unconfigured it is a logged
 * no-op AND its liveness expectation is withheld, because an expectation for
 * something nobody asked for would alert forever about a feature that was
 * never enabled. Same posture as `isFcmConfigured` — the code ships whether or
 * not the numbers exist, which is what stops a provisioning decision holding
 * up the detection work that needs none.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { recordHeartbeatBestEffort } from "./liveness";

const TELNYX_API_BASE = "https://api.telnyx.com";
const TELNYX_TIMEOUT_MS = 10_000;

/**
 * How long a canary has to be outstanding before its silence is evidence.
 * A webhook that arrives in seconds must not be judged in milliseconds.
 */
const CONFIRM_MIN_AGE_SECONDS = 60;

/**
 * The cap, and it is the cost mandate's shape rather than a safety rail.
 *
 * Once this many canaries have gone unanswered in a day, the inbound path is
 * already known to be down and has already alerted. Every further send is
 * 1.7c spent to re-learn a fact we have. So the canary stops sending and the
 * alert stays raised — cap-and-drop, with the drop landing on the spend and
 * never on the signal.
 */
const MAX_UNANSWERED_PER_DAY = 6;

export interface CanaryConfig {
  from: string;
  to: string;
}

/**
 * The canary's numbers, or null when it is switched off.
 *
 * Both are required: a from with no to is not half a canary, it is a text to
 * nowhere.
 */
export function canaryConfig(env: Env): CanaryConfig | null {
  const from = env.CANARY_FROM_E164?.trim();
  const to = env.CANARY_TO_E164?.trim();
  if (!from || !to) return null;
  return { from, to };
}

export type CanaryOutcome =
  | { status: "unconfigured" }
  | { status: "capped"; unanswered: number }
  | { status: "not-our-number"; to: string }
  | { status: "sent"; token: string; confirmed: string | null }
  | { status: "send-failed"; detail: string; confirmed: string | null };

/**
 * One canary cycle: confirm the previous round trip, then start a new one.
 *
 * The two halves are in this order on purpose. Confirmation is what records
 * the heartbeat, and it must happen even when the send half is capped or
 * failing — otherwise a broken send would suppress the evidence that inbound
 * still works, and we would alert on the wrong subsystem.
 */
export async function runInboundCanaryJob(
  env: Env,
  now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<CanaryOutcome> {
  const config = canaryConfig(env);
  if (!config) {
    console.log(
      "canary: CANARY_FROM_E164/CANARY_TO_E164 unset — synthetic inbound check skipped",
    );
    return { status: "unconfigured" };
  }

  const confirmed = await confirmPreviousRun(env, now, db);

  // The destination MUST be a number this platform owns.
  //
  // This is the one send path in the product that does not run the §5 gates,
  // and that is only defensible because it cannot reach a person. A typo in a
  // secret would otherwise make an ops job text a stranger, hourly, forever —
  // with no consent, no opt-out handling and no conversation anybody can see.
  // Checking ownership makes "this is not a customer send" a property of the
  // code rather than a claim in a comment.
  const { data: owned, error: ownedError } = await db
    .from("phone_numbers")
    .select("id")
    .eq("e164", config.to)
    .limit(1);
  if (ownedError) {
    console.error(`canary: number ownership check failed: ${ownedError.message}`);
    return { status: "send-failed", detail: ownedError.message, confirmed };
  }
  if ((owned ?? []).length === 0) {
    console.error(
      `canary: refusing to send — ${config.to} is not a number this platform owns`,
    );
    return { status: "not-our-number", to: config.to };
  }

  const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const { data: unansweredData, error: unansweredError } = await db.rpc(
    "inbound_canary_unanswered",
    { p_since: since },
  );
  if (unansweredError) {
    console.error(`canary: unanswered count failed: ${unansweredError.message}`);
    return { status: "send-failed", detail: unansweredError.message, confirmed };
  }
  const unanswered = Number(unansweredData ?? 0);
  if (unanswered >= MAX_UNANSWERED_PER_DAY) {
    console.warn(
      `canary: ${unanswered} unanswered in 24h — not sending another. ` +
        "The inbound alert is already raised; further sends only re-buy it.",
    );
    return { status: "capped", unanswered };
  }

  // The token is the correlation, and it is the message body. Matching on the
  // destination number alone would let ANY inbound to that number confirm the
  // canary — including the previous hour's, which is the same stale-evidence
  // mistake this whole issue is about.
  const token = `LOONEXT-CANARY-${crypto.randomUUID()}`;
  const { error: insertError } = await db
    .from("inbound_canary_runs")
    .insert({ token, sent_at: now.toISOString() });
  if (insertError) {
    console.error(`canary: run insert failed: ${insertError.message}`);
    return { status: "send-failed", detail: insertError.message, confirmed };
  }

  const sent = await sendCanaryText(env, config, token);
  if (!sent.ok) {
    // Recorded on the row rather than left pending: a send that never left is
    // not evidence about the INBOUND path, and must not age into an inbound
    // alert. That outage is channel:sms-outbound's to report.
    await db
      .from("inbound_canary_runs")
      .update({ send_error: sent.detail })
      .eq("token", token);
    console.error(`canary: send failed: ${sent.detail}`);
    return { status: "send-failed", detail: sent.detail, confirmed };
  }

  return { status: "sent", token, confirmed };
}

/**
 * Look for the previous run's token in the webhook ledger, and beat if it
 * arrived. Returns the confirmed token, or null.
 */
async function confirmPreviousRun(
  env: Env,
  now: Date,
  db: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await db.rpc("confirm_inbound_canary", {
    p_now: now.toISOString(),
    p_min_age_seconds: CONFIRM_MIN_AGE_SECONDS,
  });
  if (error) {
    // A broken confirmation is not proof of a broken channel, so it records
    // nothing and claims nothing — the same posture as the probes.
    console.error(`canary: confirmation failed: ${error.message}`);
    return null;
  }
  const result = (data ?? {}) as { confirmed?: string | null };
  if (!result.confirmed) return null;

  await recordHeartbeatBestEffort(env, "channel:inbound-canary", now, db);
  return result.confirmed;
}

/**
 * Send the canary text.
 *
 * Its own minimal call rather than the §5 send pipeline, because there is no
 * message row, no conversation, no contact and no consent question — both ends
 * are numbers we own, enforced by the caller. Routing it through the customer
 * path would mean inventing a fake conversation in somebody's workspace, which
 * is a worse outcome than a fifteen-line fetch.
 */
async function sendCanaryText(
  env: Env,
  config: CanaryConfig,
  token: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const response = await fetch(
      `${env.TELNYX_API_BASE ?? TELNYX_API_BASE}/v2/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          "Content-Type": "application/json",
          // One key per token, so a retried job cannot double-send.
          "Idempotency-Key": `canary:${token}`,
        },
        body: JSON.stringify({
          from: config.from,
          to: config.to,
          text: token,
        }),
        signal: AbortSignal.timeout(TELNYX_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return { ok: false, detail: `Telnyx HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
