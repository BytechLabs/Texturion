import { Refusal } from "../refusal";
import { forward, relay } from './forward';
import type { Handler } from './forward';
import { onEdge } from "./hazards";
import { isOwnedNumber } from "./targets";

/**
 * The message class (docs/RIG.md): `from` and `to` both owned,
 * on a nonprod messaging profile, so every test text stays on-net between
 * numbers the rig holds.
 */

export const handleMessage: Handler = async (request) => {
  const { ctx, view } = request;
  const {body} = request;
  if (!body) throw new Refusal("request.body_invalid");

  if (!isOwnedNumber(view, body.from)) throw new Refusal("message.from_not_owned");
  const targets = Array.isArray(body.to) ? body.to : [body.to];
  if (targets.length === 0 || !targets.every((to) => isOwnedNumber(view, to))) {
    throw new Refusal("message.to_not_owned");
  }
  const sender = view.byE164.get(body.from as string);
  const profiles = [sender?.messaging_profile_id ?? null, body.messaging_profile_id ?? null].filter(
    (value) => value !== null,
  );
  if (profiles.length === 0 || !profiles.every((id) => typeof id === "string" && view.messagingProfiles.has(id))) {
    throw new Refusal("message.profile_not_nonprod");
  }
  for (const field of ["webhook_url", "webhook_failover_url"]) {
    if (body[field] !== undefined && body[field] !== null && !onEdge(ctx, body[field])) {
      throw new Refusal("message.field_refused");
    }
  }

  return relay(await forward(request));
};
