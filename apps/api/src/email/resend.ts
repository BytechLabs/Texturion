import { getDb } from "../db";
import type { Env } from "../env";
import { recordHeartbeatBestEffort } from "../observability/liveness";

export interface SendEmailInput {
  /** One address or several (Resend accepts both). */
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /**
   * Per-send Reply-To override (e.g. the contact form sets it to the
   * submitter so support can reply directly). When absent, the env-level
   * RESEND_REPLY_TO applies; when that is unset too, no Reply-To is sent.
   */
  replyTo?: string;
  /**
   * Extra SMTP headers Resend should stamp on the message, e.g.
   * `List-Unsubscribe` on recurring notification emails.
   */
  headers?: Record<string, string>;
}

export interface SentEmail {
  /**
   * Resend's accepted-id, or null when every recipient was suppressed and no
   * request was made. Null is a real outcome rather than a failure: there is
   * nothing wrong and nothing to retry (#386).
   */
  id: string | null;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend REST client (SPEC §3: Resend owns ALL transactional email). Plain
 * `fetch` — no SDK — so the Worker's only email dependency is the platform
 * network edge. Sender comes from RESEND_FROM; Reply-To comes from
 * RESEND_REPLY_TO (alert copy says "reply to this email", so replies must
 * land in a monitored inbox, not the no-reply sender) unless a send
 * overrides it. Throws on any non-2xx so callers (webhook handlers, crons)
 * surface failures into their retry machinery instead of silently dropping
 * notifications.
 */
export async function sendEmail(
  env: Env,
  input: SendEmailInput,
): Promise<SentEmail> {
  // #386: never write to an address that hard-bounced or reported us as spam.
  //
  // This is the whole shared-fate fix. One crew member's dead mailbox bounces
  // every notification forever, and those bounces accumulate against OUR
  // sending domain rather than against that customer — so one stale address
  // degrades delivery for every workspace we have. Continuing to mail somebody
  // who pressed "spam" is the fastest route to a blocklist there is.
  const to = Array.isArray(input.to) ? input.to : [input.to];
  const deliverable = await filterSuppressed(env, to);
  if (deliverable.length === 0) {
    // Every recipient is suppressed. Not an error — there is nothing wrong and
    // nothing to retry, and throwing would fail a webhook or a cron over a
    // mailbox we already know is gone.
    return { id: null };
  }

  const replyTo = input.replyTo ?? env.RESEND_REPLY_TO;
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: deliverable,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
      ...(input.headers !== undefined ? { headers: input.headers } : {}),
    }),
  });

  if (!response.ok) {
    // Resend error bodies are JSON `{ name, message }`; keep whatever we got
    // for the thrown message but never let a broken body mask the status.
    const body = await response.text().catch(() => "");
    throw new Error(
      `Resend send failed: HTTP ${response.status}${body ? ` — ${body.slice(0, 500)}` : ""}`,
    );
  }

  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== "string") {
    throw new Error("Resend send failed: response carried no email id.");
  }

  // #387 liveness: nothing anywhere records that an email was sent, which is
  // half of why #386 can happen at all. This is the one place that knows, so
  // it is where the channel's heartbeat is taken. Best-effort by construction
  // — a bookkeeping write must never be the reason a notification is reported
  // as failed, and a heartbeat that did not land is itself an absence the
  // checker notices one cadence later.
  await recordHeartbeatBestEffort(env, "channel:email-outbound");

  return { id: payload.id };
}


/**
 * Drop addresses we are not allowed to write to.
 *
 * One query for the whole recipient list rather than one per address: email is
 * low volume, but a fan-out to a ten-person crew should not be ten round trips
 * on the inbound webhook's latency budget.
 *
 * A LOOKUP FAILURE SENDS ANYWAY, deliberately. The suppression list protects
 * our domain reputation over a long horizon; a database blip must not be the
 * reason a customer never learns their payment failed. Failing open costs a
 * handful of bounces, failing closed costs the message.
 */
async function filterSuppressed(env: Env, to: string[]): Promise<string[]> {
  if (to.length === 0) return [];
  try {
    const { data, error } = await getDb(env)
      .from("email_suppressions")
      .select("email")
      .in("email", to.map((address) => address.trim().toLowerCase()))
      .is("cleared_at", null);
    if (error) throw new Error(error.message);
    const blocked = new Set((data ?? []).map((row) => (row as { email: string }).email));
    return to.filter((address) => !blocked.has(address.trim().toLowerCase()));
  } catch (cause) {
    console.error(`email suppression lookup failed, sending anyway: ${String(cause)}`);
    return to;
  }
}
