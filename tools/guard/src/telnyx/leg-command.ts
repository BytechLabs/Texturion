import { Refusal } from "../refusal";
import { readTier } from "../state/ledger";
import { liveLeg, markEnded } from "../state/legs";
import { requirePaidLanesOpen } from "../state/signals";
import { forward, isOk, relay, type Handler } from "./forward";
import { bodyIsContained } from "./hazards";

/**
 * The leg-command class (docs/RIG.md): any command on a call id
 * in the leg registry. Ending a call is always allowed, so a red tier or an
 * account signal can still hang up what is running; anything else on a leg
 * waits for the paid lanes to be open.
 */
const ENDING = new Set(["hangup", "reject"]);

export const handleLegCommand: Handler = async (request) => {
  const { ctx } = request;
  if (request.entry.key === "DELETE /v2/recordings/:id") return deleteRecording(request);

  const callControlId = request.ids[0];
  if (!(await liveLeg(ctx, callControlId))) throw new Refusal("leg.not_registered");
  if (request.bodyInvalid) throw new Refusal("request.body_invalid");
  const action = request.path.split("/").pop() ?? "";
  const ending = ENDING.has(action);

  if (!ending) {
    await requirePaidLanesOpen(ctx);
    if ((await readTier(ctx)).tier === "red") throw new Refusal("budget.tier_red");
  }
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
  const telnyx = ctx.telnyx;
  if (!telnyx) throw new Refusal("telnyx.key_missing");
  const id = request.ids[0];
  const reply = await telnyx.send("GET", `/v2/recordings/${encodeURIComponent(id)}`);
  const data = (reply.body as { data?: Record<string, unknown> } | undefined)?.data;
  if (reply.status === 404) return relay(reply);
  const leg = data && data.id === id && typeof data.call_control_id === "string" ? data.call_control_id : null;
  if (reply.status !== 200 || !leg || !(await liveLeg(ctx, leg))) throw new Refusal("leg.recording_not_registered");
  return relay(await forward(request, undefined));
}
