import { type HaltCorroboration, type HaltRequest, HEADER } from "@loonext/rig-protocol";

import { secretSegmentMatches } from "./auth";
import { uplink, type Env } from "./env";
import { guardCall, requestHalt } from "./guard";
import { boundedText, empty } from "./http";
import { parseDsn, sendSentryEvent } from "./sentry";
import { checkTelnyxSignature } from "./telnyx";

/**
 * `/t/n/<secret>`: the Telnyx account's notification channel.
 *
 * A halt stops paid tests for seven days and alerts production, so a notice
 * is never taken on its word, even on the secret path. It is corroborated
 * when:
 *   - it is a balance notice and the balance, read through the guard, really
 *     is low;
 *   - Telnyx itself refuses the account's reads (a disabled account answers
 *     401 or 403, with no guard refusal);
 *   - it carries a valid Telnyx signature, which proves Telnyx sent it, and
 *     names a notification type enabled on the account. That list of types
 *     says nothing about whether one occurred, so it never corroborates on
 *     its own. A signature over a timestamp more than five minutes old is a
 *     retry Telnyx sent late: it still halts, marked late, and the guard
 *     keeps one signal per notice id.
 * An unsigned notice that is none of these cannot be corroborated by any
 * Telnyx read. It halts nothing and goes to the synthetic project instead,
 * where an agent can look.
 *
 * If the guard cannot take the halt, the edge raises the production alert
 * itself, so a real signal is never lost between the two.
 *
 * Notification webhooks may be unsigned; one that carries a signature must
 * verify.
 */

const NOTICE_MAX_BYTES = 64 * 1024;
/** The production low-balance alert's threshold; a "low balance" above it is not corroborated. */
export const LOW_BALANCE_CORROBORATE_BELOW_USD = 150;

