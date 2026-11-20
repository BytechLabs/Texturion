import { Refusal } from "../refusal";
import { liveLeg, markEnded } from "../state/legs";
import { forward, isOk, relay } from './forward';
import type { Handler } from './forward';
import { bodyIsContained } from "./hazards";

/**
 * The leg-command class (docs/RIG.md): any command on a call id
 * in the leg registry.
 */
const ENDING = new Set(["hangup", "reject"]);

export const handleLegCommand: Handler = async (request) => {
  const { ctx } = request;
  if (request.entry.key === "DELETE /v2/recordings/:id") return deleteRecording(request);

  const [callControlId] = request.ids;
  if (!(await liveLeg(ctx, callControlId))) throw new Refusal("leg.not_registered");
  if (request.bodyInvalid) throw new Refusal("request.body_invalid");
  const action = request.path.split("/").pop() ?? "";
  const ending = ENDING.has(action);

  if (request.body && !(await bodyIsContained(ctx, request.body, request.view.record.billing_group_id))) {
    throw new Refusal("leg.field_refused");
  }

  const reply = await forward(request);
  if (ending && isOk(reply)) await markEnded(ctx, callControlId);
  return relay(reply);
};

/**
 * Recordings are addressed by their own id, so the guard reads the recording
 * first and deletes it only when its leg is one the guard registered.
 */
async function deleteRecording(request: Parameters<Handler>[0]): Promise<Response> {
  const { ctx } = request;
  const {telnyx} = ctx;
  if (!telnyx) throw new Refusal("telnyx.key_missing");
  const [id] = request.ids;
  const reply = await telnyx.send("GET", `/v2/recordings/${encodeURIComponent(id)}`);
  const data = (reply.body as { data?: Record<string, unknown> } | undefined)?.data;
  if (reply.status === 404) return relay(reply);
  const leg = data?.id === id && typeof data.call_control_id === "string" ? data.call_control_id : null;
  if (reply.status !== 200 || !leg || !(await liveLeg(ctx, leg))) throw new Refusal("leg.recording_not_registered");
  return relay(await forward(request, undefined));
}
