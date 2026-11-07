/**
 * D142: one `push_attempt` event per push the server sends.
 *
 * "The phone didn't ring" first has to be split into "we never sent it" and
 * "the provider took it and it went nowhere", and only the server can answer
 * that half. The device answers the rest with `ring_beacon` events
 * (routes/ring-beacons.ts), and PostHog joins the two on call_session_id.
 *
 * NEVER IN THE WAY OF THE PUSH. The events are sent after the sends they
 * describe and never awaited, so evidence about a ring cannot be the reason a
 * ring fails or is slow.
 *
 * NOTHING PERSONAL. The provider's error text is deliberately not kept: a
 * rejection can quote the payload, and the payload carries a caller's number.
 */
import type { Env } from "../env";
import { captureEvent } from "../observability/capture";

export type PushPurpose = "ring" | "call_end" | "alert";
export type PushChannel = "webpush" | "fcm";
export type PushPlatform = "web" | "android" | "ios";
export type PushPriority = "high" | "normal";
export type PushResponseClass =
  | "accepted"
  | "gone"
  | "unauthorized"
  | "rejected"
  | "throttled"
  | "provider_error"
  | "transport_error";

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
}

export interface PushAttempt extends PushTarget {
  responseClass: PushResponseClass;
  /** Null when no response arrived at all. */
  httpStatus: number | null;
  latencyMs: number;
  /**
   * Epoch ms when the send started, sent as attempted_at. The events go out
   * after the whole fan-out, so their own time would be late by every send
   * before it.
   */
  startedAt: number;
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
      startedAt: started,
    });
    throw cause;
  }
  if (result.status !== 0) {
    log.push({
      ...target,
      responseClass: classifyPushResponse(result),
      httpStatus: result.status,
      latencyMs: Date.now() - started,
      startedAt: started,
    });
  }
  return result;
}

/** Send one `push_attempt` event per attempt, under the workspace's id. */
export function recordPushAttempts(env: Env, attempts: readonly PushAttempt[]): void {
  for (const attempt of attempts) {
    void captureEvent(env, "push_attempt", attempt.companyId, {
      purpose: attempt.purpose,
      channel: attempt.channel,
      platform: attempt.platform,
      priority: attempt.priority,
      response_class: attempt.responseClass,
      http_status: attempt.httpStatus,
      latency_ms: Math.max(0, Math.round(attempt.latencyMs)),
      call_session_id: attempt.callSessionId,
      user_id: attempt.userId,
      attempted_at: new Date(attempt.startedAt).toISOString(),
    });
  }
}
