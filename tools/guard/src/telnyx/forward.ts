import type { GuardCaller } from "../caller";
import type { Ctx } from "../context";
import type { TelnyxReply } from "./client";
import type { PartitionView } from "./partition";
import type { PolicyEntry } from "./registry";

/** One Telnyx request from a rig caller, matched to its registry entry. */
export interface TelnyxRequest {
  ctx: Ctx;
  caller: GuardCaller;
  method: string;
  /** `/v2/...`, as the app wrote it under its API base. */
  path: string;
  query: URLSearchParams;
  ids: string[];
  entry: PolicyEntry;
  /** The JSON body, when it was an object. */
  body: Record<string, unknown> | undefined;
  /** True when a body was sent but was not a JSON object. */
  bodyInvalid: boolean;
  lease: string | null;
  scenario: string | null;
  idempotencyKey: string | null;
  view: PartitionView;
}

export type Handler = (request: TelnyxRequest) => Promise<Response>;

/** Sends the request on to Telnyx with the guard's key, the body as given or rewritten. */
export async function forward(
  request: TelnyxRequest,
  body: Record<string, unknown> | undefined = request.body,
): Promise<TelnyxReply> {
  const telnyx = request.ctx.telnyx;
  if (!telnyx) throw new Error("forward without a Telnyx key");
  const query = request.query.toString();
  return telnyx.send(
    request.method,
    query ? `${request.path}?${query}` : request.path,
    body,
    request.idempotencyKey ? { "idempotency-key": request.idempotencyKey } : {},
  );
}

/** Telnyx's answer, as the caller sees it. A body that was JSON stays JSON. */
export function relay(reply: TelnyxReply, body: unknown = reply.body): Response {
  if (body === undefined || [204, 205, 304].includes(reply.status)) {
    // A null-body status cannot carry even an empty string.
    const text = reply.text && ![204, 205, 304].includes(reply.status) ? reply.text : null;
    return new Response(text, {
      status: reply.status,
      headers: text ? { "content-type": "text/plain" } : {},
    });
  }
  return new Response(JSON.stringify(body), {
    status: reply.status,
    headers: { "content-type": "application/json" },
  });
}

export function isOk(reply: TelnyxReply): boolean {
  return reply.status >= 200 && reply.status <= 299;
}

/** A definite refusal by Telnyx: nothing happened, so anything taken for it is given back. */
export function isDefiniteFailure(reply: TelnyxReply): boolean {
  return reply.status >= 400 && reply.status <= 499;
}
