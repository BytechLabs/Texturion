/**
 * D142: one `push_attempts` row per push the server sends.
 *
 * "The phone didn't ring" first has to be split into "we never sent it" and
 * "the provider took it and it went nowhere", and only the server can answer
 * that half.
 *
 * NEVER IN THE WAY OF THE PUSH. The row is written after the sends it
 * describes, and a failed write is reported and dropped: evidence about a ring
 * must not be the reason a ring fails. Nor the reason it is slow: the call
 * engine's fan-outs run inside the call's serialized queue, where an awaited
 * write would hold the answer and the hangup behind a database round trip, so
 * they write in the background.
 *
 * NOTHING PERSONAL. The provider's error text is deliberately not kept: a
 * rejection can quote the payload, and the payload carries a caller's number.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { opsAlert } from "../observability/ops-alert";

/** Each vocabulary below is also a CHECK on the table; push-evidence-schema.test.ts holds them together. */
export const PUSH_PURPOSES = ["ring", "call_end", "alert"] as const;
export const PUSH_CHANNELS = ["webpush", "fcm"] as const;
export const PUSH_PLATFORMS = ["web", "android", "ios"] as const;
export const PUSH_PRIORITIES = ["high", "normal"] as const;
export const PUSH_RESPONSE_CLASSES = [
  "accepted",
  "gone",
  "unauthorized",
  "rejected",
  "throttled",
  "provider_error",
  "transport_error",
] as const;

export type PushPurpose = (typeof PUSH_PURPOSES)[number];
export type PushChannel = (typeof PUSH_CHANNELS)[number];
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];
export type PushPriority = (typeof PUSH_PRIORITIES)[number];
export type PushResponseClass = (typeof PUSH_RESPONSE_CLASSES)[number];

/** What both senders report, which is all the classification needs. */
export interface PushOutcome {
  ok: boolean;
  status: number;
  gone: boolean;
}

/** Who and what a send was for, known before it goes out. */
export interface PushTarget {
  companyId: string;
  userId: string;
  callSessionId: string | null;
  purpose: PushPurpose;
  channel: PushChannel;
  platform: PushPlatform;
  priority: PushPriority;
  /** The push_subscriptions or device_push_tokens row id. */
  targetId: string;
}

export interface PushAttempt extends PushTarget {
  responseClass: PushResponseClass;
  /** Null when no response arrived at all. */
  httpStatus: number | null;
  latencyMs: number;
}

/**
 * The provider's answer, reduced to the next move: drop the channel (gone),
 * fix our credentials (unauthorized), fix the message (rejected), slow down
 * (throttled), or wait it out (provider_error).
 */
export function classifyPushResponse(outcome: PushOutcome): PushResponseClass {
  if (outcome.gone) return "gone";
  if (outcome.ok) return "accepted";
  if (outcome.status === 401 || outcome.status === 403) return "unauthorized";
  if (outcome.status === 429) return "throttled";
  if (outcome.status >= 500) return "provider_error";
  return "rejected";
}

/**
 * Send, timing it, and append what happened to `log`. The send's own result
 * or throw passes through untouched.
 *
 * A status of 0 is the sender's "not configured, nothing sent" answer, and
 * nothing sent is not an attempt.
 */
export async function timedPush<T extends PushOutcome>(
  log: PushAttempt[],
  target: PushTarget,
  send: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let result: T;
  try {
    result = await send();
  } catch (cause) {
    log.push({
      ...target,
      responseClass: "transport_error",
      httpStatus: null,
      latencyMs: Date.now() - started,
    });
    throw cause;
  }
  if (result.status !== 0) {
    log.push({
      ...target,
      responseClass: classifyPushResponse(result),
      httpStatus: result.status,
      latencyMs: Date.now() - started,
    });
  }
  return result;
}

/** At most one alert an hour from each isolate: one cause, one issue, no flood. */
const ALERT_EVERY_MS = 60 * 60 * 1000;
let lastAlertAt = Number.NEGATIVE_INFINITY;

