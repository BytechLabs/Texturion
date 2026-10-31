/**
 * Where each webhook frame goes on the rig (the edge's contract,
 * tools/edge/src/webhooks.ts):
 *
 * - `call`: the API's one Telnyx route, answered synchronously.
 * - `robot-call`: robotd, answered synchronously.
 * - `message`: queued. The robot's own texts go to robotd, the rest to the
 *   API. A text is the robot's when it came in on the robot's path (`/t/r`),
 *   or when its robot end says so: the recipient of a `message.received`, the
 *   sender of a `message.sent` or `message.finalized`. The guard may point
 *   every messaging profile at one path, so the path alone cannot decide.
 * - `robot-webhook`: queued, to robotd's sink. Its path is `/w/<rest>`, the
 *   edge having kept the secret segment.
 *
 * The headers are the ones the edge relays (the Telnyx signature pair and the
 * content type, or `loonext-*` for a customer webhook), so the API verifies
 * the real signature itself.
 */
import type { KeyObject } from "node:crypto";
import { CALL_EVENT_RELAY_TIMEOUT_MS, EDGE_PATHS } from "@loonext/rig-protocol";
import { ROBOT_TOKEN_HEADER } from "@loonext/rig-robot";
import { messageText, SIGNATURE_WINDOW_S, signatureAge, signedByTelnyx, textHash, type LateDelivery } from "./late.ts";
import type { WebhookFrame, WebhookResult } from "./uplink.ts";

export const RIG_PATH_HEADER = "x-rig-path";

export interface ForwardTargets {
  /** The local API, e.g. http://127.0.0.1:8787. */
  apiBase: string;
  apiWebhookPath?: string;
  /** robotd on loopback. */
  robotBase: string;
  robotToken: string;
  /** Whether a number is one of the robot's lines (ROBOT-1, ROBOT-2, STRANGER-1). */
  robotNumber?: (e164: string) => boolean;
  /** The key the API verifies with; without it no refusal is ever taken for a late text. */
  telnyxKey?: () => KeyObject | undefined;
  /** Called for a text the API refused only because its genuine signature aged past the window. */
  onLate?: (entry: LateDelivery) => void;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Leaves room to send the result before the edge stops waiting. */
const CALL_FORWARD_TIMEOUT_MS = CALL_EVENT_RELAY_TIMEOUT_MS - 500;
const QUEUED_FORWARD_TIMEOUT_MS = 30_000;
/** A Telnyx handler's answer is a few bytes; nothing larger needs to go back. */
const MAX_RESULT_BODY = 16 * 1024;

/** The robot's end of a text event: the number that is the robot's if the text is. */
export function robotEndOf(body: string): string | undefined {
  try {
    const data = (JSON.parse(body) as { data?: { event_type?: unknown; payload?: unknown } })?.data;
    const payload = (data?.payload ?? {}) as { from?: { phone_number?: unknown }; to?: { phone_number?: unknown }[] };
    const number = data?.event_type === "message.received" ? payload.to?.[0]?.phone_number : payload.from?.phone_number;
    return typeof number === "string" ? number : undefined;
  } catch {
    return undefined;
  }
}

export function webhookForwarder(targets: ForwardTargets) {
  const doFetch = targets.fetch ?? fetch;
  const now = targets.now ?? Date.now;
  const api = `${targets.apiBase.replace(/\/+$/, "")}${targets.apiWebhookPath ?? "/webhooks/telnyx"}`;
  const robot = targets.robotBase.replace(/\/+$/, "");
  const robotText = (frame: WebhookFrame) => {
    if (frame.path === EDGE_PATHS.telnyxRobot) return true;
    const end = targets.robotNumber ? robotEndOf(frame.body) : undefined;
    return end !== undefined && targets.robotNumber!(end);
  };

  return async (frame: WebhookFrame): Promise<WebhookResult> => {
    const headers: Record<string, string> = { ...frame.headers };
    const toRobot =
      frame.kind === "robot-call" || frame.kind === "robot-webhook" || (frame.kind === "message" && robotText(frame));
    let url = api;
    if (toRobot) {
      url = frame.kind === "robot-webhook" ? `${robot}/sink` : `${robot}/telnyx`;
      headers[ROBOT_TOKEN_HEADER] = targets.robotToken;
      headers[RIG_PATH_HEADER] = frame.path;
    }
    const synchronous = frame.kind === "call" || frame.kind === "robot-call";
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers,
        body: frame.body,
        signal: AbortSignal.timeout(synchronous ? CALL_FORWARD_TIMEOUT_MS : QUEUED_FORWARD_TIMEOUT_MS),
      });
    } catch {
      // Unreachable or too slow: 503 is what makes Telnyx retry and fail over.
      return { status: 503 };
    }
    const body = await response.text();
    const result: WebhookResult = { status: response.status, body: body.length > MAX_RESULT_BODY ? undefined : body };
    if (frame.kind === "message" && !toRobot && response.status === 400) {
      const age = signatureAge(frame.headers, now());
      const key = age !== undefined && age > SIGNATURE_WINDOW_S ? targets.telnyxKey?.() : undefined;
      if (key && signedByTelnyx(key, frame.headers, frame.body)) {
        const text = messageText(frame.body);
        targets.onLate?.({
          at: now(),
          frame_id: frame.id,
          path: frame.path,
          attempt: frame.attempt,
          age_s: age!,
          signed_at: (Math.round(now() / 1000) - age!) * 1000,
          ...(text === undefined ? {} : { text_sha256: textHash(text) }),
        });
        return { ...result, late: true };
      }
    }
    return result;
  };
}
