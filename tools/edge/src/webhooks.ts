import { EDGE_PATHS } from "@loonext/rig-protocol";

import { secretSegmentMatches } from "./auth";
import { uplink, type Env } from "./env";
import { partitionFor, registerLegOnce, rejectLeg, requestDetach } from "./guard";
import { boundedText, empty } from "./http";
import { judge, parseEvent, relayedTelnyxHeaders, verifyTelnyxSignature } from "./telnyx";
import { STRANGER_WINDOW_MS } from "./uplink";

/**
 * A Telnyx webhook: verify, decide ownership, stop strangers, dedupe,
 * register the leg, deliver.
 *
 * 2xx stops Telnyx's retries: for events that are not ours, strangers,
 * duplicates and queued texts. 503 makes it retry and fail over: for a call
 * event the rig did not answer, and when the guard's partition is
 * unreachable. Unknown ownership is not "someone else's", so it is never
 * acked and dropped.
 */

const WEBHOOK_MAX_BYTES = 256 * 1024;

export async function handleTelnyxWebhook(env: Env, request: Request, path: string): Promise<Response> {
  const rig = uplink(env);
  const raw = await boundedText(request, WEBHOOK_MAX_BYTES);
  if (raw === null) return empty(413);
  if (!(await verifyTelnyxSignature(env.TELNYX_PUBLIC_KEY, request.headers, raw))) {
    await rig.bump("telnyx.bad_signature");
    return empty(400);
  }

  const event = parseEvent(raw);
  if (!event) {
    await rig.bump("telnyx.unusable");
    return empty(200);
  }

  const partition = await partitionFor(env);
  if (!partition) {
    await rig.bump("telnyx.partition_unavailable");
    return empty(503);
  }

  const verdict = judge(path, event, partition);
  switch (verdict.action) {
    case "drop":
      await rig.bump(`telnyx.dropped.${verdict.reason}`);
      return empty(200);

    case "stranger-call":
    case "stranger-text": {
      const kind = verdict.action === "stranger-call" ? "call" : "text";
      if (verdict.action === "stranger-call" && verdict.reject) await rejectLeg(env, verdict.reject);
      // Only the event that opens a stranger's call or carries their text
      // counts toward a detach; a rejected leg's later events do not.
      const opens = verdict.action === "stranger-text" || verdict.reject !== null;
      if (!opens) {
        await rig.bump("stranger.call_event");
        return empty(200);
      }
      const { detach, strangers } = await rig.recordStranger({
        kind,
        ours: verdict.ours,
        theirs: verdict.theirs,
      });
      if (detach && verdict.ours) {
        await requestDetach(env, { e164: verdict.ours, strangers, window_ms: STRANGER_WINDOW_MS });
      }
      return empty(200);
    }

    case "relay-call": {
      if (verdict.leg) await registerLegOnce(env, verdict.leg);
      const { status } = await rig.relayCall({
        eventId: event.id,
        kind: verdict.kind,
        path,
        headers: relayedTelnyxHeaders(request.headers),
        body: raw,
      });
      return empty(status);
    }

    case "queue-message": {
      const outcome = await rig.enqueueWebhook({
        dedupeKey: `event:${event.id}`,
        kind: "message",
        path,
        headers: relayedTelnyxHeaders(request.headers),
        body: raw,
      });
      return empty(outcome === "full" ? 503 : 200);
    }
  }
}

const ROBOT_WEBHOOK_MAX_BYTES = 256 * 1024;

/**
 * `/w/<secret>/...`: customer webhooks from the rig's API to the robot. The
 * app refuses `*.internal` webhook hosts, so its endpoint is the edge, and the
 * edge queues each delivery for the robot. The secret segment stays at the
 * edge; the rig sees the rest of the path.
 */
export async function handleRobotWebhook(env: Env, request: Request, url: URL): Promise<Response> {
  const rest = url.pathname.slice(EDGE_PATHS.robotWebhookPrefix.length);
  const slash = rest.indexOf("/");
  const secret = slash === -1 ? rest : rest.slice(0, slash);
  if (!(await secretSegmentMatches(secret, env.ROBOT_WEBHOOK_SECRET_SHA256))) return empty(404);

  const body = await boundedText(request, ROBOT_WEBHOOK_MAX_BYTES);
  if (body === null) return empty(413);
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (lower === "content-type" || lower.startsWith("loonext-")) headers[lower] = value;
  }
  const delivery = headers["loonext-delivery"];
  const outcome = await uplink(env).enqueueWebhook({
    dedupeKey: delivery ? `robot-webhook:${delivery}` : `robot-webhook:${crypto.randomUUID()}`,
    kind: "robot-webhook",
    path: `${EDGE_PATHS.robotWebhookPrefix}${slash === -1 ? "" : rest.slice(slash + 1)}${url.search}`,
    headers,
    body,
  });
  return empty(outcome === "full" ? 503 : 200);
}