/**
 * Far under the client's 10 s hang-breaker: a write slower than this is lost
 * evidence, which is cheaper than an alert fan-out held open for it.
 */
export const PUSH_ATTEMPTS_WRITE_TIMEOUT_MS = 3_000;

/** The latency CHECK's ceiling: a slower send is recorded at it, not refused. */
const MAX_LATENCY_MS = 600_000;
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Write the fan-out's rows. Never throws.
 *
 * A refusal (a 4xx: a CHECK the code has outgrown, a table that is not there
 * yet) repeats on every write until somebody fixes it, so it reaches the
 * operator. No response, or a 5xx, is weather and stays in the log.
 */
export async function recordPushAttempts(
  env: Env,
  db: SupabaseClient,
  attempts: readonly PushAttempt[],
): Promise<void> {
  if (attempts.length === 0) return;
  let refusal: { status: number; code: string } | null = null;
  let answered = 0;
  try {
    const { error, status } = await db
      .from("push_attempts")
      .insert(
        attempts.map((attempt) => ({
          company_id: attempt.companyId,
          user_id: attempt.userId,
          call_session_id: attempt.callSessionId,
          purpose: attempt.purpose,
          channel: attempt.channel,
          platform: attempt.platform,
          priority: attempt.priority,
          response_class: attempt.responseClass,
          http_status: attempt.httpStatus,
          latency_ms: Math.min(MAX_LATENCY_MS, Math.max(0, Math.round(attempt.latencyMs))),
          target_id: attempt.targetId,
        })),
      )
      .abortSignal(AbortSignal.timeout(PUSH_ATTEMPTS_WRITE_TIMEOUT_MS));
    if (!error) return;
    answered = status;
    // A member removed while their pushes went out has no membership left for
    // the rows to reference. A race, not a broken ledger, so it is not alerted.
    if (error.code === FOREIGN_KEY_VIOLATION) {
      console.warn(`push attempts: ${attempts.length} row(s) not recorded (a member left mid-send)`);
      return;
    }
    if (status >= 400 && status < 500) {
      refusal = { status, code: typeof error.code === "string" ? error.code : "" };
    }
  } catch {
    refusal = null;
  }

  if (refusal === null) {
    const why = answered > 0 ? `HTTP ${answered}` : "no answer";
    console.warn(`push attempts: ${attempts.length} row(s) not recorded (${why})`);
    return;
  }
  const now = Date.now();
  if (now - lastAlertAt < ALERT_EVERY_MS) return;
  lastAlertAt = now;
  // The status and code, never the message: a constraint error quotes the row.
  await opsAlert(env, {
    key: "push-attempts-ledger",
    summary: "Push attempts are not being recorded",
    detail: `the database refused ${attempts.length} row(s): HTTP ${refusal.status} ${refusal.code || "(no code)"}`,
    action:
      "Check that the push_attempts migration is applied and that its CHECK vocabularies match apps/api/src/notifications/push-attempts.ts. Pushes still go out; only the evidence is lost.",
  });
}

const inFlight = new Set<Promise<void>>();

/**
 * Start the write and return at once, for the call engine's fan-outs.
 *
 * Only safe where the runtime keeps running a promise nobody awaits. A Durable
 * Object does; a Worker request may be cut off once it has answered, which is
 * why deliverPush awaits recordPushAttempts unless the call engine asks.
 */
export function recordPushAttemptsInBackground(
  env: Env,
  db: SupabaseClient,
  attempts: readonly PushAttempt[],
): void {
  if (attempts.length === 0) return;
  const write = recordPushAttempts(env, db, attempts).catch(() => undefined);
  inFlight.add(write);
  void write.then(() => inFlight.delete(write));
}

/**
 * Resolves once every background write started so far has finished. A Worker
 * request that starts one hands this to waitUntil, so the write outlives the
 * response; tests await it.
 */
export async function pushAttemptsSettled(): Promise<void> {
  await Promise.all([...inFlight]);
}

/** Test seam: forget the last alert so each test starts unthrottled. */
export function resetPushAttemptAlertsForTest(): void {
  lastAlertAt = Number.NEGATIVE_INFINITY;
}