export interface Notice {
  key: string;
  id: string | null;
  name: string;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

/**
 * The notice's id and event name, from whichever envelope Telnyx uses. The
 * payload shape is unconfirmed until the first real notice arrives, so this
 * reads the places a Telnyx envelope puts them rather than one exact path.
 */
export async function parseNotice(raw: string): Promise<Notice | null> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const data = (body.data ?? {}) as Record<string, unknown>;
  const payload = (data.payload ?? {}) as Record<string, unknown>;
  const event = (payload.notification_event ?? data.notification_event ?? {}) as Record<string, unknown>;
  const name = firstString(event.name, payload.event_name, payload.name, data.event_type, body.event_type, body.name);
  if (!name) return null;
  const id = firstString(data.id, body.id);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const key = id ?? [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { key, id, name };
}

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Whether an event name the account lists is the one a notice names. */
export function sameEvent(listed: string, noticed: string): boolean {
  const a = normalise(listed);
  const b = normalise(noticed);
  if (a.length < 6 || b.length < 6) return a === b && a !== "";
  return a === b || a.includes(b) || b.includes(a);
}

/** A dollar figure from the guard's balance answer, however it is shaped. */
export function balanceOf(body: unknown): number | null {
  const candidates = [
    body,
    (body as { balance?: unknown } | null)?.balance,
    (body as { data?: { balance?: unknown } } | null)?.data?.balance,
  ];
  for (const value of candidates) {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

type Corroboration =
  | { outcome: "corroborated"; by: HaltCorroboration }
  | { outcome: "uncorroborated" }
  | { outcome: "unreadable" };

/** True when Telnyx, not the guard, refused the read. */
function telnyxRefused(response: Response): boolean {
  return (response.status === 401 || response.status === 403) && !response.headers.has(HEADER.refusedBy);
}

/** `signed`: the notice carried a Telnyx signature, and it verified. */
export async function corroborate(env: Env, notice: Notice, signed: boolean): Promise<Corroboration> {
  let balance: Response;
  try {
    balance = await guardCall(env, "GET", "/telnyx/v2/balance");
  } catch {
    return { outcome: "unreadable" };
  }
  if (telnyxRefused(balance)) return { outcome: "corroborated", by: "account_refused" };

  if (/balance/i.test(notice.name)) {
    if (!balance.ok) return { outcome: "unreadable" };
    const dollars = balanceOf(await balance.json().catch(() => null));
    if (dollars === null) return { outcome: "unreadable" };
    return dollars < LOW_BALANCE_CORROBORATE_BELOW_USD
      ? { outcome: "corroborated", by: "balance" }
      : { outcome: "uncorroborated" };
  }
  if (!signed) return { outcome: "uncorroborated" };

  let events: Response;
  try {
    events = await guardCall(env, "GET", "/telnyx/v2/notification_events?page[size]=250");
  } catch {
    return { outcome: "unreadable" };
  }
  if (telnyxRefused(events)) return { outcome: "corroborated", by: "account_refused" };
  if (!events.ok) return { outcome: "unreadable" };
  const list = ((await events.json().catch(() => null)) as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) return { outcome: "unreadable" };
  const listed = list.some((entry) => {
    const e = entry as { name?: unknown; enabled?: unknown };
    return typeof e.name === "string" && e.enabled !== false && sameEvent(e.name, notice.name);
  });
  return listed ? { outcome: "corroborated", by: "signature" } : { outcome: "uncorroborated" };
}

export async function handleNotification(env: Env, request: Request, secret: string): Promise<Response> {
  if (!(await secretSegmentMatches(secret, env.NOTIFICATIONS_SECRET_SHA256))) return empty(404);
  const raw = await boundedText(request, NOTICE_MAX_BYTES);
  if (raw === null) return empty(413);

  const signed = request.headers.has("telnyx-signature-ed25519") || request.headers.has("telnyx-timestamp");
  const signature = signed ? await checkTelnyxSignature(env.TELNYX_PUBLIC_KEY, request.headers, raw) : null;
  if (signature === "invalid") {
    await uplink(env).bump("notice.bad_signature");
    return empty(400);
  }
  const late = signature === "late";
  if (late) await uplink(env).bump("notice.late_signature");

  const notice = await parseNotice(raw);
  if (!notice) {
    await uplink(env).bump("notice.unparsed");
    return empty(200);
  }
  const rig = uplink(env);
  if (await rig.noticeSeen(notice.key)) return empty(200);

  const verdict = await corroborate(env, notice, signed);
  // Not recorded as seen: Telnyx's retry gets another chance to corroborate.
  if (verdict.outcome === "unreadable") return empty(503);
  if (verdict.outcome === "uncorroborated") {
    await rig.recordNotice(notice.key, notice.name, "uncorroborated");
    // Best effort and never retried: this notice halts nothing either way.
    if (parseDsn(env.SENTRY_SYNTHETIC_DSN) && (await rig.takeSentryBudget(Date.now(), "synthetic"))) {
      await sendSentryEvent(env.SENTRY_SYNTHETIC_DSN, {
        fingerprint: ["synthetic-infra", "telnyx-notice"],
        level: "warning",
        environment: "synthetic",
        edgeSha: env.GIT_SHA,
        message: `Telnyx notice not corroborated: ${notice.name}`,
        extra: {
          notice_id: notice.id,
          signed,
          detail: "Paid tests were not halted. Check the Telnyx portal's notifications for this account.",
        },
      });
    }
    return empty(200);
  }

  const halt: HaltRequest = {
    signal: notice.name,
    notice_id: notice.id,
    corroborated_by: verdict.by,
    received_at: new Date().toISOString(),
    ...(late ? { late: true } : {}),
  };
  if (await requestHalt(env, halt)) {
    await rig.recordNotice(notice.key, notice.name, "halted");
    return empty(200);
  }
  const alerted =
    parseDsn(env.SENTRY_PROD_DSN) !== null &&
    (await rig.takeSentryBudget(Date.now(), "production")) &&
    (await sendSentryEvent(env.SENTRY_PROD_DSN, {
      fingerprint: ["ops", "telnyx-account-signal"],
      level: "error",
      environment: "production",
      edgeSha: env.GIT_SHA,
      message: `Telnyx account signal: ${notice.name}`,
      extra: {
        detail: `Corroborated by ${verdict.by}, but the guard did not take the halt.`,
        action: "Stop paid rig tests by hand, then find out why the guard refused or failed the halt.",
      },
    }));
  if (!alerted) {
    // Neither landed. Unrecorded, so Telnyx's retry tries both again.
    await rig.bump("notice.halt_failed");
    return empty(503);
  }
  await rig.recordNotice(notice.key, notice.name, "alerted");
  return empty(200);
}
