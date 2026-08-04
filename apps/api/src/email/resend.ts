import { SUPPORT_EMAIL } from "@loonext/shared";

import { getDb } from "../db";
import type { Env } from "../env";
import { recordHeartbeatBestEffort } from "../observability/liveness";
import { emailTextFooter } from "./html";

export interface SendEmailInput {
  /** One address or several (Resend accepts both). */
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /**
   * Per-send Reply-To override (e.g. the contact form sets it to the
   * submitter so support can reply directly). When absent, the env-level
   * RESEND_REPLY_TO applies; when that is unset too, replies fall back to the
   * shared support address rather than to the unmonitored sender (#252).
   */
  replyTo?: string;
  /**
   * Extra SMTP headers Resend should stamp on the message, e.g.
   * `List-Unsubscribe` on recurring notification emails.
   */
  headers?: Record<string, string>;
  /**
   * What kind of message this is, which decides whether the service footer
   * belongs on it (#252).
   *
   * Nearly everything here is transactional — account, billing, usage — and
   * gets the footer appended centrally so no builder can ship a text part
   * without it. `comparison-email.ts` is the one COMMERCIAL send: it goes to a
   * captured prospect who by construction has no account, it carries its own
   * CAN-SPAM block (postal address + unsubscribe), and it deliberately does not
   * use `emailLayout`. Appending "a service message about your Loonext account"
   * below that unsubscribe line would both misdescribe the message and put a
   * second footer under the compliance block.
   *
   * Defaulted rather than required because transactional is the overwhelming
   * majority and a wrong default there is silent; `commercial-footer.test.ts`
   * is what stops the next commercial sender from inheriting it by omission.
   */
  kind?: "transactional" | "commercial";
  /**
   * #252 — STREAM SEPARATION. True for the handful of messages a customer
   * cannot afford to miss: your payment failed, your number is released in
   * thirty days, it is released in three, it is gone.
   *
   * "Critical account mail should not share a sending reputation with routine
   * notification volume. Losing the second must not take down the first."
   * Routine notification mail is the high-volume stream — a customer texted
   * you, fired all day — and it is the one whose bounces and complaints
   * accumulate. If it poisons the domain, the message that costs somebody
   * their business number goes down with it.
   *
   * The SEAM is here; the separation is a DNS action. `RESEND_FROM_CRITICAL`
   * is optional and falls back to `RESEND_FROM`, so today this changes
   * nothing — and the day a second authenticated subdomain exists, one secret
   * routes every message already classified below through it. Deciding WHICH
   * messages are critical is the part that needed judgement, and it is done
   * and tested rather than waiting on a DNS record.
   */
  critical?: boolean;
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

  /**
   * #252: a Reply-To is ALWAYS stamped, and the last resort is the address a
   * human reads rather than nothing at all.
   *
   * Five customer-facing emails tell the reader to "reply to this email", and
   * two of them are the only stated way to undo an irreversible workspace
   * deletion. Whether that instruction was true used to depend on an OPTIONAL
   * secret: with `RESEND_REPLY_TO` unset, replies went to the `notifications@`
   * sender, which nobody reads. Nothing failed and nothing warned — the copy
   * simply became a lie, on the one path where being ignored costs a customer
   * their workspace.
   *
   * A default cannot be wrong in a way that hurts: the worst case is a reply
   * reaching a monitored address the operator did not configure. The secret is
   * still honoured when set, so a deployment that routes support elsewhere
   * keeps deciding for itself.
   */
  const replyTo = input.replyTo ?? env.RESEND_REPLY_TO ?? SUPPORT_EMAIL;
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // #252: the critical stream, when one is configured. Unset falls back
      // to the single sender, so an environment without the second subdomain
      // behaves exactly as it did.
      from:
        input.critical === true
          ? (env.RESEND_FROM_CRITICAL ?? env.RESEND_FROM)
          : env.RESEND_FROM,
      to: deliverable,
      subject: input.subject,
      html: input.html,
      // #252: the same footer as the HTML part, appended HERE rather than by
      // each builder. `emailLayout` frames every html body centrally and the
      // text bodies were hand-written one by one, which is why the label
      // existed in one MIME part and not the other. A per-builder footer is one
      // somebody forgets on the send that matters.
      //
      // Commercial mail is exempt: it carries its own compliance block and is
      // not a service message about an account the recipient does not have.
      text:
        input.kind === "commercial"
          ? input.text
          : input.text + emailTextFooter(),
      reply_to: replyTo,
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
